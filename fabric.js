/**
 * fabric.js — Integração com Microsoft Fabric / Power BI / OneLake
 * 
 * Dois modos de autenticação:
 * 1. Client Credentials (Service Principal) — precisa de permissões Application no Azure AD
 * 2. Delegated (On-Behalf-Of) — usa o token do usuário logado, funciona sem admin consent
 *    se o usuário já tem acesso ao Power BI/Fabric
 * 
 * Scopes:
 * - https://analysis.windows.net/powerbi/api/.default (Power BI)
 * - https://api.fabric.microsoft.com/.default (Fabric REST API)
 * - https://database.windows.net/.default (SQL endpoint)
 */

const sql = require('mssql');
const msal = require('@azure/msal-node');
const axios = require('axios');

// ===== CONFIG =====
const FABRIC_SQL_SERVER   = process.env.FABRIC_SQL_SERVER   || '';   // ex: xpto.datawarehouse.fabric.microsoft.com
const FABRIC_SQL_DATABASE = process.env.FABRIC_SQL_DATABASE || '';   // nome do Lakehouse/Warehouse
const POWERBI_WORKSPACE_ID = process.env.POWERBI_WORKSPACE_ID || '';
const POWERBI_DATASET_ID   = process.env.POWERBI_DATASET_ID   || '';
const FABRIC_WORKSPACE_ID  = process.env.FABRIC_WORKSPACE_ID  || POWERBI_WORKSPACE_ID; // Workspace do OneLake

// Credenciais (pode reaproveitar as do GDAP ou ter suas próprias)
const FABRIC_TENANT_ID     = process.env.FABRIC_TENANT_ID     || process.env.ENTRA_TENANT_ID || '';
const FABRIC_CLIENT_ID     = process.env.FABRIC_CLIENT_ID     || process.env.ENTRA_CLIENT_ID || '';
const FABRIC_CLIENT_SECRET = process.env.FABRIC_CLIENT_SECRET || process.env.ENTRA_CLIENT_SECRET || '';

let msalApp = null;

function getMsalApp() {
    if (msalApp) return msalApp;
    if (!FABRIC_TENANT_ID || !FABRIC_CLIENT_ID || !FABRIC_CLIENT_SECRET) return null;
    msalApp = new msal.ConfidentialClientApplication({
        auth: {
            clientId: FABRIC_CLIENT_ID,
            authority: `https://login.microsoftonline.com/${FABRIC_TENANT_ID}`,
            clientSecret: FABRIC_CLIENT_SECRET
        }
    });
    return msalApp;
}

/**
 * Obtém token via client credentials (Service Principal)
 */
async function getToken(scope) {
    const app = getMsalApp();
    if (!app) throw new Error('Fabric/MSAL não configurado');
    const result = await app.acquireTokenByClientCredential({ scopes: [scope] });
    return result.accessToken;
}

/**
 * Obtém token delegado via On-Behalf-Of (usando token do usuário logado)
 * @param {string} userAccessToken - Token de acesso do usuário (obtido no login)
 * @param {string} scope - Scope desejado (ex: Power BI, Fabric)
 */
async function getDelegatedToken(userAccessToken, scope) {
    const app = getMsalApp();
    if (!app) throw new Error('Fabric/MSAL não configurado');
    const result = await app.acquireTokenOnBehalfOf({
        oboAssertion: userAccessToken,
        scopes: [scope]
    });
    return result.accessToken;
}

/**
 * Resolve o melhor token:
 * 1. Se userToken fornecido → usa direto (o access token já tem scopes Power BI)
 * 2. Fallback → client credentials
 */
async function resolveToken(scope, userToken) {
    // O token delegado do login já contém scopes do Power BI — usa direto
    if (userToken) {
        return userToken;
    }
    return await getToken(scope);
}

// ===== FABRIC SQL ENDPOINT =====
let sqlPool = null;

/**
 * Conecta ao Fabric SQL (Lakehouse/Warehouse) via TDS
 */
async function getSqlPool() {
    if (sqlPool) return sqlPool;
    if (!FABRIC_SQL_SERVER || !FABRIC_SQL_DATABASE) {
        throw new Error('FABRIC_SQL_SERVER e FABRIC_SQL_DATABASE não configurados');
    }

    const token = await getToken('https://database.windows.net/.default');

    sqlPool = await sql.connect({
        server: FABRIC_SQL_SERVER,
        database: FABRIC_SQL_DATABASE,
        options: {
            encrypt: true,
            trustServerCertificate: false
        },
        authentication: {
            type: 'azure-active-directory-access-token',
            options: { token }
        },
        pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
        requestTimeout: 60000
    });

    // Reconecta se perder a conexão
    sqlPool.on('error', (err) => {
        console.error('❌ Fabric SQL pool error:', err.message);
        sqlPool = null;
    });

    return sqlPool;
}

/**
 * Executa uma query SQL no Fabric
 */
async function fabricSqlQuery(queryText, params = {}) {
    const pool = await getSqlPool();
    const request = pool.request();
    for (const [key, val] of Object.entries(params)) {
        request.input(key, val);
    }
    return request.query(queryText);
}

/**
 * Fecha a conexão SQL
 */
async function closeSqlPool() {
    if (sqlPool) {
        await sqlPool.close();
        sqlPool = null;
    }
}

// ===== POWER BI REST API =====

/**
 * Executa uma query DAX contra um dataset do Power BI
 */
async function executeDaxQuery(daxQuery, datasetId) {
    const dsId = datasetId || POWERBI_DATASET_ID;
    if (!dsId) throw new Error('POWERBI_DATASET_ID não configurado');

    const token = await getToken('https://analysis.windows.net/powerbi/api/.default');
    const url = `https://api.powerbi.com/v1.0/myorg/datasets/${dsId}/executeQueries`;

    const resp = await axios.post(url, {
        queries: [{ query: daxQuery }],
        serializerSettings: { includeNulls: true }
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        timeout: 60000
    });

    // Retorna as rows da primeira tabela
    const tables = resp.data?.results?.[0]?.tables || [];
    return tables.length > 0 ? tables[0].rows : [];
}

/**
 * Lista datasets de um workspace PBI
 */
async function listDatasets(workspaceId, userToken) {
    const wsId = workspaceId || POWERBI_WORKSPACE_ID;
    if (!wsId) throw new Error('POWERBI_WORKSPACE_ID não configurado');

    const token = await resolveToken('https://analysis.windows.net/powerbi/api/.default', userToken);
    const url = `https://api.powerbi.com/v1.0/myorg/groups/${wsId}/datasets`;

    const resp = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 30000
    });

    return (resp.data?.value || []).map(ds => ({
        id: ds.id,
        name: ds.name,
        configuredBy: ds.configuredBy,
        isRefreshable: ds.isRefreshable,
        webUrl: ds.webUrl
    }));
}

/**
 * Lista tabelas de um dataset
 */
async function listDatasetTables(datasetId) {
    const dsId = datasetId || POWERBI_DATASET_ID;
    if (!dsId) throw new Error('POWERBI_DATASET_ID não configurado');

    const token = await getToken('https://analysis.windows.net/powerbi/api/.default');
    const url = `https://api.powerbi.com/v1.0/myorg/datasets/${dsId}/tables`;

    const resp = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 30000
    });

    return (resp.data?.value || []).map(t => ({
        name: t.name,
        columns: (t.columns || []).map(c => ({ name: c.name, dataType: c.dataType }))
    }));
}

// ===== SYNC: importar revendas do Fabric =====

/**
 * Importa revendas de uma tabela Fabric SQL
 * @param {string} tableName - nome da tabela/view no Fabric
 * @param {object} columnMap - mapeamento: { nome: 'NomeColuna', partner_id: 'PartnerIdCol', link_base: 'LinkCol' }
 */
async function syncRevendasFromFabric(tableName, columnMap, dbRun, dbGet) {
    // Sanitiza nome da tabela (só permite alfanuméricos, _, ., [])
    if (!/^[\w.\[\]]+$/.test(tableName)) {
        throw new Error('Nome de tabela inválido');
    }

    const colNome = columnMap.nome || 'Nome';
    const colPartnerId = columnMap.partner_id || 'PartnerId';
    const colLinkBase = columnMap.link_base || 'LinkBase';

    const pool = await getSqlPool();
    const result = await pool.request().query(
        `SELECT [${colNome}] AS nome, [${colPartnerId}] AS partner_id, [${colLinkBase}] AS link_base FROM [${tableName}]`
    );

    let inserted = 0, updated = 0, skipped = 0;

    for (const row of result.recordset) {
        if (!row.nome) { skipped++; continue; }

        const existing = await dbGet('SELECT id FROM revendas WHERE LOWER(nome) = LOWER(?)', [row.nome.trim()]);
        if (existing) {
            await dbRun(
                'UPDATE revendas SET partner_id = COALESCE(?, partner_id), link_base = COALESCE(?, link_base) WHERE id = ?',
                [row.partner_id || '', row.link_base || '', existing.id]
            );
            updated++;
        } else {
            await dbRun(
                'INSERT INTO revendas (nome, partner_id, link_base, ativo) VALUES (?, ?, ?, 1)',
                [row.nome.trim(), row.partner_id || '', row.link_base || '']
            );
            inserted++;
        }
    }

    return { total: result.recordset.length, inserted, updated, skipped };
}

// ===== ONELAKE CATALOG (Fabric REST API) =====

const FABRIC_API_BASE = 'https://api.fabric.microsoft.com/v1';

/**
 * Lista workspaces acessíveis (delegado ou service principal)
 * @param {string} [userToken] - Token do usuário para fluxo delegado
 */
async function listWorkspaces(userToken) {
    const token = await resolveToken('https://api.fabric.microsoft.com/.default', userToken);
    const resp = await axios.get(`${FABRIC_API_BASE}/workspaces`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 30000
    });
    return (resp.data?.value || []).map(ws => ({
        id: ws.id,
        displayName: ws.displayName,
        type: ws.type,
        capacityId: ws.capacityId
    }));
}

/**
 * Lista itens de um workspace (Lakehouses, Warehouses, Datasets, etc.)
 * @param {string} [workspaceId] - ID do workspace (usa FABRIC_WORKSPACE_ID se omitido)
 * @param {string} [type] - Filtro de tipo: 'Lakehouse', 'Warehouse', 'SemanticModel', etc.
 * @param {string} [userToken] - Token do usuário para fluxo delegado
 */
async function listWorkspaceItems(workspaceId, type, userToken) {
    const wsId = workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) throw new Error('FABRIC_WORKSPACE_ID não configurado');

    const token = await resolveToken('https://api.fabric.microsoft.com/.default', userToken);
    let url = `${FABRIC_API_BASE}/workspaces/${wsId}/items`;
    if (type) url += `?type=${encodeURIComponent(type)}`;

    const resp = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 30000
    });
    return (resp.data?.value || []).map(item => ({
        id: item.id,
        displayName: item.displayName,
        type: item.type,
        description: item.description || ''
    }));
}

/**
 * Lista lakehouses de um workspace
 */
async function listLakehouses(workspaceId, userToken) {
    return listWorkspaceItems(workspaceId, 'Lakehouse', userToken);
}

/**
 * Lista tabelas de um Lakehouse via Fabric REST API
 * @param {string} lakehouseId - ID do Lakehouse
 * @param {string} [workspaceId] - ID do workspace
 * @param {string} [userToken] - Token do usuário para fluxo delegado
 */
async function listLakehouseTables(lakehouseId, workspaceId, userToken) {
    const wsId = workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) throw new Error('FABRIC_WORKSPACE_ID não configurado');
    if (!lakehouseId) throw new Error('lakehouseId é obrigatório');

    const token = await resolveToken('https://api.fabric.microsoft.com/.default', userToken);
    const url = `${FABRIC_API_BASE}/workspaces/${wsId}/lakehouses/${lakehouseId}/tables`;

    const resp = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 30000
    });
    return (resp.data?.data || []).map(t => ({
        name: t.name,
        location: t.location || '',
        format: t.format || 'delta',
        type: t.type || 'managed'
    }));
}

/**
 * Lista colunas de uma tabela no Lakehouse via SQL endpoint
 * @param {string} tableName - Nome da tabela
 */
async function describeTable(tableName) {
    if (!/^[\w.\[\]]+$/.test(tableName)) {
        throw new Error('Nome de tabela inválido');
    }
    const pool = await getSqlPool();
    const result = await pool.request().query(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName.replace(/[\[\]]/g, '')}' ORDER BY ORDINAL_POSITION`
    );
    return result.recordset.map(c => ({
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === 'YES'
    }));
}

/**
 * Preview: lê as primeiras N linhas de uma tabela do OneLake
 * @param {string} tableName - Nome da tabela
 * @param {number} [limit=50] - Máx. de linhas
 */
async function previewTable(tableName, limit = 50) {
    if (!/^[\w.\[\]]+$/.test(tableName)) {
        throw new Error('Nome de tabela inválido');
    }
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 50), 1000);
    const result = await fabricSqlQuery(`SELECT TOP ${safeLimit} * FROM [${tableName.replace(/[\[\]]/g, '')}]`);
    return { rows: result.recordset, total: result.recordset.length };
}

// ===== STATUS =====

function isFabricConfigured() {
    return {
        sql: !!(FABRIC_SQL_SERVER && FABRIC_SQL_DATABASE),
        powerbi: !!(POWERBI_WORKSPACE_ID || POWERBI_DATASET_ID),
        onelake: !!FABRIC_WORKSPACE_ID,
        credentials: !!(FABRIC_TENANT_ID && FABRIC_CLIENT_ID && FABRIC_CLIENT_SECRET),
        config: {
            sqlServer: FABRIC_SQL_SERVER ? FABRIC_SQL_SERVER.replace(/\..*/, '.***.fabric.microsoft.com') : '',
            sqlDatabase: FABRIC_SQL_DATABASE || '',
            workspaceId: POWERBI_WORKSPACE_ID || '',
            fabricWorkspaceId: FABRIC_WORKSPACE_ID || '',
            datasetId: POWERBI_DATASET_ID || ''
        }
    };
}

module.exports = {
    isFabricConfigured,
    fabricSqlQuery,
    executeDaxQuery,
    listDatasets,
    listDatasetTables,
    syncRevendasFromFabric,
    closeSqlPool,
    getToken,
    getDelegatedToken,
    resolveToken,
    // OneLake Catalog
    listWorkspaces,
    listWorkspaceItems,
    listLakehouses,
    listLakehouseTables,
    describeTable,
    previewTable
};
