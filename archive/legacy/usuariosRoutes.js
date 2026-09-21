const express = require('express');
const { requireRole } = require('../middlewares/auth');
const { listarUsuarios } = require('../gdap');

const router = express.Router();

// Protege a rota para garantir que apenas usuários autenticados e com a role correta possam acessá-la.
const requireAdminOrSuperadmin = requireRole(['admin', 'superadmin']);

/**
 * Rota para listar os usuários a partir do Microsoft Graph.
 * GET /
 * Retorna: { usuarios: [{ id, nome, email, cargo }] }
 */
router.get('/', requireAdminOrSuperadmin, async (req, res) => {
  console.log('Iniciando busca de usuários no Microsoft Graph...');

  try {
    // 1. Chama o serviço para obter os dados reais da API do Microsoft Graph
    const graphUsers = await listarUsuarios();
    console.log(`Sucesso! ${graphUsers.length} usuários recebidos do Graph.`);

    // 2. Mapeia os dados para o formato esperado pelo frontend
    const usuarios = graphUsers.map(user => ({
      id: user.id,
      nome: user.displayName,
      email: user.userPrincipalName,
      cargo: user.jobTitle || 'N/A', // O cargo pode não estar preenchido
    }));

    // 3. Envia a resposta
    res.json({ usuarios });

  } catch (err) {
    console.error('Erro ao buscar usuários do Microsoft Graph:', err.message);
    res.status(500).json({
      error: 'Falha ao carregar usuários do Microsoft Graph.',
      details: err.message
    });
  }
});

module.exports = router;
