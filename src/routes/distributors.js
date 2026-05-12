const express = require('express');
const { getIngramLicencasNormalizadas, isIngramConfigured } = require('../ingram');
const { getTdsLicencasNormalizadas, isTdsConfigured } = require('../tds');

const router = express.Router();

// Middleware para verificar se o usuário está autenticado
router.use((req, res, next) => {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    next();
});

/**
 * Rota para obter licenças normalizadas de um distribuidor específico.
 * /api/distributors/:source/licenses?customerId=...
 */
router.get('/:source/licenses', async (req, res) => {
    const { source } = req.params;
    const { customerId } = req.query;

    if (!customerId) {
        return res.status(400).json({ error: 'O parâmetro customerId é obrigatório.' });
    }

    let getLicensesFunction;
    let isConfigured = false;

    switch (source) {
        case 'ingram':
            getLicensesFunction = getIngramLicencasNormalizadas;
            isConfigured = isIngramConfigured();
            break;
        case 'tds':
            getLicensesFunction = getTdsLicencasNormalizadas;
            isConfigured = isTdsConfigured();
            break;
        default:
            return res.status(404).json({ error: 'Distribuidor não encontrado ou não suportado.' });
    }

    if (!isConfigured) {
        return res.status(501).json({ error: `A integração com ${source} não está configurada no servidor.` });
    }

    try {
        const licenses = await getLicensesFunction(customerId);
        res.json(licenses);
    } catch (error) {
        console.error(`Erro ao buscar licenças da ${source} para o cliente ${customerId}:`, error);
        res.status(500).json({ error: `Falha ao obter licenças de ${source}.` });
    }
});

module.exports = router;
