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
};
