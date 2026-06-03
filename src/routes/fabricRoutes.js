const express = require('express');
const { requireRole } = require('../middlewares/auth');
const { isFabricConfigured, syncRevendasFromFabric, listWorkspaces } = require('../fabric');

const router = express.Router();
const requireSuperadmin = requireRole('superadmin');

function bool(v) {
  return !!v;
}

router.get('/status', requireSuperadmin, async (req, res) => {
  try {
    const cfg = isFabricConfigured();

    // O front espera estes campos:
    // - configured
    // - sqlConfigured
    // - powerbiConfigured
    const configured = bool(cfg.credentials) && (bool(cfg.sql) || bool(cfg.powerbi) || bool(cfg.onelake));

    res.json({
      configured,
      sqlConfigured: bool(cfg.sql),
      powerbiConfigured: bool(cfg.powerbi),
      onelakeConfigured: bool(cfg.onelake),
      credentialsConfigured: bool(cfg.credentials),
      config: cfg.config || {},
    });
  } catch (err) {
    res.status(500).json({
      configured: false,
      error: 'Erro ao consultar status do Fabric',
    });
  }
});

router.post('/test-connection', requireSuperadmin, async (req, res) => {
  try {
    const cfg = isFabricConfigured();
    if (!cfg.credentials) {
      return res.status(200).json({
        success: false,
        error: 'Fabric/MSAL não configurado. Defina FABRIC_TENANT_ID, FABRIC_CLIENT_ID e FABRIC_CLIENT_SECRET no .env.',
      });
    }

    // Tentativa "leve": listar workspaces via OneLake (se estiver configurado).
    // Se não tiver onelake/Power BI configs, ainda assim retornamos success=false com mensagem clara.
    if (cfg.onelake) {
      const userToken = req.session?.fabricToken;
      try {
        await listWorkspaces(userToken);
        return res.json({ success: true });
      } catch (e) {
        return res.status(200).json({
          success: false,
          error: e?.message || 'Falha ao testar conexão (listWorkspaces). Verifique consent/escopos no Entra ID.',
        });
      }
    }

    if (cfg.sql) {
      return res.json({
        success: true,
        note: 'SQL Fabric configurado, mas Onelake/REST não está configurado. Conexão SQL ok (sem validação REST).',
      });
    }

    return res.status(200).json({
      success: false,
      error: 'Nenhum modo configurado para testar conexão (sql/powerbi/onelake).',
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Erro ao testar conexão',
    });
  }
});

router.post('/sync-revendas', requireSuperadmin, async (req, res) => {
  try {
    const tableName = process.env.FABRIC_REVENDAS_TABLE || 'revendas';
    const columnMap = {
      nome: process.env.FABRIC_REVENDAS_COL_NOME || 'nome',
      partner_id: process.env.FABRIC_REVENDAS_COL_PARTNER_ID || 'partner_id',
      link_base: process.env.FABRIC_REVENDAS_COL_LINK_BASE || 'link_base',
    };

    const db = require('../db');
    const result = await syncRevendasFromFabric(tableName, columnMap, db.dbRun, db.dbGet);

    res.json({
      success: true,
      message: 'Revendas sincronizadas do Fabric com sucesso',
      ...result,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Erro ao sincronizar revendas do Fabric',
    });
  }
});

module.exports = router;
