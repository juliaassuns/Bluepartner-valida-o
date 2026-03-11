/**
 * Script para descobrir workspaces, datasets e lakehouses do Fabric/Power BI
 * Usa as mesmas credenciais do .env (ENTRA_* ou FABRIC_*)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const msal = require('@azure/msal-node');
const axios = require('axios');

const TENANT_ID = process.env.FABRIC_TENANT_ID || process.env.ENTRA_TENANT_ID;
const CLIENT_ID = process.env.FABRIC_CLIENT_ID || process.env.ENTRA_CLIENT_ID;
const CLIENT_SECRET = process.env.FABRIC_CLIENT_SECRET || process.env.ENTRA_CLIENT_SECRET;

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ Credenciais não encontradas. Preencha ENTRA_* ou FABRIC_* no .env');
    process.exit(1);
}

const msalApp = new msal.ConfidentialClientApplication({
    auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        clientSecret: CLIENT_SECRET
    }
});

async function getToken(scope) {
    const result = await msalApp.acquireTokenByClientCredential({ scopes: [scope] });
    return result.accessToken;
}

async function discover() {
    console.log('🔍 Descobrindo recursos Fabric / Power BI...\n');
    console.log(`   Tenant: ${TENANT_ID}`);
    console.log(`   Client: ${CLIENT_ID}\n`);

    // 1. Tentar Fabric REST API
    console.log('═══════════════════════════════════════');
    console.log('  FABRIC REST API (workspaces/itens)');
    console.log('═══════════════════════════════════════');
    try {
        const fabricToken = await getToken('https://api.fabric.microsoft.com/.default');
        console.log('✅ Token Fabric obtido\n');

        const wsResp = await axios.get('https://api.fabric.microsoft.com/v1/workspaces', {
            headers: { 'Authorization': `Bearer ${fabricToken}` },
            timeout: 30000
        });
        const workspaces = wsResp.data?.value || [];
        console.log(`📂 ${workspaces.length} workspace(s) encontrado(s):\n`);
        
        for (const ws of workspaces) {
            console.log(`   [${ws.id}] ${ws.displayName} (${ws.type || 'Workspace'})`);
            
            // Listar itens do workspace
            try {
                const itemsResp = await axios.get(`https://api.fabric.microsoft.com/v1/workspaces/${ws.id}/items`, {
                    headers: { 'Authorization': `Bearer ${fabricToken}` },
                    timeout: 30000
                });
                const items = itemsResp.data?.value || [];
                if (items.length > 0) {
                    for (const item of items) {
                        console.log(`      ├─ [${item.type}] ${item.displayName} (${item.id})`);
                    }
                }
            } catch (e) {
                console.log(`      ⚠️ Sem permissão para listar itens: ${e.response?.data?.message || e.message}`);
            }
            console.log('');
        }
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
        console.log(`❌ Fabric REST API falhou: ${msg}`);
        if (msg.includes('AADSTS') || msg.includes('permission') || msg.includes('consent')) {
            console.log('\n💡 Possível solução:');
            console.log('   1. Acesse https://portal.azure.com → App Registrations → sua app');
            console.log('   2. Em "API Permissions", adicione:');
            console.log('      - Power BI Service → Tenant.Read.All (Application)');
            console.log('      - Se usar Fabric: Microsoft Fabric → Workspace.Read.All');
            console.log('   3. Clique "Grant admin consent"');
        }
        console.log('');
    }

    // 2. Tentar Power BI REST API
    console.log('═══════════════════════════════════════');
    console.log('  POWER BI REST API (grupos/datasets)');
    console.log('═══════════════════════════════════════');
    try {
        const pbiToken = await getToken('https://analysis.windows.net/powerbi/api/.default');
        console.log('✅ Token Power BI obtido\n');

        // Listar grupos (workspaces PBI)
        const groupsResp = await axios.get('https://api.powerbi.com/v1.0/myorg/groups', {
            headers: { 'Authorization': `Bearer ${pbiToken}` },
            timeout: 30000
        });
        const groups = groupsResp.data?.value || [];
        console.log(`📊 ${groups.length} workspace(s) Power BI:\n`);

        for (const g of groups) {
            console.log(`   [${g.id}] ${g.name}`);

            // Listar datasets do workspace
            try {
                const dsResp = await axios.get(`https://api.powerbi.com/v1.0/myorg/groups/${g.id}/datasets`, {
                    headers: { 'Authorization': `Bearer ${pbiToken}` },
                    timeout: 30000
                });
                const datasets = dsResp.data?.value || [];
                for (const ds of datasets) {
                    console.log(`      ├─ [Dataset] ${ds.name} (${ds.id})`);
                    
                    // Tentar listar tabelas do dataset
                    try {
                        const tblResp = await axios.get(`https://api.powerbi.com/v1.0/myorg/datasets/${ds.id}/tables`, {
                            headers: { 'Authorization': `Bearer ${tblResp}` },
                            timeout: 15000
                        });
                        const tables = tblResp.data?.value || [];
                        for (const t of tables) {
                            console.log(`      │  └─ [Table] ${t.name}`);
                        }
                    } catch (_) { /* tabelas não listáveis diretamente */ }
                }
            } catch (e) {
                console.log(`      ⚠️ ${e.response?.data?.error?.message || e.message}`);
            }
            console.log('');
        }
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
        console.log(`❌ Power BI API falhou: ${msg}`);
        if (msg.includes('AADSTS') || msg.includes('permission') || msg.includes('consent')) {
            console.log('\n💡 Possível solução:');
            console.log('   1. No App Registration, adicione permissão:');
            console.log('      Power BI Service → Dataset.Read.All, Workspace.Read.All (Application)');
            console.log('   2. Conceda "Admin Consent"');
        }
        console.log('');
    }

    // 3. Resumo de configuração .env
    console.log('═══════════════════════════════════════');
    console.log('  CONFIG SUGERIDA PARA .env');
    console.log('═══════════════════════════════════════');
    console.log('# Cole no .env os IDs que encontrou acima:');
    console.log('# FABRIC_WORKSPACE_ID=<id-do-workspace>');
    console.log('# POWERBI_WORKSPACE_ID=<id-do-workspace-pbi>');
    console.log('# POWERBI_DATASET_ID=<id-do-dataset>');
    console.log('# FABRIC_SQL_SERVER=<workspace>.datawarehouse.fabric.microsoft.com');
    console.log('# FABRIC_SQL_DATABASE=<nome-do-lakehouse>');
}

discover().catch(err => {
    console.error('💥 Erro fatal:', err.message);
    process.exit(1);
});
