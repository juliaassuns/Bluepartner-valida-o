const express = require('express');
const { dbGet, dbRun } = require('../db');
const { validaCnpj } = require('../lib/validation');
const { hashPublicToken, tokenMatches } = require('../lib/crypto');
const crypto = require('crypto');

const router = express.Router();

router.post('/', async (req, res) => {
    try {
        const { pedidoId, token, revenda, timestamp, status, cnpj } = req.body;

        if (!pedidoId || !token || !cnpj) {
            return res.status(400).json({ error: 'pedidoId, token e cnpj são obrigatórios' });
        }

        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (!pedido || !tokenMatches(pedido.token, token)) {
            return res.status(404).json({ error: 'Pedido não encontrado ou token inválido' });
        }

        const cnpjLimpoReq = String(cnpj).replace(/[^\d]/g, '');
        const cnpjLimpoPedido = String(pedido.cnpj).replace(/[^\d]/g, '');

        if (!validaCnpj(cnpjLimpoReq) || cnpjLimpoReq !== cnpjLimpoPedido) {
            return res.status(400).json({ error: 'O CNPJ informado não corresponde ao do pedido original.' });
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

        await dbRun(
            'INSERT INTO audit_log (acao, pedido_id, cnpj, origem, timestamp) VALUES (?, ?, ?, ?, ?)',
            ['VALIDAR_PEDIDO', pedidoId, cnpjLimpoReq, 'validacao_publica', new Date().toISOString()]
        );

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
