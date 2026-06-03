const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');
const { requireRole } = require('../middlewares/auth');
const {
    isGdapConfigured,
    criarConviteGDAP,
    lerLicencasCliente,
    consultarRelacaoComFallback,
    extrairRelationshipIdDoLinkGdap,
} = require('../gdap');

const { getIngramLicencasNormalizadas, isIngramConfigured } = require('../ingram');
const { getTdsLicencasNormalizadas, isTdsConfigured } = require('../tds');
const { buildComparisonRows } = require('../lib/license-compare-3way');

const router = express.Router();

const requireAdminOrSuperadmin = requireRole(['admin', 'superadmin']);
const requireSuperadmin = requireRole('superadmin');

function isUuid(value) {
    return typeof value === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

// ===== STATUS (admin) =====
router.get('/status', requireAdminOrSuperadmin, async (req, res) => {
    try {
        const poolDisponivelRow = await dbGet(
            `SELECT COUNT(*) as total FROM gdap_pool WHERE status = 'disponivel'`
        );
        res.json({
            configured: isGdapConfigured(),
            partnerName: process.env.GDAP_PARTNER_NAME || 'Blue Partner',
            poolDisponivel: poolDisponivelRow?.total || 0,
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao consultar status do GDAP' });
    }
});

router.get('/status/:id', requireAdminOrSuperadmin, async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!isUuid(id)) {
            return res.status(400).json({ error: 'GUID inválido' });
        }

        if (!isGdapConfigured()) {
            return res.status(503).json({ error: 'GDAP não configurado' });
        }

        // Quando configurado, aqui seria consultado no Graph.
        return res.json({ configured: true, relationshipId: id });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao consultar GDAP' });
    }
});

// ===== LICENÇAS (admin) =====
router.get('/licencas/:id', requireAdminOrSuperadmin, async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!isUuid(id)) {
            return res.status(400).json({ error: 'GUID inválido' });
        }

        if (!isGdapConfigured()) {
            return res.status(503).json({ error: 'GDAP não configurado' });
        }

        return res.json({ licencas: [] });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao consultar licenças do GDAP' });
    }
});

// ===== COMPARA (admin) =====
async function getPedidoLicencas(pedidoId) {
    const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [pedidoId]);
    if (!pedido) return null;

    const licencas = await dbAll(
        'SELECT id, produto, qtd, duracao, preco FROM licencas WHERE pedido_id = ?',
        [pedidoId]
    );

    return { pedido, licencas };
}

router.get('/comparar/:pedidoId', requireAdminOrSuperadmin, async (req, res) => {
    try {
        const pedidoId = String(req.params.pedidoId || '');

        const found = await getPedidoLicencas(pedidoId);
        if (!found) return res.status(404).json({ error: 'Pedido não encontrado' });

        if (!found.licencas || found.licencas.length === 0) {
            return res.json({ gdapStatus: 'sem_licencas' });
        }

        if (!isGdapConfigured()) {
            return res.json({
                gdapStatus: 'nao_configurado',
                comparacao: found.licencas.map(l => ({
                    produto: l.produto,
                    resultado: 'gdap_nao_configurado',
                    qtd: l.qtd,
                })),
            });
        }

        return res.json({
            gdapStatus: 'configurado',
            comparacao: found.licencas.map(l => ({
                produto: l.produto,
                resultado: 'gdap_ok',
                qtd: l.qtd,
            })),
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao comparar GDAP' });
    }
});

router.get('/comparar-completo/:pedidoId', requireAdminOrSuperadmin, async (req, res) => {
    try {
        const pedidoId = String(req.params.pedidoId || '');

        const found = await getPedidoLicencas(pedidoId);
        if (!found) return res.status(404).json({ error: 'Pedido não encontrado' });

        const requestedLicenses = Array.isArray(found.licencas) ? found.licencas.map(l => ({
            produto: l.produto,
            qtd: l.qtd ?? 1,
        })) : [];

        // Revendas vinculadas ao pedido (define distribuidor)
        const revendas = await dbAll(
            `SELECT r.id, r.nome, r.partner_id, r.categoria, r.link_base
             FROM pedido_revendas pr
             JOIN revendas r ON r.id = pr.revenda_id
             WHERE pr.pedido_id = ?
             ORDER BY r.nome ASC`,
            [pedidoId]
        );

        const firstRevenda = Array.isArray(revendas) && revendas.length ? revendas[0] : null;
        const revendaCategoriaRaw = String(firstRevenda?.categoria || '').toLowerCase();

        const distribuidorCategoria =
            revendaCategoriaRaw.includes('ingram') ? 'ingram' :
            revendaCategoriaRaw.includes('tds') ? 'tds' :
            'outros';

        // Defaults para o payload que a UI espera
        let gdapStatus = 'nao_configurado';
        let gdapMessage = 'Configuração GDAP não encontrada no servidor.';
        let portal = [];

        let distribuidorStatus = 'sem_revenda';
        let distribuidorMessage = 'Nenhuma revenda Ingram Micro/TD SYNNEX associada a este pedido.';
        let distribuidor = [];

        // Se não houver licenças cadastradas no pedido, ainda devolvemos payload compatível com a UI.
        if (requestedLicenses.length === 0) {
            return res.json({
                gdapStatus: 'sem_licencas',
                gdapMessage,
                distribuidorCategoria,
                distribuidorStatus: 'sem_licencas',
                distribuidorMessage,
                proposta: [],
                comparacao: [],
                portal: [],
                distribuidor: [],
            });
        }

        // ===== Portal (GDAP) =====
        if (!isGdapConfigured()) {
            gdapStatus = 'nao_configurado';
            gdapMessage = 'Configuração GDAP não encontrada no servidor.';
        } else {
            const relationshipId =
                found.pedido?.gdap_relationship_id ||
                extrairRelationshipIdDoLinkGdap(found.pedido?.gdap_link);

            if (!relationshipId) {
                gdapStatus = 'nao_configurado';
                gdapMessage = 'GDAP relationshipId não encontrado para este pedido.';
            } else {
                const rel = await consultarRelacaoComFallback(relationshipId);
                const relStatus = String(rel?.status || '').toLowerCase();

                if (relStatus === 'active') {
                    gdapStatus = 'ativo';
                } else if (relStatus === 'approvalpending') {
                    gdapStatus = 'pendente';
                } else {
                    gdapStatus = 'restricao';
                }

                if (gdapStatus === 'ativo') {
                    const customerTenantId = rel?.customer?.tenantId;
                    if (!customerTenantId) {
                        gdapStatus = 'restricao';
                        gdapMessage = 'Tenant do cliente não disponível na relação GDAP.';
                    } else {
                        portal = await lerLicencasCliente(customerTenantId);
                    }
                } else {
                    gdapMessage = `Relação GDAP em status: ${rel?.status || 'unknown'}`;
                }
            }
        }

        // ===== Distribuidor (Ingram/TDS) =====
        try {
            const partnerId = String(firstRevenda?.partner_id || '').trim();

            const wantIngram = distribuidorCategoria === 'ingram';
            const wantTds = distribuidorCategoria === 'tds';

            if (wantIngram) {
                if (!isIngramConfigured()) {
                    distribuidorStatus = 'nao_configurado';
                    distribuidorMessage = 'API do distribuidor não configurada (Ingram Micro).';
                } else if (!partnerId) {
                    distribuidorStatus = 'sem_revenda';
                    distribuidorMessage = 'Nenhuma revenda Ingram Micro com partner_id associado a este pedido.';
                } else {
                    distribuidor = await getIngramLicencasNormalizadas(partnerId);
                    distribuidorStatus = 'ativo';
                    distribuidorMessage = 'Dados de assinaturas do distribuidor carregados com sucesso.';
                }
            } else if (wantTds) {
                if (!isTdsConfigured()) {
                    distribuidorStatus = 'nao_configurado';
                    distribuidorMessage = 'API do distribuidor não configurada (TD SYNNEX).';
                } else if (!partnerId) {
                    distribuidorStatus = 'sem_revenda';
                    distribuidorMessage = 'Nenhuma revenda TD SYNNEX com partner_id associado a este pedido.';
                } else {
                    distribuidor = await getTdsLicencasNormalizadas(partnerId);
                    distribuidorStatus = 'ativo';
                    distribuidorMessage = 'Dados de assinaturas do distribuidor carregados com sucesso.';
                }
            } else {
                // "outros" => UI trata como "Distribuidor" e mensagens genéricas
                if (!partnerId) {
                    distribuidorStatus = 'sem_revenda';
                    distribuidorMessage = 'Nenhuma revenda Ingram Micro/TD SYNNEX associada a este pedido.';
                } else {
                    // Sem mapeamento para outros, devolve como falha/ausente.
                    distribuidorStatus = 'sem_revenda';
                    distribuidorMessage = 'Distribuidor não suportado para comparação (esperado Ingram Micro ou TD SYNNEX).';
                }
            }
        } catch (distErr) {
            // fallback: marca como falha, mas mantém payload compatível
            distribuidorStatus = distribuidorStatus === 'ativo' ? 'ativo' : 'falha';
            distribuidorMessage = distErr?.message || 'Erro ao consultar assinaturas no distribuidor.';
        }

        // ===== Comparação 3-vias =====
        const comparacao = buildComparisonRows({
            requestedLicenses,
            portalLicenses: portal,
            distributorLicenses: distribuidor,
        });

        res.json({
            gdapStatus,
            gdapMessage,
            distribuidorCategoria,
            distribuidorStatus,
            distribuidorMessage,
            proposta: requestedLicenses,

            comparacao,

            // Extras (a UI usa esses arrays para listar "outras licenças")
            portal,
            distribuidor,
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao comparar completo GDAP' });
    }
});

// ===== POOL (superadmin) =====
router.get('/pool', requireAdminOrSuperadmin, async (req, res) => {
    try {
        const totalRow = await dbGet(`SELECT COUNT(*) as total FROM gdap_pool`);
        const disponiveisRow = await dbGet(
            `SELECT COUNT(*) as disponiveis FROM gdap_pool WHERE status = 'disponivel'`
        );
        const usadosRow = await dbGet(`SELECT COUNT(*) as usados FROM gdap_pool WHERE status = 'usado'`);

        const links = await dbAll(
            `SELECT id, link, label, status, pedido_id, criado_em, usado_em
             FROM gdap_pool
             ORDER BY criado_em DESC`
        );

        res.json({
            total: totalRow?.total || 0,
            disponiveis: disponiveisRow?.disponiveis || 0,
            usados: usadosRow?.usados || 0,
            links: Array.isArray(links) ? links : [],
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao carregar pool GDAP' });
    }
});

router.post('/pool', requireSuperadmin, async (req, res) => {
    try {
        const { link, links, label } = req.body || {};

        const incomingLinks = [];
        if (typeof link === 'string' && link.trim()) incomingLinks.push(link.trim());
        if (Array.isArray(links)) {
            for (const item of links) {
                if (typeof item === 'string' && item.trim()) incomingLinks.push(item.trim());
            }
        }

        if (incomingLinks.length === 0) {
            return res.status(400).json({ error: 'Informe link ou links' });
        }

        let added = 0;

        for (const l of incomingLinks) {
            const existing = await dbGet('SELECT id FROM gdap_pool WHERE link = ?', [l]);
            if (existing) continue;

            await dbRun(
                'INSERT INTO gdap_pool (link, label, status) VALUES (?, ?, ?)',
                [l, label ? String(label) : '', 'disponivel']
            );
            added++;
        }

        res.json({ added });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao adicionar ao pool GDAP' });
    }
});

router.delete('/pool/:id', requireSuperadmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });

        const result = await dbRun('DELETE FROM gdap_pool WHERE id = ?', [id]);

        // dbRun retorna changes via objeto {lastID, changes}
        if ((result?.changes || 0) === 0) return res.status(404).json({ error: 'Link não encontrado' });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao remover do pool GDAP' });
    }
});

// ===== CLEAR USED LINKS (superadmin) =====
router.delete('/pool/clear-used', requireSuperadmin, async (req, res) => {
    try {
        const result = await dbRun("DELETE FROM gdap_pool WHERE status = 'usado'");

        const removed = result?.changes || 0;

        res.json({
            success: true,
            message: removed > 0 ? `Links usados removidos: ${removed}` : 'Nenhum link usado encontrado para remover',
            removed,
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao limpar links usados do pool GDAP' });
    }
});

// ===== AUTO-GENERATE LINKS (superadmin) =====
// Gera novos convites GDAP e adiciona no gdap_pool quando disponível estiver abaixo do mínimo.
router.post('/pool/auto', requireAdminOrSuperadmin, async (req, res) => {
    try {
        const minDisponiveis = Number(req.body?.minDisponiveis ?? 3);
        const maxNovos = Number(req.body?.maxNovos ?? 3);

        if (!Number.isFinite(minDisponiveis) || minDisponiveis < 0) {
            return res.status(400).json({ error: 'minDisponiveis inválido' });
        }
        if (!Number.isFinite(maxNovos) || maxNovos <= 0) {
            return res.status(400).json({ error: 'maxNovos inválido' });
        }

        if (!isGdapConfigured()) {
            return res.status(503).json({ error: 'GDAP não configurado' });
        }

        // Reuse helper implementation
        const result = await autoGeneratePool({ minDisponiveis, maxNovos });
        if (result.error) return res.status(result.status || 500).json(result);
        return res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao auto-gerar pool GDAP' });
    }
});

/**
 * Helper: auto-generate GDAP pool links.
 * Returns an object with keys: added, disponiveisAntes, disponiveisDepois, target, maxNovos
 * On error returns { error, status, details }
 */
async function autoGeneratePool({ minDisponiveis = 3, maxNovos = 3 } = {}) {
    try {
        const partnerName = process.env.GDAP_PARTNER_NAME || 'Blue Partner';

        const disponiveisRow = await dbGet(
            `SELECT COUNT(*) as disponiveis FROM gdap_pool WHERE status = 'disponivel'`
        );
        const disponiveisAtuais = disponiveisRow?.disponiveis || 0;

        if (disponiveisAtuais >= minDisponiveis) {
            return {
                added: 0,
                disponiveisAntes: disponiveisAtuais,
                disponiveisDepois: disponiveisAtuais,
                target: minDisponiveis,
                maxNovos,
            };
        }

        const maxAdd = Math.min(maxNovos, minDisponiveis - disponiveisAtuais);

        let added = 0;

        for (let i = 0; i < maxAdd; i++) {
            const label = `Visualizador de Licenças - ${partnerName}`;
            let gdapResult;
            try {
                gdapResult = await criarConviteGDAP({ displayName: label });
            } catch (e) {
                return {
                    error: 'Falha ao gerar convite GDAP',
                    status: 500,
                    added,
                    disponiveisAntes: disponiveisAtuais,
                    target: minDisponiveis,
                    maxNovos,
                    details: e?.message || String(e),
                };
            }

            const inviteLink = gdapResult?.inviteLink;
            const displayName = gdapResult?.displayName || label;

            if (!inviteLink) continue;

            const existing = await dbGet('SELECT id FROM gdap_pool WHERE link = ?', [inviteLink]);
            if (existing) continue;

            await dbRun(
                'INSERT INTO gdap_pool (link, label, status) VALUES (?, ?, ?)',
                [inviteLink, displayName, 'disponivel']
            );

            added++;
        }

        const disponiveisDepoisRow = await dbGet(
            `SELECT COUNT(*) as disponiveis FROM gdap_pool WHERE status = 'disponivel'`
        );
        const disponiveisDepois = disponiveisDepoisRow?.disponiveis || 0;

        return {
            added,
            disponiveisAntes: disponiveisAtuais,
            disponiveisDepois,
            target: minDisponiveis,
            maxNovos,
        };
    } catch (err) {
        return { error: 'Erro interno', status: 500, details: err?.message || String(err) };
    }
}

// ===== TEMPORARY TRIGGER (ADMIN TOKEN) =====
// Endpoint to trigger auto-generation without session (for operators). Protected by ADMIN_TRIGGER_TOKEN env var.
router.post('/pool/auto-trigger', async (req, res) => {
    try {
        const token = String(req.body?.token || req.query?.token || req.headers['x-admin-trigger'] || '');
        const expected = String(process.env.ADMIN_TRIGGER_TOKEN || '');
        if (!expected) return res.status(403).json({ error: 'Trigger não habilitado' });
        if (!token || token !== expected) return res.status(401).json({ error: 'Token inválido' });

        const minDisponiveis = Number(req.body?.minDisponiveis ?? 3);
        const maxNovos = Number(req.body?.maxNovos ?? 3);

        const result = await autoGeneratePool({ minDisponiveis, maxNovos });
        if (result.error) return res.status(result.status || 500).json(result);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao executar trigger', details: err?.message || String(err) });
    }
});

module.exports = router;
