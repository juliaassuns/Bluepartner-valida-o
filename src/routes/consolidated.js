const express = require('express');
const { getIngramLicencasNormalizadas, isIngramConfigured } = require('../ingram');
const { getTdsLicencasNormalizadas, isTdsConfigured } = require('../tds');
const { getAdminCenterLicencasNormalizadas, isAdminCenterConfigured } = require('../admincenter');
const cache = require('../lib/cache');

const router = express.Router();

// Middleware para garantir que o usuário esteja autenticado
router.use((req, res, next) => {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    next();
});

/**
 * Rota consolidada para obter licenças de todas as fontes para um cliente.
 * GET /api/consolidated/licenses?customerId=...
 */
router.get('/licenses', async (req, res) => {
    const { customerId } = req.query;

    if (!customerId) {
        return res.status(400).json({ error: 'O parâmetro customerId é obrigatório.' });
    }

    const cacheKey = `consolidated-licenses-${customerId}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
        console.log(`[Cache] Retornando dados para a chave: ${cacheKey}`);
        return res.json({ ...cachedData, source: 'cache' });
    }

    console.log(`[API] Buscando dados para o cliente: ${customerId}`);

    const sources = {
        ingram: {
            fetch: () => getIngramLicencasNormalizadas(customerId),
            configured: isIngramConfigured(),
        },
        tds: {
            fetch: () => getTdsLicencasNormalizadas(customerId),
            configured: isTdsConfigured(),
        },
        admincenter: {
            fetch: () => getAdminCenterLicencasNormalizadas(customerId),
            configured: isAdminCenterConfigured(),
        }
    };

    const promises = Object.entries(sources)
        .filter(([, source]) => source.configured)
        .map(async ([name, source]) => {
            try {
                const data = await source.fetch();
                return { name, data, status: 'success' };
            } catch (error) {
                console.error(`Erro ao buscar dados da ${name} para o cliente ${customerId}:`, error.message);
                return { name, data: [], status: 'error', error: error.message };
            }
        });

    try {
        const results = await Promise.all(promises);

        const response = {
            customerId,
            licenses: {},
            errors: [],
        };

        results.forEach(result => {
            if (result.status === 'success') {
                response.licenses[result.name] = result.data;
            } else {
                response.errors.push({ source: result.name, message: result.error });
            }
        });

        // Armazena o resultado bem-sucedido no cache por 5 minutos (300 segundos)
        if (response.errors.length === 0) {
            cache.set(cacheKey, response, 300);
        }

        res.json(response);
    } catch (error) {
        console.error(`Erro geral ao consolidar licenças para o cliente ${customerId}:`, error);
        res.status(500).json({ error: 'Falha ao processar a solicitação consolidada.' });
    }
});

module.exports = router;
