const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');
const { requireRole } = require('../middlewares/auth');

const router = express.Router();

const requireAdminOrSuperadmin = requireRole(['admin', 'superadmin']);
const requireSuperadmin = requireRole('superadmin');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

router.get('/', requireAdminOrSuperadmin, async (req, res) => {
  try {
    const revendas = await dbAll(
      `SELECT id, nome, contato, email, partner_id, link_base, categoria, ativo
       FROM revendas
       ORDER BY nome ASC`
    );
    res.json({ revendas: Array.isArray(revendas) ? revendas : [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar revendas' });
  }
});

router.get('/ativas', requireAdminOrSuperadmin, async (req, res) => {
  try {
    const revendas = await dbAll(
      `SELECT id, nome, contato, email, partner_id, link_base, categoria, ativo
       FROM revendas
       WHERE ativo = 1
       ORDER BY nome ASC`
    );
    res.json({ revendas: Array.isArray(revendas) ? revendas : [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar revendas ativas' });
  }
});

router.post('/', requireSuperadmin, async (req, res) => {
  try {
    const { nome, contato = '', email = '', partner_id = '', link_base = '', categoria = '' } = req.body || {};

    if (!isNonEmptyString(nome)) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const existing = await dbGet('SELECT id FROM revendas WHERE nome = ?', [nome]);
    if (existing) {
      return res.status(409).json({ error: 'Revenda já existe' });
    }

    const result = await dbRun(
      `INSERT INTO revendas (nome, contato, email, partner_id, link_base, categoria, ativo)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        nome.trim(),
        String(contato),
        String(email),
        String(partner_id),
        String(link_base),
        String(categoria),
      ]
    );

    res.json({ success: true, id: result.lastID, nome: nome.trim() });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar revenda' });
  }
});

router.put('/:id', requireSuperadmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });

    const { nome, contato, email, partner_id, link_base, categoria, ativo } = req.body || {};

    const existing = await dbGet('SELECT id FROM revendas WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Revenda não encontrada' });

    // Atualiza apenas campos fornecidos
    const updatedNome = isNonEmptyString(nome) ? nome.trim() : null;

    if (updatedNome) {
      const dup = await dbGet(
        'SELECT id FROM revendas WHERE nome = ? AND id <> ?',
        [updatedNome, id]
      );
      if (dup) return res.status(409).json({ error: 'Revenda já existe' });
    }

    await dbRun(
      `UPDATE revendas
       SET nome = COALESCE(?, nome),
           contato = COALESCE(?, contato),
           email = COALESCE(?, email),
           partner_id = COALESCE(?, partner_id),
           link_base = COALESCE(?, link_base),
           categoria = COALESCE(?, categoria),
           ativo = COALESCE(?, ativo)
       WHERE id = ?`,
      [
        updatedNome,
        typeof contato === 'string' ? contato : null,
        typeof email === 'string' ? email : null,
        typeof partner_id === 'string' ? partner_id : null,
        typeof link_base === 'string' ? link_base : null,
        typeof categoria === 'string' ? categoria : null,
        typeof ativo === 'boolean' || typeof ativo === 'number' ? ativo : null,
        id,
      ]
    );

    const row = await dbGet(
      `SELECT id, nome, contato, email, partner_id, link_base, categoria, ativo
       FROM revendas
       WHERE id = ?`,
      [id]
    );

    res.json(row ? { ...row, success: true } : { success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao editar revenda' });
  }
});

router.delete('/:id', requireSuperadmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });

    const revenda = await dbGet('SELECT id FROM revendas WHERE id = ?', [id]);
    if (!revenda) return res.status(404).json({ error: 'Revenda não encontrada' });

    const assocCountRow = await dbGet(
      'SELECT COUNT(*) as total FROM pedido_revendas WHERE revenda_id = ?',
      [id]
    );
    const assocCount = assocCountRow?.total || 0;
    if (assocCount > 0) {
      return res
        .status(400)
        .json({ error: 'pedido(s) associado(s) a esta revenda' });
    }

    await dbRun('DELETE FROM revendas WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar revenda' });
  }
});

router.post('/importar', requireSuperadmin, async (req, res) => {
  try {
    const { nomes } = req.body || {};
    if (!Array.isArray(nomes) || nomes.length === 0) {
      return res.status(400).json({ error: 'Informe nomes' });
    }

    let added = 0;
    let skipped = 0;

    for (const rawNome of nomes) {
      const nome = isNonEmptyString(rawNome) ? rawNome.trim() : '';
      if (!nome) continue;

      const existing = await dbGet('SELECT id FROM revendas WHERE nome = ?', [nome]);
      if (existing) {
        skipped++;
        continue;
      }

      await dbRun(
        `INSERT INTO revendas (nome, contato, email, partner_id, categoria, ativo)
         VALUES (?, '', '', '', '', 1)`,
        [nome]
      );
      added++;
    }

    res.json({ added, skipped });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao importar revendas' });
  }
});

router.get('/dashboard', requireSuperadmin, async (req, res) => {
  try {
    const totalRevendasRow = await dbGet('SELECT COUNT(*) as total FROM revendas');
    const totalRevendas = totalRevendasRow?.total || 0;

    const ativasRow = await dbGet('SELECT COUNT(*) as total FROM revendas WHERE ativo = 1');
    const ativas = ativasRow?.total || 0;

    const totalPedidosRow = await dbGet('SELECT COUNT(*) as total FROM pedidos');
    const totalPedidos = totalPedidosRow?.total || 0;

    const revendas = await dbAll(
      `SELECT r.id, r.nome, r.contato, r.email, r.partner_id, r.link_base, r.categoria, r.ativo,
              (SELECT COUNT(*)
               FROM pedido_revendas pr
               WHERE pr.revenda_id = r.id) as total_pedidos,
              (SELECT COUNT(*)
               FROM pedido_revendas pr
               JOIN pedidos p ON p.pedido_id = pr.pedido_id
               WHERE pr.revenda_id = r.id
                 AND UPPER(COALESCE(p.status, '')) = 'VALIDADO') as validados,
              (SELECT COUNT(*)
               FROM pedido_revendas pr
               JOIN pedidos p ON p.pedido_id = pr.pedido_id
               WHERE pr.revenda_id = r.id
                 AND UPPER(COALESCE(p.status, '')) <> 'VALIDADO') as pendentes
       FROM revendas r
       ORDER BY r.nome ASC`
    );

    res.json({ totalRevendas, ativas, totalPedidos, revendas: Array.isArray(revendas) ? revendas : [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar dashboard de revendas' });
  }
});

module.exports = router;
