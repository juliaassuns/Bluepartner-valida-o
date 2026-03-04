/**
 * Script para adicionar o App Registration ao grupo AdminAgents
 * Usa Device Code Flow (login interativo do usuário)
 * 
 * Uso: node setup-adminagents.js
 */
require('dotenv').config();
const msal = require('@azure/msal-node');
const axios = require('axios');

const TENANT_ID = process.env.GDAP_TENANT_ID;
const APP_CLIENT_ID = process.env.GDAP_CLIENT_ID;

// Client ID público da Microsoft (para login interativo)
const PUBLIC_CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';

async function run() {
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('  🔧 Setup: Adicionar App ao grupo AdminAgents');
    console.log('═══════════════════════════════════════════════════');
    console.log('');

    if (!TENANT_ID || !APP_CLIENT_ID) {
        console.error('❌ GDAP_TENANT_ID e GDAP_CLIENT_ID devem estar no .env');
        process.exit(1);
    }

    // 1. Login interativo via Device Code
    const pca = new msal.PublicClientApplication({
        auth: {
            clientId: PUBLIC_CLIENT_ID,
            authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        },
    });

    console.log('📱 Faça login com sua conta admin do tenant CSP...\n');

    let tokenResult;
    try {
        tokenResult = await pca.acquireTokenByDeviceCode({
            scopes: ['https://graph.microsoft.com/Group.ReadWrite.All', 'https://graph.microsoft.com/Application.Read.All'],
            deviceCodeCallback: (response) => {
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log(`  1. Abra: ${response.verificationUri}`);
                console.log(`  2. Cole o código: ${response.userCode}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('');
                console.log('  Aguardando login...');
            },
        });
    } catch (err) {
        console.error('❌ Erro no login:', err.message);
        process.exit(1);
    }

    console.log(`\n✅ Logado como: ${tokenResult.account?.username || 'OK'}`);

    const headers = {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/json',
    };

    // 2. Buscar grupo AdminAgents
    console.log('\n🔍 Buscando grupo AdminAgents...');
    let groupId;
    try {
        const resp = await axios.get(
            `https://graph.microsoft.com/v1.0/groups?$filter=displayName eq 'AdminAgents'&$select=id,displayName`,
            { headers }
        );
        if (!resp.data.value || resp.data.value.length === 0) {
            console.error('❌ Grupo AdminAgents não encontrado neste tenant.');
            console.error('   Isso pode significar que o tenant não é um tenant CSP do Partner Center.');
            process.exit(1);
        }
        groupId = resp.data.value[0].id;
        console.log(`   Encontrado: ${resp.data.value[0].displayName} (${groupId})`);
    } catch (err) {
        console.error('❌ Erro ao buscar grupo:', err.response?.data?.error?.message || err.message);
        process.exit(1);
    }

    // 3. Buscar Service Principal do app
    console.log(`\n🔍 Buscando Service Principal do app ${APP_CLIENT_ID}...`);
    let spId;
    try {
        const resp = await axios.get(
            `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${APP_CLIENT_ID}'&$select=id,displayName,appId`,
            { headers }
        );
        if (!resp.data.value || resp.data.value.length === 0) {
            console.error('❌ Service Principal não encontrado para o App ID:', APP_CLIENT_ID);
            console.error('   Verifique se o App Registration está no mesmo tenant.');
            process.exit(1);
        }
        spId = resp.data.value[0].id;
        console.log(`   Encontrado: ${resp.data.value[0].displayName} (${spId})`);
    } catch (err) {
        console.error('❌ Erro ao buscar SP:', err.response?.data?.error?.message || err.message);
        process.exit(1);
    }

    // 4. Verificar se já é membro
    console.log('\n🔍 Verificando se já é membro do grupo...');
    try {
        const resp = await axios.get(
            `https://graph.microsoft.com/v1.0/groups/${groupId}/members?$select=id`,
            { headers }
        );
        const isMember = resp.data.value.some(m => m.id === spId);
        if (isMember) {
            console.log('   ✅ App JÁ é membro do AdminAgents! Nada a fazer.');
            process.exit(0);
        }
        console.log('   App ainda não é membro. Adicionando...');
    } catch (err) {
        console.log('   Não foi possível verificar, tentando adicionar...');
    }

    // 5. Adicionar ao grupo
    console.log('\n🔧 Adicionando app ao grupo AdminAgents...');
    try {
        await axios.post(
            `https://graph.microsoft.com/v1.0/groups/${groupId}/members/$ref`,
            { '@odata.id': `https://graph.microsoft.com/v1.0/servicePrincipals/${spId}` },
            { headers }
        );
        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('  ✅ SUCESSO! App adicionado ao grupo AdminAgents');
        console.log('═══════════════════════════════════════════════════');
        console.log('');
        console.log('  Aguarde 2-5 minutos para a permissão propagar.');
        console.log('  Depois reinicie o servidor e teste o GDAP.');
        console.log('');
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        if (msg.includes('already exist')) {
            console.log('   ✅ App já é membro do AdminAgents!');
        } else {
            console.error('❌ Erro ao adicionar:', msg);
            process.exit(1);
        }
    }
}

run();
