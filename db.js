const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bluepartner.db');

let db;

function getDb() {
    if (!db) {
        // Garante que o diretório data/ existe
        const fs = require('fs');
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        db = new sqlite3.Database(DB_PATH);
        db.run('PRAGMA journal_mode=WAL');
        db.run('PRAGMA foreign_keys=ON');
    }
    return db;
}

function initDatabase() {
    return new Promise((resolve, reject) => {
        const db = getDb();

        db.serialize(() => {
            // Tabela de pedidos
            db.run(`
                CREATE TABLE IF NOT EXISTS pedidos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pedido_id TEXT NOT NULL UNIQUE,
                    token TEXT NOT NULL,
                    cliente TEXT NOT NULL,
                    cnpj TEXT NOT NULL,
                    revenda TEXT DEFAULT 'ingram',
                    status TEXT DEFAULT 'PENDENTE',
                    gdap_link TEXT,
                    gdap_relationship_id TEXT,
                    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                    atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Migração: adiciona colunas GDAP se tabela já existir sem elas
            db.run(`ALTER TABLE pedidos ADD COLUMN gdap_link TEXT`, () => {});
            db.run(`ALTER TABLE pedidos ADD COLUMN gdap_relationship_id TEXT`, () => {});

            // Tabela de licenças do pedido
            db.run(`
                CREATE TABLE IF NOT EXISTS licencas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pedido_id TEXT NOT NULL,
                    produto TEXT NOT NULL,
                    qtd INTEGER NOT NULL DEFAULT 1,
                    duracao TEXT NOT NULL DEFAULT '12 meses NCE',
                    preco TEXT NOT NULL,
                    FOREIGN KEY (pedido_id) REFERENCES pedidos(pedido_id)
                )
            `);

            // Tabela de logs de validação
            db.run(`
                CREATE TABLE IF NOT EXISTS logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pedido_id TEXT NOT NULL,
                    token TEXT NOT NULL,
                    revenda TEXT,
                    timestamp TEXT NOT NULL,
                    ip TEXT,
                    user_agent TEXT,
                    status TEXT NOT NULL DEFAULT 'VALIDADO',
                    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Migração: adiciona coluna revenda_nome se não existir
            db.run(`ALTER TABLE pedidos ADD COLUMN revenda_nome TEXT DEFAULT ''`, () => {});

            // Tabela de revendas (parceiros revendedores)
            db.run(`
                CREATE TABLE IF NOT EXISTS revendas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nome TEXT NOT NULL UNIQUE,
                    contato TEXT DEFAULT '',
                    email TEXT DEFAULT '',
                    partner_id TEXT DEFAULT '',
                    link_base TEXT DEFAULT '',
                    ativo INTEGER DEFAULT 1,
                    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Migração: adiciona colunas partner_id e link_base à tabela revendas
            db.run(`ALTER TABLE revendas ADD COLUMN partner_id TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE revendas ADD COLUMN link_base TEXT DEFAULT ''`, () => {});

            // Tabela de associação pedido ↔ revendas (muitos-para-muitos)
            db.run(`
                CREATE TABLE IF NOT EXISTS pedido_revendas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pedido_id TEXT NOT NULL,
                    revenda_id INTEGER NOT NULL,
                    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (pedido_id) REFERENCES pedidos(pedido_id),
                    FOREIGN KEY (revenda_id) REFERENCES revendas(id),
                    UNIQUE(pedido_id, revenda_id)
                )
            `);

            // ===== USUÁRIOS (sem senha local; auth via Microsoft Entra ID) =====
            db.run(`
                CREATE TABLE IF NOT EXISTS usuarios (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL UNIQUE,
                    nome TEXT DEFAULT '',
                    role TEXT NOT NULL DEFAULT 'admin',
                    ativo INTEGER NOT NULL DEFAULT 1,
                    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            db.run(`CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_usuarios_role ON usuarios(role)`);

            // Índices
            db.run(`CREATE INDEX IF NOT EXISTS idx_pedidos_pedido_id ON pedidos(pedido_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_pedidos_token ON pedidos(token)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_pedidos_revenda_nome ON pedidos(revenda_nome)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_licencas_pedido_id ON licencas(pedido_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_logs_pedido_id ON logs(pedido_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_revendas_nome ON revendas(nome)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_pedido_revendas_pedido ON pedido_revendas(pedido_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_pedido_revendas_revenda ON pedido_revendas(revenda_id)`);

            // Tabela pool de links GDAP (banco de links pré-cadastrados)
            db.run(`
                CREATE TABLE IF NOT EXISTS gdap_pool (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    link TEXT NOT NULL,
                    label TEXT DEFAULT '',
                    status TEXT DEFAULT 'disponivel',
                    pedido_id TEXT,
                    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                    usado_em DATETIME
                )
            `);
            db.run(`CREATE INDEX IF NOT EXISTS idx_gdap_pool_status ON gdap_pool(status)`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

// Helpers promisificados
function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

module.exports = { getDb, initDatabase, dbGet, dbAll, dbRun };
