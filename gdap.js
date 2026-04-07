/**
 * Módulo GDAP — Criação de relações GDAP via Microsoft Graph API
 * 
 * Fluxo:
 * 1. Cria relação GDAP no Graph (sem especificar cliente)
 * 2. Faz lockForApproval para gerar o link de convite
 * 3. Retorna o link para ser enviado ao cliente
 */

const msal = require('@azure/msal-node');
const axios = require('axios');

// ===== CONFIGURAÇÃO =====
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const LICENSE_READER_ROLE_ID = '4d6ac14f-3453-41d0-bef9-a3e0c569773a';
const DIRECTORY_READERS_ROLE_ID = '88d8e3e3-8f55-4a1e-953a-9b9898b8876b';
const DEFAULT_DURATION = 'P730D';          // 730 dias (máximo)
const GRAPH_TIMEOUT = 30000;              // 30s timeout para chamadas Graph
const LICENSE_RETRY_ATTEMPTS = 4;         // Tentativas de retry (licenças podem demorar a aparecer)
const LICENSE_RETRY_DELAY_MS = 15000;     // 15s entre tentativas

// ===== MSAL CLIENT (singleton) =====
let msalClient = null;

function getMsalClient() {
    if (msalClient) return msalClient;

    const tenantId = process.env.GDAP_TENANT_ID;
    const clientId = process.env.GDAP_CLIENT_ID;
    const clientSecret = process.env.GDAP_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
        throw new Error(
            'Variáveis GDAP não configuradas. Defina GDAP_TENANT_ID, GDAP_CLIENT_ID e GDAP_CLIENT_SECRET no .env'
        );
    }

    const config = {
        auth: {
            clientId,
            clientSecret,
            authority: `https://login.microsoftonline.com/${tenantId}`,
        },
    };

    msalClient = new msal.ConfidentialClientApplication(config);
    return msalClient;
}

// ===== OBTER TOKEN =====
async function getAccessToken() {
    const client = getMsalClient();

    const result = await client.acquireTokenByClientCredential({
        scopes: [GRAPH_SCOPE],
    });

    if (!result || !result.accessToken) {
        throw new Error('Falha ao obter token de acesso do Entra ID');
    }

    return result.accessToken;
}

// ===== CRIAR CONVITE GDAP (fluxo completo) =====
/**
 * Cria uma relação GDAP e retorna o link de convite.
 * 
 * @param {object} options
 * @param {string} [options.displayName] - Nome da relação. Padrão: "Visualizador de Licenças - {PARTNER_NAME}"
 * @param {string} [options.duration] - Duração ISO 8601. Padrão: P730D
 * @returns {object} { relationshipId, displayName, status, inviteLink, duration }
 */
async function criarConviteGDAP({ displayName, duration } = {}) {
    const partnerName = process.env.GDAP_PARTNER_NAME || 'Blue Partner';
    const finalDisplayName = displayName || `Visualizador de Licenças - ${partnerName}`;
    const finalDuration = duration || DEFAULT_DURATION;

    // 1. Obter token
    console.log('[GDAP] Obtendo token de acesso...');
    const token = await getAccessToken();

    const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    // 2. Criar a relação GDAP
    console.log(`[GDAP] Criando relação: "${finalDisplayName}" (${finalDuration})`);

    const createUrl = `${GRAPH_BASE_URL}/tenantRelationships/delegatedAdminRelationships`;
    const createBody = {
        displayName: finalDisplayName,
        duration: finalDuration,
        accessDetails: {
            unifiedRoles: [
                { roleDefinitionId: LICENSE_READER_ROLE_ID },
                { roleDefinitionId: DIRECTORY_READERS_ROLE_ID }
            ],
        },
    };

    let relationship;
    try {
        const resp = await axios.post(createUrl, createBody, { headers, timeout: GRAPH_TIMEOUT });
        relationship = resp.data;
    } catch (err) {
        const graphError = err.response?.data?.error;
        throw new Error(
            `Erro ao criar relação GDAP: [${graphError?.code || err.code}] ${graphError?.message || err.message}`
        );
    }

    const relationshipId = relationship.id;
    console.log(`[GDAP] Relação criada — ID: ${relationshipId}`);

    // 3. lockForApproval (gera o link de aceite)
    console.log('[GDAP] Executando lockForApproval...');

    const lockUrl = `${GRAPH_BASE_URL}/tenantRelationships/delegatedAdminRelationships/${relationshipId}/requests`;
    const lockBody = { action: 'lockForApproval' };

    try {
        await axios.post(lockUrl, lockBody, { headers, timeout: GRAPH_TIMEOUT });
    } catch (err) {
        const graphError = err.response?.data?.error;
        throw new Error(
            `Erro ao fazer lockForApproval: [${graphError?.code || err.code}] ${graphError?.message || err.message}`
        );
    }

    console.log('[GDAP] lockForApproval concluído');

    // 4. Montar link de convite
    const inviteLink = `https://admin.microsoft.com/AdminPortal/Home#/partners/invitation/granularAdminRelationships/${relationshipId}`;

    console.log(`[GDAP] ✅ Convite criado: ${inviteLink}`);

    return {
        relationshipId,
        displayName: finalDisplayName,
        status: relationship.status || 'approvalPending',
        inviteLink,
        duration: finalDuration,
    };
}

// ===== LISTAR RELAÇÕES GDAP ATIVAS =====
/**
 * Lista todas as relações GDAP ativas (status = active).
 * Retorna array com { id, displayName, status, customer.tenantId, customer.displayName }
 */
async function listarRelacoesAtivas() {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    const url = `${GRAPH_BASE_URL}/tenantRelationships/delegatedAdminRelationships?$filter=status eq 'active'&$select=id,displayName,status,customer,duration,createdDateTime`;
    const resp = await axios.get(url, { headers, timeout: GRAPH_TIMEOUT });
    return resp.data.value || [];
}

// ===== CONSULTAR STATUS DE UMA RELAÇÃO GDAP =====
async function consultarRelacao(relationshipId) {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    const url = `${GRAPH_BASE_URL}/tenantRelationships/delegatedAdminRelationships/${encodeURIComponent(relationshipId)}`;
    const resp = await axios.get(url, { headers, timeout: GRAPH_TIMEOUT });
    return resp.data;
}

// ===== LER LICENÇAS DO CLIENTE VIA GDAP =====
/**
 * Usa a relação GDAP para acessar o tenant do cliente e ler subscribedSkus.
 * 
 * Estratégia (em ordem):
 * 1. Endpoint delegado: GET /tenantRelationships/delegatedAdminCustomers/{id}/subscribedSkus
 *    (requer token do partner + relação GDAP ativa com License Reader)
 * 2. Fallback: acquireTokenByClientCredential apontando para o tenant do cliente
 *    (requer que o app esteja registrado como multi-tenant E Directory Readers via GDAP)
 * 
 * Inclui retry com backoff, pois licenças podem demorar minutos para aparecer no Graph
 * após o aceite do link de revenda.
 * 
 * @param {string} customerTenantId - Tenant ID do cliente (vem da relação GDAP)
 * @param {object} [options]
 * @param {number} [options.retries] - Número de tentativas (padrão: LICENSE_RETRY_ATTEMPTS)
 * @param {number} [options.retryDelayMs] - Delay entre tentativas em ms (padrão: LICENSE_RETRY_DELAY_MS)
 * @returns {Array} Lista de licenças { skuPartNumber, skuId, capabilityStatus, total, consumed, available, servicePlans }
 */
async function lerLicencasCliente(customerTenantId, options = {}) {
    const maxRetries = options.retries ?? LICENSE_RETRY_ATTEMPTS;
    const retryDelay = options.retryDelayMs ?? LICENSE_RETRY_DELAY_MS;

    // Obter token do partner (no tenant do partner)
    const token = await getAccessToken();

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // --- Método 1: Endpoint delegado GDAP (recomendado pela Microsoft) ---
        try {
            const delegatedUrl = `${GRAPH_BASE_URL}/tenantRelationships/delegatedAdminCustomers/${encodeURIComponent(customerTenantId)}/subscribedSkus`;
            console.log(`[GDAP] Tentativa ${attempt}/${maxRetries} — lendo subscribedSkus via endpoint delegado...`);

            const resp = await axios.get(delegatedUrl, {
                headers: { Authorization: `Bearer ${token}` },
                timeout: GRAPH_TIMEOUT,
            });

            const licencas = parseSubscribedSkus(resp.data?.value || []);
            if (licencas.length > 0) {
                console.log(`[GDAP] ✅ ${licencas.length} licença(s) encontrada(s) via endpoint delegado`);
                return licencas;
            }

            console.log(`[GDAP] Endpoint delegado retornou 0 licenças (tentativa ${attempt})`);
        } catch (e) {
            lastError = e;
            const code = e.response?.status;
            const msg = e.response?.data?.error?.message || e.message;
            console.log(`[GDAP] Endpoint delegado falhou (${code}): ${msg}`);

            // 403/401 = sem permissão, tentar fallback imediatamente
            if (code === 403 || code === 401) break;
        }

        // --- Método 2: Fallback — token direto no tenant do cliente ---
        try {
            console.log(`[GDAP] Tentativa ${attempt}/${maxRetries} — fallback via token no tenant do cliente...`);
            const customerMsal = new msal.ConfidentialClientApplication({
                auth: {
                    clientId: process.env.GDAP_CLIENT_ID,
                    clientSecret: process.env.GDAP_CLIENT_SECRET,
                    authority: `https://login.microsoftonline.com/${customerTenantId}`,
                },
            });
            const customerToken = await customerMsal.acquireTokenByClientCredential({
                scopes: [GRAPH_SCOPE],
            });

            if (customerToken?.accessToken) {
                const resp = await axios.get(`${GRAPH_BASE_URL}/subscribedSkus`, {
                    headers: { Authorization: `Bearer ${customerToken.accessToken}` },
                    timeout: GRAPH_TIMEOUT,
                });

                const licencas = parseSubscribedSkus(resp.data?.value || []);
                if (licencas.length > 0) {
                    console.log(`[GDAP] ✅ ${licencas.length} licença(s) encontrada(s) via fallback (token do cliente)`);
                    return licencas;
                }
                console.log(`[GDAP] Fallback retornou 0 licenças (tentativa ${attempt})`);
            }
        } catch (e) {
            lastError = e;
            console.log(`[GDAP] Fallback falhou: ${e.response?.data?.error?.message || e.message}`);
        }

        // Esperar antes de tentar novamente (exceto na última tentativa)
        if (attempt < maxRetries) {
            console.log(`[GDAP] Aguardando ${retryDelay / 1000}s antes da próxima tentativa...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    // Todas as tentativas falharam
    const errMsg = lastError?.response?.data?.error?.message || lastError?.message || 'Erro desconhecido';
    throw new Error(
        `Não foi possível ler licenças do tenant ${customerTenantId} após ${maxRetries} tentativa(s). ` +
        `Verifique se a relação GDAP está ativa e aceita com as roles License Reader + Directory Readers. Erro: ${errMsg}`
    );
}

/**
 * Converte o array de subscribedSkus do Graph para o formato normalizado.
 */
function parseSubscribedSkus(skusRaw) {
    return skusRaw.map(sku => ({
        skuId: sku.skuId,
        skuPartNumber: sku.skuPartNumber,
        capabilityStatus: sku.capabilityStatus,
        appliesTo: sku.appliesTo,
        total: sku.prepaidUnits?.enabled || 0,
        warning: sku.prepaidUnits?.warning || 0,
        suspended: sku.prepaidUnits?.suspended || 0,
        consumed: sku.consumedUnits || 0,
        available: (sku.prepaidUnits?.enabled || 0) - (sku.consumedUnits || 0),
        servicePlans: (sku.servicePlans || []).map(sp => ({
            servicePlanId: sp.servicePlanId,
            servicePlanName: sp.servicePlanName,
            provisioningStatus: sp.provisioningStatus,
            appliesTo: sp.appliesTo,
        })),
    }));
}

// ===== VERIFICAR CONFIGURAÇÃO =====
function isGdapConfigured() {
    return !!(
        process.env.GDAP_TENANT_ID &&
        process.env.GDAP_CLIENT_ID &&
        process.env.GDAP_CLIENT_SECRET
    );
}

module.exports = {
    criarConviteGDAP,
    isGdapConfigured,
    getAccessToken,
    listarRelacoesAtivas,
    consultarRelacao,
    lerLicencasCliente,
};
