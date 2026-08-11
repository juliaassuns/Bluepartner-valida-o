const express = require('express');
const { requireRole } = require('../middlewares/auth');
const { listarRelacoesAtivas } = require('../gdap');

const router = express.Router();

// Protege a rota para garantir que apenas usuários autenticados e com a role correta possam acessá-la.
const requireAdminOrSuperadmin = requireRole(['admin', 'superadmin']);

/**
 * Rota para listar as revendas (clientes) a partir das relações GDAP ativas no Partner Center.
 * GET /
 * Retorna: { revendas: [{ id, nome, tenantId, status }] }
 */
router.get('/', requireAdminOrSuperadmin, async (req, res) => {
  console.log('Iniciando busca de revendas (relações GDAP ativas)...');
  
  try {
    // 1. Chama o serviço para obter os dados reais da API do Microsoft Graph
    const relacoes = await listarRelacoesAtivas();
    console.log(`Sucesso! ${relacoes.length} relações ativas recebidas.`);

    // 2. Mapeia os dados para o formato esperado pelo frontend
    const revendas = relacoes.map(relacao => ({
      id: relacao.id, // ID da relação GDAP
      nome: relacao.customer.displayName,
      tenantId: relacao.customer.tenantId,
      status: relacao.status,
    }));

    // 3. Envia a resposta
    res.json({ revendas });

  } catch (err) {
    console.error('Erro ao buscar revendas do Partner Center:', err.message);
    res.status(500).json({ 
      error: 'Falha ao carregar revendas do Partner Center.',
      details: err.message 
    });
  }
});

module.exports = router;
