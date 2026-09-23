const { dbAll, dbRun } = require('../db');
const { isGdapConfigured, consultarRelacaoComFallback } = require('../gdap');

// Mesma trava em memória usada em gdap-pool.js: evita que duas rodadas
// concorrentes (agendador + eventual chamada manual futura) processem os
// mesmos pedidos pendentes ao mesmo tempo.
let emAndamento = false;

/**
 * Confirma, via Microsoft Graph, quais pedidos com relação GDAP pendente já
 * tiveram o convite aceito pelo cliente (status 'active'), e grava
 * pedidos.gdap_ativo_em. É o que diferencia "cliente clicou no link" de
 * "cliente realmente aceitou", que antes não era verificado em lugar nenhum.
 *
 * Retorna { checked, confirmed } ou { skipped: true } se já houver uma
 * rodada em andamento.
 */
async function checkPendingGdapRelationships({ limit = 25 } = {}) {
    if (!isGdapConfigured()) return { checked: 0, confirmed: 0 };
    if (emAndamento) return { skipped: true };

    emAndamento = true;
    try {
        const pendentes = await dbAll(
            `SELECT pedido_id, gdap_relationship_id FROM pedidos
             WHERE gdap_relationship_id IS NOT NULL AND gdap_ativo_em IS NULL
             ORDER BY criado_em ASC
             LIMIT ?`,
            [limit]
        );

        let confirmed = 0;

        for (const pedido of pendentes) {
            try {
                const rel = await consultarRelacaoComFallback(pedido.gdap_relationship_id);
                const status = String(rel?.status || '').toLowerCase();
                if (status === 'active') {
                    await dbRun(
                        `UPDATE pedidos SET gdap_ativo_em = CURRENT_TIMESTAMP WHERE pedido_id = ?`,
                        [pedido.pedido_id]
                    );
                    confirmed++;
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
