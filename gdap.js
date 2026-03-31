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
const DEFAULT_DURATION = 'P730D';          // 730 dias (máximo)

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
                { roleDefinitionId: LICENSE_READER_ROLE_ID }
            ],
        },
    };

    let relationship;
    try {
        const resp = await axios.post(createUrl, createBody, { headers });
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
        await axios.post(lockUrl, lockBody, { headers });
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
    const resp = await axios.get(url, { headers });
    return resp.data.value || [];
}

// ===== CONSULTAR STATUS DE UMA RELAÇÃO GDAP =====
async function consultarRelacao(relationshipId) {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    const url = `${GRAPH_BASE_URL}/tenantRelationships/delegatedAdminRelationships/${encodeURIComponent(relationshipId)}`;
    const resp = await axios.get(url, { headers });
    return resp.data;
}

// ===== LER LICENÇAS DO CLIENTE VIA GDAP =====
/**
 * Usa a relação GDAP para acessar o tenant do cliente e ler subscribedSkus.
 * Requer que a relação esteja ativa e a role License Reader.
 * 
 * @param {string} customerTenantId - Tenant ID do cliente (vem da relação GDAP)
 * @returns {Array} Lista de licenças { skuPartNumber, skuId, capabilityStatus, total, consumed, available, servicePlans }
 */
async function lerLicencasCliente(customerTenantId) {
    // Obter token delegado para o tenant do cliente usando GDAP
    const client = getMsalClient();

    const result = await client.acquireTokenByClientCredential({
        scopes: [GRAPH_SCOPE],
        azureRegion: undefined,
    });

    if (!result || !result.accessToken) {
        throw new Error('Falha ao obter token para consultar licenças');
    }

    const token = result.accessToken;
    const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    // Usar endpoint delegatedAdminCustomer para acessar dados do cliente
    const url = `${GRAPH_BASE_URL}/tenantRelationships/delegatedAdminCustomers/${encodeURIComponent(customerTenantId)}/serviceManagementDetails`;
    
    // Primeiro tentar subscribedSkus via delegated admin
    const skuUrl = `https://graph.microsoft.com/v1.0/tenantRelationships/delegatedAdminCustomers/${encodeURIComponent(customerTenantId)}/serviceManagementDetails`;
    
    // A API correta para ler licenças via GDAP é usar o Graph com header do customer tenant
    const licUrl = `https://graph.microsoft.com/v1.0/subscribedSkus`;
    
    // Para acessar dados do cliente via GDAP, usamos o header X-AnchorTenantId
    const customerHeaders = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    // Tentar via endpoint de contrato delegado
    try {
        // Método 1: usar /contracts para encontrar o tenant e depois ler SKUs
        const contractsUrl = `https://graph.microsoft.com/v1.0/contracts?$filter=customerId eq '${customerTenantId}'`;
        const contractResp = await axios.get(contractsUrl, { headers });
        console.log(`[GDAP] Contrato encontrado para tenant ${customerTenantId}`);
    } catch (e) {
        // Normal falhar se não tiver permissão de contracts
    }

    // Método via GDAP: acessar subscribedSkus usando acquireTokenOnBehalfOf com GDAP
    // Para partner center/CSP, a forma correta é usar o token do partner com GDAP ativo
    const partnerAccessUrl = `https://graph.microsoft.com/v1.0/tenantRelationships/delegatedAdminCustomers/${encodeURIComponent(customerTenantId)}/serviceManagementDetails`;
    
    let serviceDetails = [];
    try {
        const svcResp = await axios.get(partnerAccessUrl, { headers });
        serviceDetails = svcResp.data.value || [];
    } catch (e) {
        console.log(`[GDAP] serviceManagementDetails não disponível: ${e.message}`);
    }

    // Ler subscribedSkus usando o token com GDAP (o Graph API redireciona automaticamente via relação GDAP)
    // A forma recomendada pela Microsoft é fazer request com o accessToken do partner
    // e o header de delegação
    const skus = [];
    try {
        // Para GDAP, a API é acessada diretamente no contexto do partner com o tenantId do cliente
        const skuEndpoint = `https://graph.microsoft.com/v1.0/tenantRelationships/delegatedAdminCustomers/${encodeURIComponent(customerTenantId)}/serviceManagementDetails`;
        const resp2 = await axios.get(skuEndpoint, { headers });
        
        // Se tiver resultado, converter para formato de licenças
        if (resp2.data && resp2.data.value) {
            for (const svc of resp2.data.value) {
                skus.push({
                    serviceManagementUrl: svc.serviceManagementUrl,
                    serviceName: svc.serviceName,
                    id: svc.id,
                });
            }
        }
    } catch (e) {
        console.log(`[GDAP] Erro ao ler service details: ${e.message}`);
    }

    // Tentar ler subscribedSkus diretamente (funciona quando GDAP está ativo com License Reader)
    // Usando acquireTokenByClientCredential com authority do tenant do cliente
    try {
        const customerMsalConfig = {
            auth: {
                clientId: process.env.GDAP_CLIENT_ID,
                clientSecret: process.env.GDAP_CLIENT_SECRET,
                authority: `https://login.microsoftonline.com/${customerTenantId}`,
            },
        };
        const customerMsal = new msal.ConfidentialClientApplication(customerMsalConfig);
        const customerToken = await customerMsal.acquireTokenByClientCredential({
            scopes: [GRAPH_SCOPE],
        });

        if (customerToken && customerToken.accessToken) {
            const skuResp = await axios.get('https://graph.microsoft.com/v1.0/subscribedSkus', {
                headers: { Authorization: `Bearer ${customerToken.accessToken}` },
            });

            const licencas = (skuResp.data.value || []).map(sku => ({
                skuId: sku.skuId,
                skuPartNumber: sku.skuPartNumber,
                capabilityStatus: sku.capabilityStatus, // Enabled, Suspended, Deleted
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

            return licencas;
        }
    } catch (e) {
        console.error(`[GDAP] Falha ao ler subscribedSkus do tenant ${customerTenantId}: ${e.response?.data?.error?.message || e.message}`);
        throw new Error(`Não foi possível ler licenças do tenant ${customerTenantId}. Verifique se a relação GDAP está ativa e aceita. Erro: ${e.response?.data?.error?.message || e.message}`);
    }

    return [];
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
