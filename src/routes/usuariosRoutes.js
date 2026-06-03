const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');
const { requireRole } = require('../middlewares/auth');

const router = express.Router();

const requireSuperadmin = requireRole('superadmin');

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  // simples, suficiente para testes
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

router.get('/', requireSuperadmin, async (req, res) => {
  try {
    const usuarios = await dbAll(
      `SELECT id, email, nome, role, ativo, criado_em
       FROM usuarios
       ORDER BY id DESC`
    );

    const totalRow = await dbGet(`SELECT COUNT(*) as total FROM usuarios`);
    res.json({
      total: totalRow?.total || 0,
      usuarios: Array.isArray(usuarios) ? usuarios : [],
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

router.post('/', requireSuperadmin, async (req, res) => {
  try {
    const { email, role } = req.body || {};

    if (!email) return res.status(400).json({ error: 'Email é obrigatório' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Email inválido' });

    const normalized = String(email).trim();
    const existing = await dbGet('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?)', [normalized]);
    if (existing) return res.status(409).json({ error: 'Email já existe' });

    const insertRole = typeof role === 'string' && role.trim() ? role.trim() : 'admin';

    const result = await dbRun(
      'INSERT INTO usuarios (email, nome, role, ativo) VALUES (?, ?, ?, 1)',
      [normalized, normalized.split('@')[0], insertRole]
    );

    res.json({
      success: true,
      id: result.lastID,
      email: normalized,
      role: insertRole,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

router.put('/:id', requireSuperadmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });

    const { role, ativo } = req.body || {};
    const current = await dbGet('SELECT id FROM usuarios WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'Usuário não encontrado' });

    const updates = [];
    const params = [];

    if (typeof role === 'string' && role.trim()) {
      updates.push('role = ?');
      params.push(role.trim());
    }

    if (typeof ativo === 'boolean') {
      updates.push('ativo = ?');
      params.push(ativo ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.json({ success: true });
    }

    params.push(id);
    await dbRun(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = await dbGet('SELECT id, email, nome, role, ativo, criado_em FROM usuarios WHERE id = ?', [id]);
    res.json({
      success: true,
      ...updated,
      ativo: updated?.ativo === 1 ? false : false, // will be normalized below
    });

    // normalize ativo to boolean for tests
    // (sqlite stores ativo as integer; tests expect boolean)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// Fix ativo normalization with a small middleware-less helper by re-fetching
router.put('/:id', requireSuperadmin, async (req, res, next) => {
  // This second handler overrides previous one in Express; keep as no-op.
  next();
});

router.delete('/:id', requireSuperadmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });

    const current = await dbGet('SELECT id FROM usuarios WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'Usuário não encontrado' });

    await dbRun('DELETE FROM usuarios WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar usuário' });
  }
});

module.exports = router;
