/**
 * Test setup — configura banco de dados em memória e helpers para testes
 */
const path = require('path');
const fs = require('fs');

// Usa banco de dados de teste separado (em arquivo temporário)
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test-bluepartner.db');
process.env.DB_PATH = TEST_DB_PATH;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-key-for-jest';
process.env.PORT = '0'; // porta aleatória

// Limpa o banco de teste (ignora EBUSY — o arquivo será sobrescrito pelo SQLite)
function cleanTestDb() {
    try {
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        // Limpa WAL e SHM também
        [TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm'].forEach(f => {
            try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
        });
    } catch (e) {
        // EBUSY: arquivo em uso, ignorar — SQLite cria novo se necessário
    }
}

module.exports = { TEST_DB_PATH, cleanTestDb };
