const express = require('express');
const crypto = require('crypto');
const { dbGet, dbAll, dbRun } = require('../db');
const { criarConviteGDAP, isGdapConfigured, extrairRelationshipIdDoLinkGdap } = require('../gdap');

const router = express.Router();

const TOKEN_HASH_PEPPER = process.env.TOKEN_HASH_PEPPER || process.env.SESSION_SECRET;

function hashPublicToken(token) {
    return crypto
        .createHash('sha256')
        .update(`${TOKEN_HASH_PEPPER}:${String(token || '')}`)
        .digest('hex');
}

function buildPublicValidationLink(baseUrl, pedidoId, token) {
    const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
    const safePedidoId = encodeURIComponent(String(pedidoId || ''));
    const safeToken = encodeURIComponent(String(token || ''));
    return `${normalizedBase}/validar?pedidoId=${safePedidoId}#token=${safeToken}`;
}

function tokenMatches(storedToken, rawToken) {
    if (!storedToken || !rawToken) return false;
    const stored = String(storedToken);
    const provided = String(rawToken);

    // Compatibilidade: registros antigos podem estar em texto puro.
    if (/^[a-f0-9]{64}$/i.test(stored)) {
        return safeStringEquals(stored.toLowerCase(), hashPublicToken(provided));
    }
    return safeStringEquals(stored, provided);
}

async function buildPedidoPublicPayload(pedido) {
    const licencas = await dbAll(
        'SELECT produto, qtd, duracao, preco FROM licencas WHERE pedido_id = ?',
        [pedido.pedido_id]
    );

    const revendas = await dbAll(
        `SELECT r.id, r.nome, r.partner_id, r.link_base
         FROM pedido_revendas pr
         JOIN revendas r ON r.id = pr.revenda_id
         WHERE pr.pedido_id = ?`,
        [pedido.pedido_id]
    );

    return {
        cliente: pedido.cliente,
        cnpj: pedido.cnpj,
        pedidoId: pedido.pedido_id,
        revenda: pedido.revenda,
        revendas: revendas.map(r => ({
            id: r.id,
            nome: r.nome,
            partnerId: r.partner_id || '',
            linkBase: r.link_base || ''
        })),
        status: pedido.status,
        gdapLink: pedido.gdap_link || process.env.GDAP_DEFAULT_LINK || null,
        licencas
    };
}

async function auditLog(req, acao, entidade, entidadeId, detalhes) {
    try {
        const usuario = req.session?.user?.email || 'sistema';
        const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection?.remoteAddress || 'unknown';
        await dbRun(
            'INSERT INTO audit_log (acao, entidade, entidade_id, usuario, detalhes, ip) VALUES (?, ?, ?, ?, ?, ?)',
            [acao, entidade, entidadeId || '', usuario, typeof detalhes === 'object' ? JSON.stringify(detalhes) : String(detalhes || ''), ip]
        );
    } catch (e) {
        console.warn('[AUDIT] Falha ao gravar log:', e.message);
    }
}

router.post('/resolve', async (req, res) => {
    try {
        const { pedidoId, token } = req.body || {};

        if (!pedidoId || !token) {
            return res.status(400).json({ error: 'pedidoId e token são obrigatórios' });
        }

        if (!/^[A-Za-z0-9_-]+$/.test(String(pedidoId)) || !/^[A-Za-z0-9_-]+$/.test(String(token))) {
            return res.status(400).json({ error: 'Formato de pedidoId ou token inválido' });
        }

        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [String(pedidoId)]);
        if (!pedido || !tokenMatches(pedido.token, String(token))) {
            return res.status(404).json({ error: 'Pedido não encontrado ou token inválido' });
        }

        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        const payload = await buildPedidoPublicPayload(pedido);
        res.json(payload);
    } catch (err) {
        console.error('Erro ao resolver pedido:', err);
        res.status(500).json({ error: 'Erro interno ao buscar dados do pedido' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { cliente, cnpj, revendas: revendaIds } = req.body;

        if (!cliente || !cnpj) {
            return res.status(400).json({ error: 'Nome do cliente e CNPJ são obrigatórios' });
        }

        let validRevendas = [];
        if (Array.isArray(revendaIds) && revendaIds.length > 0) {
            const placeholders = revendaIds.map(() => '?').join(',');
            validRevendas = await dbAll(
                `SELECT id, nome FROM revendas WHERE id IN (${placeholders}) AND ativo = 1`,
                revendaIds
            );
        }

        const ts = Date.now().toString(36);
        const rand = crypto.randomBytes(3).toString('hex');
        const pedidoId = `PED-${ts}-${rand}`.toUpperCase();

        const token = crypto.randomBytes(16).toString('hex');
        const tokenToStore = hashPublicToken(token);

        let gdapLink = null;
        let gdapRelationshipId = null;

        const claimResult = await dbRun(
            "UPDATE gdap_pool SET status = 'usado', pedido_id = ?, usado_em = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM gdap_pool WHERE status = 'disponivel' ORDER BY criado_em ASC LIMIT 1)",
            [pedidoId]
        );
        if (claimResult.changes > 0) {
            const claimed = await dbGet("SELECT link FROM gdap_pool WHERE pedido_id = ? AND status = 'usado' ORDER BY usado_em DESC LIMIT 1", [pedidoId]);
            if (claimed) {
                gdapLink = claimed.link;
                gdapRelationshipId = extrairRelationshipIdDoLinkGdap(gdapLink);
            }
            console.log(`[GDAP Pool] Link atribuído ao pedido ${pedidoId}`);
        }

        if (!gdapLink && isGdapConfigured()) {
            try {
                console.log(`[GDAP] Gerando convite individual para pedido ${pedidoId}...`);
                const gdapResult = await criarConviteGDAP({
                    displayName: `Licenças - ${cliente.trim()} (${pedidoId})`
                });
                gdapLink = gdapResult.inviteLink;
                gdapRelationshipId = gdapResult.relationshipId;
                console.log(`[GDAP] ✅ Link gerado para ${pedidoId}: ${gdapLink}`);
            } catch (gdapErr) {
                console.error(`[GDAP] ⚠️ Falha ao gerar link para ${pedidoId}:`, gdapErr.message);
            }
        }

        if (!gdapLink && process.env.GDAP_DEFAULT_LINK) {
            gdapLink = process.env.GDAP_DEFAULT_LINK;
            console.log(`[GDAP] Usando link padrão (GDAP_DEFAULT_LINK) para ${pedidoId}`);
        }

        if (!gdapRelationshipId) {
            gdapRelationshipId = extrairRelationshipIdDoLinkGdap(gdapLink);
        }

        const primeiraRevenda = validRevendas.length > 0 ? validRevendas[0] : null;
        const revendaVal = primeiraRevenda ? primeiraRevenda.nome.toLowerCase().replace(/\s+/g, '_') : null;
        const revendaNome = validRevendas.length > 0 ? validRevendas.map(r => r.nome).join(', ') : null;

        await dbRun(
            'INSERT INTO pedidos (pedido_id, token, cliente, cnpj, revenda, revenda_nome, gdap_link, gdap_relationship_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [pedidoId, tokenToStore, cliente.trim(), cnpj.trim(), revendaVal, revendaNome, gdapLink, gdapRelationshipId]
        );

        for (const rv of validRevendas) {
            await dbRun(
                'INSERT INTO pedido_revendas (pedido_id, revenda_id) VALUES (?, ?)',
                [pedidoId, rv.id]
            );
        }

        const revendaNomes = validRevendas.map(r => r.nome);
        console.log(`📋 Novo pedido criado: ${pedidoId} → ${cliente} [Revendas: ${revendaNomes.join(', ') || 'nenhuma'}]`);
        await auditLog(req, 'CRIAR_PEDIDO', 'pedido', pedidoId, { cliente: cliente.trim(), cnpj: cnpj.trim(), revendas: revendaNomes });

        res.json({
            success: true,
            pedidoId,
            token,
            cliente: cliente.trim(),
            cnpj: cnpj.trim(),
            revendas: revendaNomes,
            gdapLink,
            link: buildPublicValidationLink('', pedidoId, token)
        });
    } catch (err) {
        console.error('Erro ao criar pedido:', err);
        res.status(500).json({ error: 'Erro interno ao criar pedido' });
    }
});

router.post('/batch', async (req, res) => {
    try {
        const { pedidos } = req.body;

        if (!Array.isArray(pedidos) || pedidos.length === 0) {
            return res.status(400).json({ error: 'Envie um array "pedidos" com pelo menos 1 item' });
        }

        if (pedidos.length > 100) {
            return res.status(400).json({ error: 'Máximo de 100 pedidos por lote' });
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const results = [];

        for (const item of pedidos) {
            const cnpjRaw = String(item.cnpj || '').replace(/[.\-\/]/g, '').replace(/\D/g, '');

            if (!/^\d{14}$/.test(cnpjRaw)) {
                results.push({
                    pedidoId: item.pedidoId || null,
                    erro: `CNPJ inválido: ${item.cnpj || '(vazio)'}`
                });
                continue;
            }

            let cliente = '';
            let situacao = '';
            try {
                const cnpjRes = await fetch(`https://api.opencnpj.org/${cnpjRaw}`, {
                    headers: { 'Accept': 'application/json', 'User-Agent': 'BluePartner-Validacao/1.0' }
                });
                if (cnpjRes.ok) {
                    const cnpjData = await cnpjRes.json();
                    cliente = cnpjData.razao_social || '';
                    situacao = cnpjData.situacao_cadastral || '';
                }
            } catch (e) {
                console.warn(`[BATCH] Falha ao consultar CNPJ ${cnpjRaw}:`, e.message);
            }

            const ts = Date.now().toString(36);
            const rand = crypto.randomBytes(3).toString('hex');
            const pedidoId = (item.pedidoId || `PED-${ts}-${rand}`).toUpperCase();
            const token = crypto.randomBytes(16).toString('hex');
            const tokenToStore = hashPublicToken(token);

            let revendaIds = item.revendas;
            if (!Array.isArray(revendaIds) || revendaIds.length === 0) {
                if (item.revenda) {
                    const rv = await dbGet('SELECT id FROM revendas WHERE LOWER(nome) = LOWER(?) AND ativo = 1', [item.revenda]);
                    if (rv) revendaIds = [rv.id];
                }
            }
            if (!Array.isArray(revendaIds) || revendaIds.length === 0) {
                const fallback = await dbGet('SELECT id FROM revendas WHERE ativo = 1 ORDER BY id ASC LIMIT 1');
                revendaIds = fallback ? [fallback.id] : [];
            }

            let validRevendas = [];
            if (revendaIds.length > 0) {
                const ph = revendaIds.map(() => '?').join(',');
                validRevendas = await dbAll(`SELECT id, nome FROM revendas WHERE id IN (${ph}) AND ativo = 1`, revendaIds);
            }

            let gdapLink = null;
            let gdapRelationshipId = null;

            const claimResult = await dbRun(
                "UPDATE gdap_pool SET status = 'usado', pedido_id = ?, usado_em = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM gdap_pool WHERE status = 'disponivel' ORDER BY criado_em ASC LIMIT 1)",
                [pedidoId]
            );
            if (claimResult.changes > 0) {
                const claimed = await dbGet("SELECT link FROM gdap_pool WHERE pedido_id = ? AND status = 'usado' ORDER BY usado_em DESC LIMIT 1", [pedidoId]);
                if (claimed) {
                    gdapLink = claimed.link;
                    gdapRelationshipId = extrairRelationshipIdDoLinkGdap(gdapLink);
                }
            } else if (isGdapConfigured()) {
                try {
                    const gdapResult = await criarConviteGDAP({ displayName: `Licenças - ${cliente || cnpjRaw} (${pedidoId})` });
                    gdapLink = gdapResult.inviteLink;
                    gdapRelationshipId = gdapResult.relationshipId;
                } catch (gdapErr) {
                    console.error(`[GDAP BATCH] Falha ao gerar link para ${pedidoId}:`, gdapErr.message);
                }
            }

            if (!gdapLink && process.env.GDAP_DEFAULT_LINK) {
                gdapLink = process.env.GDAP_DEFAULT_LINK;
            }
            if (!gdapRelationshipId) {
                gdapRelationshipId = extrairRelationshipIdDoLinkGdap(gdapLink);
            }

            const primeiraRevenda = validRevendas.length > 0 ? validRevendas[0] : null;
            const revendaVal = primeiraRevenda ? primeiraRevenda.nome.toLowerCase().replace(/\s+/g, '_') : null;
            const revendaNome = validRevendas.length > 0 ? validRevendas.map(r => r.nome).join(', ') : null;

            await dbRun(
                'INSERT INTO pedidos (pedido_id, token, cliente, cnpj, revenda, revenda_nome, gdap_link, gdap_relationship_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [pedidoId, tokenToStore, cliente, cnpjRaw, revendaVal, revendaNome, gdapLink, gdapRelationshipId]
            );

            for (const rv of validRevendas) {
                await dbRun('INSERT INTO pedido_revendas (pedido_id, revenda_id) VALUES (?, ?)', [pedidoId, rv.id]);
            }

            results.push({
                pedidoId,
                token,
                cliente,
                cnpj: cnpjRaw,
                situacao,
                revendas: validRevendas.map(r => r.nome),
                gdapLink,
                link: buildPublicValidationLink(baseUrl, pedidoId, token)
            });
        }

        await auditLog(req, 'CRIAR_PEDIDO_LOTE', 'pedido', '', { count: pedidos.length });
        res.json({ success: true, results });
    } catch (err) {
        console.error('Erro ao criar pedidos em lote:', err);
        res.status(500).json({ error: 'Erro interno ao criar pedidos em lote' });
    }
});

router.get('/:pedidoId/:token', async (req, res) => {
    try {
        const { pedidoId, token } = req.params;

        if (!pedidoId || !token) {
            return res.status(400).json({ error: 'pedidoId e token são obrigatórios' });
        }

        if (!/^[A-Za-z0-9_-]+$/.test(pedidoId) || !/^[A-Za-z0-9_-]+$/.test(token)) {
            return res.status(400).json({ error: 'Formato de pedidoId ou token inválido' });
        }

        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [pedidoId]);

        if (!pedido || !tokenMatches(pedido.token, token)) {
            return res.status(404).json({ error: 'Pedido não encontrado ou token inválido' });
        }

        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        const payload = await buildPedidoPublicPayload(pedido);
        res.json(payload);
    } catch (err) {
        console.error('Erro ao buscar pedido:', err);
        res.status(500).json({ error: 'Erro interno ao buscar dados do pedido' });
    }
});
// ROTA DE DEBUG: Listar todos os pedidos
router.get('/', async (req, res) => {
    try {
        const pedidos = await dbAll('SELECT * FROM pedidos ORDER BY criado_em DESC');
        res.json({ pedidos });
    } catch (err) {
        console.error('Erro ao listar pedidos:', err);
        res.status(500).json({ error: 'Erro ao listar pedidos' });
    }
});

module.exports = router;
