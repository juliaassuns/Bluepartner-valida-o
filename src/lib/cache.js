const NodeCache = require('node-cache');

// Cria uma instância do cache.
// stdTTL: (Time-To-Live padrão) em segundos. Os dados expiram após este tempo.
// checkperiod: Período em segundos para verificar e remover dados expirados.
const cache = new NodeCache({ stdTTL: 300, checkperiod: 600 });

/**
 * Obtém um valor do cache.
 * @param {string} key A chave para buscar no cache.
 * @returns {any | undefined} O valor armazenado ou undefined se não for encontrado.
 */
function get(key) {
    return cache.get(key);
}

/**
 * Armazena um valor no cache.
 * @param {string} key A chave para armazenar o valor.
 * @param {any} value O valor a ser armazenado.
 * @param {number} [ttl] O Time-To-Live (em segundos) para esta chave específica.
 */
function set(key, value, ttl) {
    cache.set(key, value, ttl);
}

/**
 * Remove um valor do cache.
 * @param {string} key A chave a ser removida.
 */
function del(key) {
    cache.del(key);
}

/**
 * Limpa todo o cache.
 */
function flush() {
    cache.flushAll();
}

module.exports = {
    get,
    set,
    del,
    flush,
};
