const express = require('express');
const { dbGet, dbRun } = require('../db');
const crypto = require('crypto');

const router = express.Router();

const TOKEN_HASH_PEPPER = process.env.TOKEN_HASH_PEPPER || process.env.SESSION_SECRET;

function hashPublicToken(token) {
    return crypto
        .createHash('sha256')
        .update(`${TOKEN_HASH_PEPPER}:${String(token || '')}`)
        .digest('hex');
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

router.post('/', async (req, res) => {
    try {
        const { pedidoId, token, revenda, timestamp, status } = req.body;

        if (!pedidoId || !token) {
            return res.status(400).json({ error: 'pedidoId e token são obrigatórios' });
        }

        const pedido = await dbGet('SELECT pedido_id, token FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (!pedido || !tokenMatches(pedido.token, token)) {
            return res.status(404).json({ error: 'Pedido não encontrado ou token inválido' });
        }

        const ip = req.headers['x-forwarded-for']
            || req.headers['x-real-ip']
            || req.connection?.remoteAddress
            || req.socket?.remoteAddress
            || 'unknown';

        const userAgent = req.headers['user-agent'] || 'unknown';
        const logTimestamp = timestamp || new Date().toISOString();
        const logStatus = status || 'VALIDADO';

        const result = await dbRun(
            `INSERT INTO logs (pedido_id, token, revenda, timestamp, ip, user_agent, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [pedidoId, hashPublicToken(token), revenda || 'unknown', logTimestamp, ip, userAgent, logStatus]
        );

        await dbRun(
            `UPDATE pedidos SET status = 'VALIDADO', atualizado_em = CURRENT_TIMESTAMP 
             WHERE pedido_id = ?`,
            [pedidoId]
        );

        console.log(`✅ Validação registrada: ${pedidoId} via ${revenda} | IP: ${ip}`);

        res.json({
            success: true,
            logId: result.lastID,
            message: 'Validação registrada com sucesso'
        });
    } catch (err) {
        console.error('Erro ao salvar validação:', err);
        res.status(500).json({ error: 'Erro interno ao salvar validação' });
    }
});

module.exports = router;
