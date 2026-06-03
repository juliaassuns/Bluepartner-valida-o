const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');
const { requireRole } = require('../middlewares/auth');

const router = express.Router();
const requireAdminOrSuperadmin = requireRole(['admin', 'superadmin']);

router.get('/:pedidoId', requireAdminOrSuperadmin, async (req, res) => {
  try {
    const pedidoId = String(req.params.pedidoId || '').trim();
    if (!pedidoId) return res.status(400).json({ error: 'pedidoId é obrigatório' });

    const pedido = await dbGet('SELECT pedido_id FROM pedidos WHERE pedido_id = ?', [pedidoId]);
    if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });

    const licencas = await dbAll(
      `SELECT id, pedido_id, produto, qtd, duracao, preco
       FROM licencas
       WHERE pedido_id = ?
       ORDER BY id ASC`,
      [pedidoId]
    );

    const total = licencas?.length || 0;

    res.json({ total, licencas: Array.isArray(licencas) ? licencas : [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar licenças' });
  }
});

router.post('/:pedidoId', requireAdminOrSuperadmin, async (req, res) => {
  try {
    const pedidoId = String(req.params.pedidoId || '').trim();
    if (!pedidoId) return res.status(400).json({ error: 'pedidoId é obrigatório' });

    const pedido = await dbGet('SELECT pedido_id FROM pedidos WHERE pedido_id = ?', [pedidoId]);
    if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });

    const { produto, qtd, duracao, preco } = req.body || {};

    if (!produto || typeof produto !== 'string' || !produto.trim()) {
      return res.status(400).json({ error: 'produto é obrigatório' });
    }

    const qtdNum = Number.parseInt(String(qtd ?? 1), 10);
    const qtdFinal = Number.isFinite(qtdNum) ? qtdNum : 1;

    const result = await dbRun(
      `INSERT INTO licencas (pedido_id, produto, qtd, duracao, preco)
       VALUES (?, ?, ?, ?, ?)`,
      [pedidoId, produto.trim(), qtdFinal, String(duracao ?? '12 meses NCE'), String(preco ?? '')]
    );

    res.json({ success: true, id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao adicionar licença' });
  }
});

router.delete('/:licencaId', requireAdminOrSuperadmin, async (req, res) => {
  try {
    const licencaId = Number(req.params.licencaId);
    if (!Number.isFinite(licencaId)) return res.status(400).json({ error: 'licencaId inválido' });

    const licenca = await dbGet('SELECT id FROM licencas WHERE id = ?', [licencaId]);
    if (!licenca) return res.status(404).json({ error: 'Licença não encontrada' });

    await dbRun('DELETE FROM licencas WHERE id = ?', [licencaId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover licença' });
  }
});

module.exports = router;
