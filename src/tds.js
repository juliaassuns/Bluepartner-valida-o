/**
 * Módulo TD SYNNEX — Integração com API StreamOne Ion
 * 
 * Lê assinaturas/licenças do cliente na plataforma TD SYNNEX (StreamOne Ion).
 * Requer credenciais de API no .env (TDS_*)
 * 
 * Documentação: https://developer.tdsynnex.com/
 */

const { createDistributorClient } = require('./lib/distributor-client');

const tdsClient = createDistributorClient({
    providerLabel: 'TD SYNNEX',
    source: 'tds',
    defaultBaseUrl: 'https://api.streamonecloud.net',
    baseUrlEnv: 'TDS_BASE_URL',
    tokenUrlEnv: 'TDS_TOKEN_URL',
    clientIdEnv: 'TDS_CLIENT_ID',
    clientSecretEnv: 'TDS_CLIENT_SECRET',
});

// ===== LISTAR ASSINATURAS DO CLIENTE =====
/**
 * Lista as assinaturas ativas de um cliente na TD SYNNEX / StreamOne Ion.
 * 
 * @param {string} customerId - ID do cliente na TDS (reseller customer ID ou tenant domain)
 * @returns {Array} Lista de assinaturas { skuPartNumber, productName, quantity, status, ... }
 */
async function getTdsSubscriptions(customerId) {
    return tdsClient.listSubscriptions(customerId);
}

// ===== BUSCAR PEDIDOS DO CLIENTE =====
/**
 * Lista os pedidos recentes de um cliente na TD SYNNEX.
 * 
 * @param {string} customerId - ID do cliente na TDS
 * @returns {Array} Lista de pedidos { orderId, products[], status, createdDate }
 */
async function getTdsOrders(customerId) {
    return tdsClient.listOrders(customerId);
}

// ===== NORMALIZAR PARA FORMATO DE COMPARAÇÃO =====
/**
 * Converte assinaturas TDS para formato padronizado de comparação.
 * 
 * @param {string} customerId - ID do cliente na TDS
 * @returns {Array} [{ skuPartNumber, productName, quantity, status }]
 */
async function getTdsLicencasNormalizadas(customerId) {
    return tdsClient.getNormalizedLicenses(customerId);
}

module.exports = {
    isTdsConfigured: tdsClient.isConfigured,
    getTdsToken: tdsClient.getToken,
    getTdsSubscriptions,
    getTdsOrders,
    getTdsLicencasNormalizadas,
};
