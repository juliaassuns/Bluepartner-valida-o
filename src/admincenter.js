/**
 * Módulo Microsoft Admin Center — Integração com Partner Center API
 * 
 * Lê informações de clientes e licenças do Microsoft Partner Center.
 * Requer credenciais de API no .env (ADMINCENTER_*)
 * 
 * Documentação: https://docs.microsoft.com/en-us/partner-center/develop/
 */

const { createDistributorClient } = require('./lib/distributor-client');

const adminCenterClient = createDistributorClient({
    providerLabel: 'Admin Center',
    source: 'admincenter',
    defaultBaseUrl: 'https://api.partnercenter.microsoft.com',
    baseUrlEnv: 'ADMINCENTER_BASE_URL',
    tokenUrlEnv: 'ADMINCENTER_TOKEN_URL', // Geralmente usa um fluxo OAuth2 mais complexo
    clientIdEnv: 'ADMINCENTER_CLIENT_ID',
    clientSecretEnv: 'ADMINCENTER_CLIENT_SECRET',
    // O Partner Center pode exigir um tenant ID
    tenantIdEnv: 'ADMINCENTER_TENANT_ID', 
});

// ===== LISTAR ASSINATURAS DO CLIENTE =====
/**
 * Lista as assinaturas ativas de um cliente no Partner Center.
 * 
 * @param {string} customerId - ID do cliente (Tenant ID)
 * @returns {Array} Lista de assinaturas { skuPartNumber, productName, quantity, status, ... }
 */
async function getAdminCenterSubscriptions(customerId) {
    // A implementação real aqui seria mais complexa, envolvendo chamadas específicas da API do Partner Center.
    // O createDistributorClient pode precisar de adaptações para o fluxo de autenticação do Partner Center.
    return adminCenterClient.listSubscriptions(customerId);
}

// ===== NORMALIZAR PARA FORMATO DE COMPARAÇÃO =====
/**
 * Converte assinaturas do Partner Center para formato padronizado.
 * 
 * @param {string} customerId - ID do cliente (Tenant ID)
 * @returns {Array} [{ skuPartNumber, productName, quantity, status }]
 */
async function getAdminCenterLicencasNormalizadas(customerId) {
    return adminCenterClient.getNormalizedLicenses(customerId);
}

module.exports = {
    isAdminCenterConfigured: adminCenterClient.isConfigured,
    getAdminCenterToken: adminCenterClient.getToken,
    getAdminCenterSubscriptions,
    getAdminCenterLicencasNormalizadas,
};
