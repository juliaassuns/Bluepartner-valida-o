const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');

const router = express.Router();

router.get('/health', async (req, res) => {
    try {
        await dbGet('SELECT 1');
        res.json({ status: 'ok', uptime: process.uptime() });
    } catch (err) {
        res.status(503).json({ status: 'error', error: 'Database unreachable' });
    }
});

// ===== ADMIN DASHBOARD =====
router.get('/admin/dashboard', async (req, res) => {
    try {
        // Links GDAP disponíveis
        const gdapPoolStats = await dbGet(`
            SELECT 
                COUNT(CASE WHEN status = 'disponivel' THEN 1 END) as disponivel,
                COUNT(CASE WHEN status = 'usado' THEN 1 END) as usado,
                COUNT(*) as total
            FROM gdap_pool
        `);

        // Total de pedidos
        const pedidosStats = await dbGet(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'VALIDADO' THEN 1 END) as validados,
                COUNT(CASE WHEN status = 'PENDENTE' THEN 1 END) as pendentes
            FROM pedidos
        `);

        // Revendas ativas
        const revendasStats = await dbGet(`
            SELECT COUNT(*) as total
            FROM revendas
            WHERE ativo = 1
        `);

        // Usuários ativos
        const usuariosStats = await dbGet(`
            SELECT COUNT(*) as total
            FROM usuarios
            WHERE ativo = 1
        `);

        res.json({
            gdapPool: {
                disponivel: gdapPoolStats?.disponivel || 0,
                usado: gdapPoolStats?.usado || 0,
                total: gdapPoolStats?.total || 0
            },
            pedidos: {
                total: pedidosStats?.total || 0,
                validados: pedidosStats?.validados || 0,
                pendentes: pedidosStats?.pendentes || 0
            },
            revendas: {
                total: revendasStats?.total || 0
            },
            usuarios: {
                total: usuariosStats?.total || 0
            }
        });
    } catch (err) {
        console.error('[Dashboard]', err.message);
        res.status(500).json({ error: 'Erro ao carregar dashboard' });
    }
});

async function fetchJsonWithTimeout(url, opts = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
        const res = await fetch(url, { signal: controller.signal, ...opts });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        if (err.name === 'AbortError') {
            console.warn('[CNPJ Lookup] Timeout for', url);
        } else {
            console.warn('[CNPJ Lookup] Fetch failed for', url, err.message || err);
        }
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

function extractCnpjName(data) {
    if (!data || typeof data !== 'object') return null;
    return (
        data.razao_social ||
        data.razaoSocial ||
        data.nome ||
        data.company_name ||
        data.name ||
        data.fantasia ||
        data.nome_fantasia ||
        data.trade_name ||
        null
    );
}

// ===== CNPJ LOOKUP =====
router.get('/cnpj/:cnpj', async (req, res) => {
    try {
        let cnpj = String(req.params.cnpj || '').trim();
        cnpj = cnpj.replace(/[.\-/]/g, '').replace(/\D/g, '');

        if (!/^\d{14}$/.test(cnpj)) {
            return res.status(400).json({ error: 'CNPJ inválido' });
        }

        const cnpjFormatted = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;

        const providers = [
            `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
            `https://api.opencnpj.org/v1/${cnpj}`,
            `https://api.cnpja.com.br/office/${cnpj}`
        ];

        let nome = null;
        for (const url of providers) {
            const data = await fetchJsonWithTimeout(url, {
                headers: { 'User-Agent': 'BluePartner/1.0' }
            });
            if (!data) continue;
            const parsedName = extractCnpjName(data);
            if (parsedName) {
                nome = String(parsedName).trim();
                break;
            }
        }

        if (!nome) {
            nome = `Empresa ${cnpjFormatted}`;
        }

        return res.json({
            nome,
            cnpj: cnpjFormatted
        });
    } catch (err) {
        console.error('[CNPJ Lookup]', err.message || err);
        res.status(500).json({ error: 'Erro ao buscar CNPJ' });
    }
});

// ===== REVENDAS =====
router.get('/revendas/ativas', async (req, res) => {
    try {
        const revendas = await dbAll(`
            SELECT id, nome, partner_id, link_base, categoria
            FROM revendas
            WHERE ativo = 1
            ORDER BY nome ASC
        `);
        res.json(revendas || []);
    } catch (err) {
        console.error('[Revendas]', err.message);
        res.status(500).json({ error: 'Erro ao carregar revendas' });
    }
});

// ===== GDAP POOL =====
router.get('/gdap/pool', async (req, res) => {
    try {
        const pool = await dbAll(`
            SELECT id, link, label, status, pedido_id, criado_em, usado_em
            FROM gdap_pool
            ORDER BY criado_em DESC
        `);
        res.json(pool || []);
    } catch (err) {
        console.error('[GDAP Pool]', err.message);
        res.status(500).json({ error: 'Erro ao carregar pool GDAP' });
    }
});

// ===== LOGS =====
router.get('/logs', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || 100), 1000);
        const offset = parseInt(req.query.offset || 0);

        const logs = await dbAll(`
            SELECT id, pedido_id, token, revenda, timestamp, ip, status, criado_em
            FROM logs
            ORDER BY criado_em DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        const countResult = await dbGet('SELECT COUNT(*) as total FROM logs');

        res.json({
            logs: logs || [],
            total: countResult?.total || 0,
            limit,
            offset
        });
    } catch (err) {
        console.error('[Logs]', err.message);
        res.status(500).json({ error: 'Erro ao carregar logs' });
    }
});

// ===== AUDIT LOG =====
router.get('/audit-log', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || 100), 1000);
        const offset = parseInt(req.query.offset || 0);

        const audit = await dbAll(`
            SELECT id, acao, entidade, entidade_id, usuario, detalhes, ip, criado_em
            FROM audit_log
            ORDER BY criado_em DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        const countResult = await dbGet('SELECT COUNT(*) as total FROM audit_log');

        res.json({
            audit: audit || [],
            total: countResult?.total || 0,
            limit,
            offset
        });
    } catch (err) {
        console.error('[Audit Log]', err.message);
        res.status(500).json({ error: 'Erro ao carregar auditoria' });
    }
});

module.exports = router;
