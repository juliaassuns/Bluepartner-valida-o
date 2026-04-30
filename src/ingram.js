/**
 * Módulo Ingram Micro — Integração com API Ingram Micro Cloud
 * 
 * Lê assinaturas/licenças do cliente na plataforma Ingram Micro.
 * Requer credenciais de API no .env (INGRAM_*)
 * 
 * Documentação: https://developer.ingrammicrocloud.com/
 */

const { createDistributorClient } = require('./lib/distributor-client');

const ingramClient = createDistributorClient({
    providerLabel: 'Ingram Micro',
    source: 'ingram',
    defaultBaseUrl: 'https://api.ingrammicrocloud.com',
    baseUrlEnv: 'INGRAM_BASE_URL',
    tokenUrlEnv: 'INGRAM_TOKEN_URL',
    clientIdEnv: 'INGRAM_CLIENT_ID',
    clientSecretEnv: 'INGRAM_CLIENT_SECRET',
});

// ===== LISTAR ASSINATURAS DO CLIENTE =====
/**
 * Lista as assinaturas ativas de um cliente na Ingram Micro.
 * 
 * @param {string} customerId - ID do cliente na Ingram (reseller customer ID ou tenant domain)
 * @returns {Array} Lista de assinaturas { skuPartNumber, productName, quantity, status, ... }
 */
async function getIngramSubscriptions(customerId) {
    return ingramClient.listSubscriptions(customerId);
}

// ===== BUSCAR PEDIDOS DO CLIENTE =====
/**
 * Lista os pedidos recentes de um cliente na Ingram Micro.
 * 
 * @param {string} customerId - ID do cliente na Ingram
 * @returns {Array} Lista de pedidos { orderId, products[], status, createdDate }
 */
async function getIngramOrders(customerId) {
    return ingramClient.listOrders(customerId);
}

// ===== NORMALIZAR PARA FORMATO DE COMPARAÇÃO =====
/**
 * Converte assinaturas Ingram para formato padronizado de comparação.
 * 
 * @param {string} customerId - ID do cliente na Ingram
 * @returns {Array} [{ skuPartNumber, productName, quantity, status }]
 */
async function getIngramLicencasNormalizadas(customerId) {
    return ingramClient.getNormalizedLicenses(customerId);
}

module.exports = {
    isIngramConfigured: ingramClient.isConfigured,
    getIngramToken: ingramClient.getToken,
    getIngramSubscriptions,
    getIngramOrders,
    getIngramLicencasNormalizadas,
};
