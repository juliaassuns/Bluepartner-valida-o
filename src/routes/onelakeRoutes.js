const express = require('express');
const { requireRole } = require('../middlewares/auth');
const {
  listWorkspaces,
  listLakehouses,
  listLakehouseTables,
  describeTable,
  previewTable,
} = require('../fabric');

const router = express.Router();
const requireSuperadmin = requireRole('superadmin');

function requireString(q, fallback = '') {
  const v = String(q ?? fallback);
  return v.trim();
}

router.get('/workspaces', requireSuperadmin, async (req, res) => {
  try {
    const userToken = req.session?.fabricToken;
    const value = await listWorkspaces(userToken);
    res.json({ value });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Erro ao listar workspaces' });
  }
});

router.get('/lakehouses', requireSuperadmin, async (req, res) => {
  try {
    const userToken = req.session?.fabricToken;
    const workspaceId = requireString(req.query.workspaceId, '');
    const value = await listLakehouses(workspaceId || undefined, userToken);
    res.json({ value });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Erro ao listar lakehouses' });
  }
});

router.get('/lakehouses/:lakehouseId/tables', requireSuperadmin, async (req, res) => {
  try {
    const userToken = req.session?.fabricToken;
    const lakehouseId = requireString(req.params.lakehouseId, '');
    if (!lakehouseId) return res.status(400).json({ error: 'lakehouseId é obrigatório' });

    const workspaceId = requireString(req.query.workspaceId, '');
    const data = await listLakehouseTables(lakehouseId, workspaceId || undefined, userToken);
    // front espera: { data: [...] }
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Erro ao listar tabelas do lakehouse' });
  }
});

router.get('/table/describe', requireSuperadmin, async (req, res) => {
  try {
    const userToken = req.session?.fabricToken; // not used by describeTable (SQL), but kept for future
    const tableName = requireString(req.query.table, '');
    if (!tableName) return res.status(400).json({ error: 'table é obrigatório' });

    const columns = await describeTable(tableName);
    res.json({ columns, userTokenConfigured: !!userToken });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Erro ao descrever tabela' });
  }
});

router.get('/table/preview', requireSuperadmin, async (req, res) => {
  try {
    const tableName = requireString(req.query.table, '');
    if (!tableName) return res.status(400).json({ error: 'table é obrigatório' });

    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const safeLimit = Number.isFinite(limit) ? limit : 50;

    const result = await previewTable(tableName, safeLimit);
    // front espera: { rows: [...], total: n }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Erro ao pré-visualizar tabela' });
  }
});

module.exports = router;
