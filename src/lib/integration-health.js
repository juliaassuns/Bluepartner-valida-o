/**
 * integration-health.js — Testes reais de conectividade para integrações
 * 
 * Apenas Graph e GDAP executam chamadas reais de API.
 * Demais integrações retornam apenas status de configuração.
 */
const { getAccessToken: getGdapAccessToken, listarRelacoesAtivas } = require('../gdap');
const axios = require('axios');
const msal = require('@azure/msal-node');

const TEST_TIMEOUT = 10000; // 10s por teste

// Definição centralizada dos status para consistência
const STATUS = {
    CONFIG: {
        OK: '✅ Configurada',
        PARTIAL: '⚠️ Parcial',
        MISSING: '❌ Ausente',
    },
    CONNECTIVITY: {
        OK: '🟢 Operacional',
        ERROR: '🟠 Erro',
        UNTESTED: '⚪ Não Testado',
    },
};

async function withTimeout(promise, label) {
    let timer;
    const raced = Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timeout (${TEST_TIMEOUT}ms) — ${label}`)), TEST_TIMEOUT);
        })
    ]);
    try {
        return await raced;
    } finally {
        clearTimeout(timer);
    }
}

function checkEnvVars(vars) {
    const missing = vars.filter(v => !process.env[v]);
    const configured = missing.length === 0;
    // Considera parcial se nem todas, mas pelo menos uma variável estiver presente (e houver mais de uma var total)
    const partial = !configured && vars.length > 1 && missing.length < vars.length;
    return {
        configured,
        partial,
        missingVars: missing
    };
}

// ===== MICROSOFT GRAPH =====
async function testGraphHealth() {
    const cfg = checkEnvVars(['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET']);
    if (!cfg.configured) {
        return {
            configStatus: STATUS.CONFIG.MISSING,
            connectivityStatus: STATUS.CONNECTIVITY.UNTESTED,
            details: `Variáveis ausentes: ${cfg.missingVars.join(', ')}`
        };
    }

    const start = performance.now();
    try {
        // CORREÇÃO: Usa as credenciais ENTRA_* para obter um token específico para este teste,
        // em vez de depender do getAccessToken do gdap.js que usa credenciais GDAP_*.
        const msalConfig = {
            auth: {
                clientId: process.env.ENTRA_CLIENT_ID,
                clientSecret: process.env.ENTRA_CLIENT_SECRET,
                authority: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}`,
            },
        };
        const msalClient = new msal.ConfidentialClientApplication(msalConfig);
        
        const tokenResponse = await withTimeout(
            msalClient.acquireTokenByClientCredential({
                scopes: ['https://graph.microsoft.com/.default'],
            }),
            'Graph: acquireToken'
        );

        if (!tokenResponse || !tokenResponse.accessToken) {
            throw new Error('Falha ao obter token de acesso (nulo ou inválido)');
        }

        const token = tokenResponse.accessToken;

        // O endpoint /me requer um token delegado (em nome de um usuário).
        // Para um teste de credencial de cliente (App-Only), é melhor usar /servicePrincipals.
        // Vamos testar buscando o próprio Service Principal do aplicativo.
        const appObjectId = msalClient.getAppMetadata().appId;
        await withTimeout(
            axios.get(`https://graph.microsoft.com/v1.0/servicePrincipals(appId='${appObjectId}')`, {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 8000
            }),
            'Graph: GET /servicePrincipals'
        );

        const elapsed = performance.now() - start;
        return {
            configStatus: STATUS.CONFIG.OK,
            connectivityStatus: STATUS.CONNECTIVITY.OK,
            details: `Tenant: ${(process.env.ENTRA_TENANT_ID || '').slice(0, 8)}...`,
            durationMs: Math.round(elapsed),
        };
    } catch (err) {
        const elapsed = performance.now() - start;
        const errorMessage = err.response?.data?.error?.message || err.message || 'Erro desconhecido durante o teste de conectividade.';
        return {
            configStatus: STATUS.CONFIG.OK,
            connectivityStatus: STATUS.CONNECTIVITY.ERROR,
            details: errorMessage,
            durationMs: Math.round(elapsed),
        };
    }
}

// ===== GDAP =====
async function testGdapHealth() {
    const cfg = checkEnvVars(['GDAP_TENANT_ID', 'GDAP_CLIENT_ID', 'GDAP_CLIENT_SECRET']);
    if (!cfg.configured) {
        return {
            configStatus: cfg.partial ? STATUS.CONFIG.PARTIAL : STATUS.CONFIG.MISSING,
            connectivityStatus: STATUS.CONNECTIVITY.UNTESTED,
            details: `Variáveis ausentes: ${cfg.missingVars.join(', ')}`,
        };
    }

    const start = performance.now();
    try {
        // Renomeado para maior clareza, já que agora temos uma lógica de token local para o Graph.
        const relacoes = await withTimeout(listarRelacoesAtivas(), 'GDAP: listarRelacoesAtivas');
        const elapsed = performance.now() - start;
        return {
            configStatus: STATUS.CONFIG.OK,
            connectivityStatus: STATUS.CONNECTIVITY.OK,
            details: `Relações ativas encontradas: ${Array.isArray(relacoes) ? relacoes.length : 0}`,
            durationMs: Math.round(elapsed),
        };
    } catch (err) {
        const elapsed = performance.now() - start;
        return {
            configStatus: STATUS.CONFIG.OK,
            connectivityStatus: STATUS.CONNECTIVITY.ERROR,
            details: err.message || 'Erro desconhecido ao listar relações GDAP.',
            durationMs: Math.round(elapsed),
        };
    }
}

// ===== Funções de verificação de configuração (sem teste de conectividade) =====

function createConfigCheck(envVars, detailsFn) {
    return () => {
        const cfg = checkEnvVars(envVars);
        
        let configStatus;
        if (envVars.length === 0) {
            configStatus = STATUS.CONFIG.OK;
        } else {
            configStatus = cfg.configured ? STATUS.CONFIG.OK : (cfg.partial ? STATUS.CONFIG.PARTIAL : STATUS.CONFIG.MISSING);
        }

        let details = cfg.missingVars.length > 0 ? `Variáveis ausentes: ${cfg.missingVars.join(', ')}` : 'N/A';
        if (cfg.configured && detailsFn) {
            details = detailsFn();
        }

        return {
            configStatus,
            connectivityStatus: STATUS.CONNECTIVITY.UNTESTED,
            details
        };
    };
}

const checkIngramConfig = createConfigCheck(['INGRAM_CLIENT_ID', 'INGRAM_CLIENT_SECRET']);
const checkTdsConfig = createConfigCheck(['TDS_CLIENT_ID', 'TDS_CLIENT_SECRET']);
const checkPartnerCenterConfig = createConfigCheck(['ADMINCENTER_CLIENT_ID', 'ADMINCENTER_CLIENT_SECRET', 'ADMINCENTER_TENANT_ID']);
const checkFabricConfig = createConfigCheck(
    ['FABRIC_SQL_SERVER', 'FABRIC_SQL_DATABASE', 'FABRIC_WORKSPACE_ID', 'ENTRA_TENANT_ID'],
    () => `Workspace: ${(process.env.FABRIC_WORKSPACE_ID || 'N/A').slice(0, 8)}...`
);
const checkOneLakeConfig = createConfigCheck(['FABRIC_WORKSPACE_ID'], () => `Workspace: ${(process.env.FABRIC_WORKSPACE_ID || 'N/A').slice(0, 8)}...`);
const checkPowerBiConfig = createConfigCheck(['POWERBI_WORKSPACE_ID', 'POWERBI_DATASET_ID'], () => `Workspace: ${(process.env.POWERBI_WORKSPACE_ID || 'N/A').slice(0, 8)}...`);

function checkEntraConfig() {
    const cfg = checkEnvVars(['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET']);
    return {
        configStatus: cfg.configured ? STATUS.CONFIG.OK : STATUS.CONFIG.MISSING,
        connectivityStatus: STATUS.CONNECTIVITY.UNTESTED,
        details: cfg.configured ? `Tenant: ${(process.env.ENTRA_TENANT_ID || '').slice(0, 8)}...` : `Variáveis ausentes: ${cfg.missingVars.join(', ')}`
    };
}


// ===== EXECUTAR TODOS OS TESTES =====
async function runAll() {
    const integrations = {
        'Microsoft Graph': testGraphHealth(),
        'GDAP': testGdapHealth(),
        'Ingram': Promise.resolve(checkIngramConfig()),
        'TD SYNNEX': Promise.resolve(checkTdsConfig()),
        'Fabric': Promise.resolve(checkFabricConfig()),
        'OneLake': Promise.resolve(checkOneLakeConfig()),
        'Power BI': Promise.resolve(checkPowerBiConfig()),
        'Partner Center': Promise.resolve(checkPartnerCenterConfig()),
        'Entra ID': Promise.resolve(checkEntraConfig())
    };

    const results = await Promise.all(
        Object.values(integrations).map(p => p.catch(e => ({
            configStatus: STATUS.CONFIG.OK, // Assume config is OK if test fails catastrophically
            connectivityStatus: STATUS.CONNECTIVITY.ERROR,
            details: `Falha interna no teste: ${e.message}`,
        })))
    );

    const healthStatus = {};
    Object.keys(integrations).forEach((name, index) => {
        healthStatus[name] = results[index];
    });
    
    return healthStatus;
}


module.exports = { runAll, testGraphHealth, testGdapHealth };
