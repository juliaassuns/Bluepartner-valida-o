/**
 * Diagnóstico GDAP — testa, na ordem, os 3 requisitos reais pra geração
 * automática de convites GDAP funcionar:
 *   1. Credenciais (GDAP_TENANT_ID/CLIENT_ID/CLIENT_SECRET) válidas
 *   2. Permissão DelegatedAdminRelationship.ReadWrite.All com consentimento
 *      de admin concedido
 *   3. App é membro do grupo AdminAgents (exigência do Partner Center)
 *
 * Os passos 2 e 3 não têm um jeito confiável de checar separadamente sem
 * mais permissões do que a app deveria ter (ler grupos exigiria
 * Group.Read.All, que não faz parte do escopo necessário). Por isso o
 * diagnóstico faz o teste real: tenta criar um convite GDAP de verdade
 * (igual ao que o pool automático faz em produção) e interpreta o erro,
 * se houver, pra apontar qual dos dois está faltando.
 *
 * O convite de teste criado (se tudo funcionar) não tem cliente vinculado
 * e não representa risco — é idêntico a qualquer link do pool que nunca
 * foi usado, e expira sozinho se ninguém aceitar. Fica marcado com um nome
 * óbvio pra ser identificado e ignorado/removido do Partner Center.
 *
 * Uso: node diagnostico-gdap.js
 */
require('dotenv').config();
const { isGdapConfigured, getAccessToken, criarConviteGDAP } = require('./src/gdap');

function linha() {
    console.log('─'.repeat(60));
}

async function main() {
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('  🔎 Diagnóstico GDAP — BluePartner');
    console.log('═══════════════════════════════════════════════════');
    console.log('');

    // ===== 1) Credenciais presentes =====
    linha();
    console.log('[1/3] Credenciais (GDAP_TENANT_ID / CLIENT_ID / CLIENT_SECRET)');
    linha();

    if (!isGdapConfigured()) {
        console.log('❌ Uma ou mais variáveis não estão definidas no .env.');
        console.log('   Preencha GDAP_TENANT_ID, GDAP_CLIENT_ID e GDAP_CLIENT_SECRET e rode de novo.');
        process.exit(1);
    }
    console.log('✅ Variáveis definidas. Testando se são válidas (obtendo token)...');

    try {
        await getAccessToken();
        console.log('✅ Token obtido com sucesso — credenciais válidas.');
    } catch (err) {
        console.log('❌ Falha ao obter token:', err.message);
        console.log('');
        console.log('   Causas prováveis:');
        console.log('   - GDAP_TENANT_ID errado (não é um tenant ID/domínio válido)');
        console.log('   - GDAP_CLIENT_ID errado ou app não existe nesse tenant');
        console.log('   - GDAP_CLIENT_SECRET errado, expirado ou revogado');
        process.exit(1);
    }

    // ===== 2 e 3) Permissão + AdminAgents (teste real) =====
    linha();
    console.log('[2/3 e 3/3] Permissão com consentimento + grupo AdminAgents');
    linha();
    console.log('Tentando criar um convite GDAP de teste (mesma operação usada em produção)...');
    console.log('');

    try {
        const result = await criarConviteGDAP({
            displayName: 'TESTE DE DIAGNÓSTICO - BluePartner (pode ignorar/excluir)',
            duration: 'P1D', // 1 dia só, já que é só teste
        });
        console.log('✅ Convite de teste criado com sucesso!');
        console.log('   Isso confirma que a permissão está concedida E o app está no grupo AdminAgents.');
        console.log('');
        console.log('   Relationship ID:', result.relationshipId);
        console.log('   Link:', result.inviteLink);
        console.log('');
        console.log('   Esse link não está vinculado a nenhum cliente e expira em 1 dia sozinho.');
        console.log('   Pode ignorar — não precisa fazer nada com ele.');
        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('  ✅ TUDO OK — a geração automática de GDAP deve funcionar.');
        console.log('═══════════════════════════════════════════════════');
    } catch (err) {
        const msg = err.message || String(err);
        console.log('❌ Falha ao criar o convite de teste:', msg);
        console.log('');

        const lower = msg.toLowerCase();
        if (lower.includes('authorization_requestdenied') || lower.includes('insufficient privileges') || lower.includes('403')) {
            console.log('   ➜ Isso indica que a permissão DelegatedAdminRelationship.ReadWrite.All');
            console.log('     não está concedida OU não tem o consentimento de admin.');
            console.log('     Vá em Azure Portal → Entra ID → App registrations → [seu app] →');
            console.log('     API permissions, confirme a permissão e clique em');
            console.log('     "Grant admin consent for [tenant]".');
        } else if (lower.includes('adminagent') || lower.includes('not authorized') || lower.includes('forbidden')) {
            console.log('   ➜ Pode ser que o app não esteja no grupo AdminAgents do tenant.');
            console.log('     Rode: node setup-adminagents.js');
        } else {
            console.log('   ➜ Erro não reconhecido automaticamente. Revise a mensagem acima.');
            console.log('     Se mencionar "AdminAgents" ou "authorization", rode: node setup-adminagents.js');
            console.log('     Se mencionar permissão/consent, revise API permissions no Azure Portal.');
        }
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Erro inesperado no diagnóstico:', err);
    process.exit(1);
});
