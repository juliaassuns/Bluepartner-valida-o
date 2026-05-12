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

// ===== CNPJ LOOKUP =====
router.get('/cnpj/:cnpj', async (req, res) => {
    try {
        let cnpj = String(req.params.cnpj || '').trim();
        
        // Remove formatting
        cnpj = cnpj.replace(/[.\-\/]/g, '').replace(/\D/g, '');
        
        // Validate CNPJ format (must be 14 digits)
        if (!/^\d{14}$/.test(cnpj)) {
            return res.status(400).json({ error: 'CNPJ inválido' });
        }
        
        // Call external API
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            let externalRes;
            try {
                externalRes = await fetch(`https://api.opencnpj.org/v1/${cnpj}`, {
                    signal: controller.signal,
                    headers: { 'User-Agent': 'BluePartner/1.0' }
                });
            } finally {
                clearTimeout(timeoutId);
            }
            
            if (!externalRes.ok) {
                // Try alternative API if first one fails
                const controller2 = new AbortController();
                const timeoutId2 = setTimeout(() => controller2.abort(), 5000);
                
                let altRes;
                try {
                    altRes = await fetch(`https://api.cnpja.com.br/office/${cnpj}`, {
                        signal: controller2.signal,
                        headers: { 'User-Agent': 'BluePartner/1.0' }
                    });
                } finally {
                    clearTimeout(timeoutId2);
                }
                
                if (altRes && altRes.ok) {
                    const altData = await altRes.json();
                    return res.json({
                        nome: altData.name || altData.nome || 'Empresa não identificada',
                        cnpj: cnpj
                    });
                }
                
                return res.status(404).json({ error: 'CNPJ não encontrado' });
            }
            
            const data = await externalRes.json();
            res.json({
                nome: data.name || data.company_name || data.razao_social || 'Empresa não identificada',
                cnpj: cnpj
            });
        } catch (apiErr) {
            console.error('[CNPJ Lookup External API Error]', apiErr.message);
            res.status(503).json({ error: 'Serviço de CNPJ temporariamente indisponível' });
        }
    } catch (err) {
        console.error('[CNPJ Lookup]', err.message);
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
