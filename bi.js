/**
 * bi.js — Integração com BI (Power BI / Fabric) para pontuação de revendas
 * 
 * Lê dados de scoring/metas do BI via DAX ou SQL (Fabric) e retorna
 * sugestões de quais revendas precisam de mais pedidos.
 * 
 * Configuração via .env:
 *   BI_SCORING_MODE=dax|sql        (default: dax)
 *   BI_SCORING_DAX=EVALUATE ...    (query DAX que retorna pontuação)
 *   BI_SCORING_TABLE=Pontuacao     (tabela SQL no Fabric, usada se mode=sql)
 * 
 * A query/tabela deve retornar colunas mapeáveis:
 *   BI_COL_REVENDA=NomeRevenda     (nome da revenda — deve bater com revendas.nome)
 *   BI_COL_META=MetaPedidos        (meta de pedidos no mês)
 *   BI_COL_REALIZADOS=Realizados   (pedidos realizados)
 *   BI_COL_PONTUACAO=Score         (pontuação/score numérico)
 *   BI_COL_RANKING=Ranking         (posição no ranking, 1 = melhor)
 */

const { executeDaxQuery, fabricSqlQuery, isFabricConfigured } = require('./fabric');

// Configuração via env
const BI_MODE = (process.env.BI_SCORING_MODE || 'dax').toLowerCase();
const BI_DAX = process.env.BI_SCORING_DAX || '';
const BI_TABLE = process.env.BI_SCORING_TABLE || '';

// Mapeamento de colunas (nomes no BI → campos internos)
const COL = {
    revenda:    process.env.BI_COL_REVENDA    || 'NomeRevenda',
    meta:       process.env.BI_COL_META       || 'MetaPedidos',
    realizados: process.env.BI_COL_REALIZADOS || 'Realizados',
    pontuacao:  process.env.BI_COL_PONTUACAO  || 'Score',
    ranking:    process.env.BI_COL_RANKING    || 'Ranking',
};

/**
 * Verifica se a integração BI está configurada
 */
function isBiConfigured() {
    const fabric = isFabricConfigured();
    const hasQuery = BI_MODE === 'dax' ? !!BI_DAX : !!BI_TABLE;
    return {
        configured: fabric.credentials && hasQuery,
        mode: BI_MODE,
        hasQuery,
        fabricCredentials: fabric.credentials,
        columns: COL
    };
}

/**
 * Busca dados de pontuação do BI
 * Retorna array de objetos normalizados:
 * [{ revenda, meta, realizados, pontuacao, ranking, faltam, percentual }]
 */
async function fetchPontuacaoBI() {
    let rows = [];

    if (BI_MODE === 'dax') {
        if (!BI_DAX) throw new Error('BI_SCORING_DAX não configurado');
        rows = await executeDaxQuery(BI_DAX);
    } else {
        if (!BI_TABLE) throw new Error('BI_SCORING_TABLE não configurado');
        const safeName = BI_TABLE.replace(/[[\]]/g, '');
        const result = await fabricSqlQuery(`SELECT * FROM [${safeName}]`);
        rows = result.recordset || [];
    }

    // Normaliza colunas do BI para formato interno
    return rows.map(row => {
        const meta = Number(row[COL.meta]) || 0;
        const realizados = Number(row[COL.realizados]) || 0;
        const pontuacao = Number(row[COL.pontuacao]) || 0;
        const ranking = Number(row[COL.ranking]) || 0;
        const faltam = Math.max(0, meta - realizados);
        const percentual = meta > 0 ? Math.round((realizados / meta) * 100) : 0;

        return {
            revenda: String(row[COL.revenda] || '').trim(),
            meta,
            realizados,
            pontuacao,
            ranking,
            faltam,
            percentual,
            atingiu: realizados >= meta && meta > 0
        };
    });
}

/**
 * Retorna sugestões: revendas que NÃO bateram a meta, ordenadas por urgência
 * (menor percentual primeiro, ou maior faltam primeiro)
 */
async function getSugestoes() {
    const dados = await fetchPontuacaoBI();

    // Filtra quem não atingiu meta e ordena por urgência (menor % primeiro)
    const sugestoes = dados
        .filter(d => !d.atingiu && d.meta > 0)
        .sort((a, b) => a.percentual - b.percentual || b.faltam - a.faltam);

    return {
        sugestoes,
        resumo: {
            total: dados.length,
            atingiram: dados.filter(d => d.atingiu).length,
            pendentes: sugestoes.length
        }
    };
}

module.exports = { isBiConfigured, fetchPontuacaoBI, getSugestoes };
