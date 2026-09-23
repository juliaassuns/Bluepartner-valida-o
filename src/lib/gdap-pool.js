const { dbGet, dbAll, dbRun } = require('../db');
const { criarConviteGDAP, isGdapConfigured, consultarRelacaoComFallback, extrairRelationshipIdDoLinkGdap } = require('../gdap');

// Trava em memória: evita que duas chamadas concorrentes (botão manual +
// agendador, ou dois cliques) leiam "disponível abaixo do mínimo" ao mesmo
// tempo e cada uma gere sua própria leva de links duplicando a reposição.
// Só protege dentro do mesmo processo — não substitui um lock de banco se o
// App Service algum dia rodar com múltiplas instâncias simultâneas.
let emAndamento = false;
let expiracaoEmAndamento = false;

/**
 * Gera novos convites GDAP e adiciona no gdap_pool quando disponível estiver
 * abaixo do mínimo. Reaproveitado tanto pelas rotas HTTP (/pool/auto,
 * /pool/auto-trigger) quanto pelo agendador em background do server.js.
 *
 * Retorna um objeto com: added, disponiveisAntes, disponiveisDepois, target, maxNovos
 * Em erro, retorna { error, status, details }
 */
async function autoGeneratePool({ minDisponiveis = 3, maxNovos = 3 } = {}) {
    if (emAndamento) {
        return {
            added: 0,
            skipped: true,
            message: 'Já existe uma geração de pool GDAP em andamento; tente novamente em instantes.',
        };
    }
    emAndamento = true;
    try {
        const partnerName = process.env.GDAP_PARTNER_NAME || 'Blue Partner';

        // Purga links "disponíveis" que já expiraram no Graph antes de contar
        // — senão o pool nunca é reposto de verdade porque links mortos
        // continuam contando como disponíveis.
        await checkPoolExpirations();

        const disponiveisRow = await dbGet(
            `SELECT COUNT(*) as disponiveis FROM gdap_pool WHERE status = 'disponivel'`
        );
        const disponiveisAtuais = disponiveisRow?.disponiveis || 0;

        if (disponiveisAtuais >= minDisponiveis) {
            return {
                added: 0,
                disponiveisAntes: disponiveisAtuais,
                disponiveisDepois: disponiveisAtuais,
                target: minDisponiveis,
                maxNovos,
            };
        }

        const maxAdd = Math.min(maxNovos, minDisponiveis - disponiveisAtuais);

        let added = 0;

        for (let i = 0; i < maxAdd; i++) {
            const label = `Visualizador de Licenças - ${partnerName}`;
            let gdapResult;
            try {
                gdapResult = await criarConviteGDAP({ displayName: label });
            } catch (e) {
                return {
                    error: 'Falha ao gerar convite GDAP',
                    status: 500,
                    added,
                    disponiveisAntes: disponiveisAtuais,
                    target: minDisponiveis,
                    maxNovos,
                    details: e?.message || String(e),
                };
            }

            const inviteLink = gdapResult?.inviteLink;
            const displayName = gdapResult?.displayName || label;

            if (!inviteLink) continue;

            const existing = await dbGet('SELECT id FROM gdap_pool WHERE link = ?', [inviteLink]);
            if (existing) continue;

            await dbRun(
                'INSERT INTO gdap_pool (link, label, status) VALUES (?, ?, ?)',
                [inviteLink, displayName, 'disponivel']
            );

            added++;
        }

        const disponiveisDepoisRow = await dbGet(
            `SELECT COUNT(*) as disponiveis FROM gdap_pool WHERE status = 'disponivel'`
        );
        const disponiveisDepois = disponiveisDepoisRow?.disponiveis || 0;

        return {
            added,
            disponiveisAntes: disponiveisAtuais,
            disponiveisDepois,
            target: minDisponiveis,
            maxNovos,
        };
    } catch (err) {
        return { error: 'Erro interno', status: 500, details: err?.message || String(err) };
    } finally {
        emAndamento = false;
    }
}

/**
 * Verifica, via Graph, se links "disponíveis" no pool (nunca usados por
 * nenhum pedido) na verdade já expiraram no lado da Microsoft — convites
 * GDAP travados para aprovação têm um prazo (na prática, 90 dias) pro
 * cliente aceitar. Sem essa checagem, o contador de "disponíveis" que
 * autoGeneratePool() usa pra decidir se repõe o pool fica inflado com links
 * mortos, e o pool nunca é reposto de verdade.
 *
 * Marca as linhas expiradas com status = 'expirado' (saem da contagem de
 * 'disponivel' automaticamente) e grava o último status bruto do Graph em
 * relationship_status pra referência.
 *
 * Retorna { checked, expired } ou { skipped: true } se já houver uma
 * checagem em andamento.
 */
async function checkPoolExpirations({ limit = 50 } = {}) {
    if (!isGdapConfigured()) return { checked: 0, expired: 0 };
    if (expiracaoEmAndamento) return { skipped: true };

    expiracaoEmAndamento = true;
    try {
        const disponiveis = await dbAll(
            `SELECT id, link FROM gdap_pool WHERE status = 'disponivel' LIMIT ?`,
            [limit]
        );

        let expired = 0;

        for (const row of disponiveis) {
            const relationshipId = extrairRelationshipIdDoLinkGdap(row.link);
            if (!relationshipId) continue;

            try {
                const rel = await consultarRelacaoComFallback(relationshipId);
                const relStatus = String(rel?.status || '').toLowerCase();

                if (relStatus && relStatus !== 'approvalpending') {
                    // Não é mais "aguardando aceite": ou já expirou/foi rejeitado/
                    // terminado, ou (raro) já foi aceito por fora do nosso fluxo —
                    // em qualquer caso não deve continuar sendo oferecido como
                    // disponível pro próximo pedido.
                    await dbRun(
                        `UPDATE gdap_pool SET status = 'expirado', relationship_status = ? WHERE id = ?`,
                        [relStatus, row.id]
                    );
                    expired++;
                } else if (relStatus) {
                    await dbRun(
                        `UPDATE gdap_pool SET relationship_status = ? WHERE id = ?`,
                        [relStatus, row.id]
                    );
                }
            } catch (err) {
                console.warn(`[GDAP Pool Expiration Check] Falha ao consultar link (pool id ${row.id}):`, err.message);
            }
        }

        return { checked: disponiveis.length, expired };
    } finally {
        expiracaoEmAndamento = false;
    }
}

module.exports = { autoGeneratePool, checkPoolExpirations };
