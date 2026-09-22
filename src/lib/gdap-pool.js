const { dbGet, dbRun } = require('../db');
const { criarConviteGDAP } = require('../gdap');

// Trava em memória: evita que duas chamadas concorrentes (botão manual +
// agendador, ou dois cliques) leiam "disponível abaixo do mínimo" ao mesmo
// tempo e cada uma gere sua própria leva de links duplicando a reposição.
// Só protege dentro do mesmo processo — não substitui um lock de banco se o
// App Service algum dia rodar com múltiplas instâncias simultâneas.
let emAndamento = false;

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

module.exports = { autoGeneratePool };
