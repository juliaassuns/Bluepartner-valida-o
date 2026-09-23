const { dbAll, dbRun } = require('../db');
const { isGdapConfigured, consultarRelacaoComFallback } = require('../gdap');

// Mesma trava em memória usada em gdap-pool.js: evita que duas rodadas
// concorrentes (agendador + eventual chamada manual futura) processem os
// mesmos pedidos pendentes ao mesmo tempo.
let emAndamento = false;

// Status finais do Graph pra uma delegatedAdminRelationship: uma vez que o
// pedido cai em um desses, não faz sentido continuar consultando de novo a
// cada rodada — a resposta não muda mais.
const STATUS_RESOLVIDOS = ['active', 'expired', 'terminated', 'rejected'];

/**
 * Confirma, via Microsoft Graph, quais pedidos com relação GDAP pendente já
 * tiveram o convite aceito pelo cliente (status 'active'), e grava
 * pedidos.gdap_ativo_em. É o que diferencia "cliente clicou no link" de
 * "cliente realmente aceitou", que antes não era verificado em lugar nenhum.
 *
 * Também grava o último status bruto do Graph em pedidos.gdap_status — uma
 * vez que o status vira um dos STATUS_RESOLVIDOS (ex.: 'expired' — o cliente
 * não aceitou a tempo), o pedido para de ser consultado nas próximas rodadas.
 *
 * Retorna { checked, confirmed } ou { skipped: true } se já houver uma
 * rodada em andamento.
 */
async function checkPendingGdapRelationships({ limit = 25 } = {}) {
    if (!isGdapConfigured()) return { checked: 0, confirmed: 0 };
    if (emAndamento) return { skipped: true };

    emAndamento = true;
    try {
        const placeholders = STATUS_RESOLVIDOS.map(() => '?').join(',');
        const pendentes = await dbAll(
            `SELECT pedido_id, gdap_relationship_id FROM pedidos
             WHERE gdap_relationship_id IS NOT NULL
               AND (gdap_status IS NULL OR gdap_status NOT IN (${placeholders}))
             ORDER BY criado_em ASC
             LIMIT ?`,
            [...STATUS_RESOLVIDOS, limit]
        );

        let confirmed = 0;

        for (const pedido of pendentes) {
            try {
                const rel = await consultarRelacaoComFallback(pedido.gdap_relationship_id);
                const status = String(rel?.status || '').toLowerCase();
                if (!status) continue;

                if (status === 'active') {
                    // COALESCE preserva a data da primeira confirmação, caso essa
                    // rodada reprocesse um pedido que já tinha sido confirmado
                    // antes da coluna gdap_status existir.
                    await dbRun(
                        `UPDATE pedidos SET gdap_status = ?, gdap_ativo_em = COALESCE(gdap_ativo_em, CURRENT_TIMESTAMP) WHERE pedido_id = ?`,
                        [status, pedido.pedido_id]
                    );
                    confirmed++;
                } else {
                    await dbRun(
                        `UPDATE pedidos SET gdap_status = ? WHERE pedido_id = ?`,
                        [status, pedido.pedido_id]
                    );
                }
            } catch (err) {
                console.warn(`[GDAP Relationship Check] Falha ao consultar pedido ${pedido.pedido_id}:`, err.message);
            }
        }

        return { checked: pendentes.length, confirmed };
    } finally {
        emAndamento = false;
    }
}

module.exports = { checkPendingGdapRelationships };
