const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bluepartner.db');

let db;

const CREATE_TABLE_STATEMENTS = [
    // Tabela de pedidos
    `
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
    `,
    // Tabela de licenças do pedido
    `
        CREATE TABLE IF NOT EXISTS licencas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id TEXT NOT NULL,
            produto TEXT NOT NULL,
            qtd INTEGER NOT NULL DEFAULT 1,
            duracao TEXT NOT NULL DEFAULT '12 meses NCE',
            preco TEXT NOT NULL,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(pedido_id)
        )
    `,
    // Tabela de logs de validação
    `
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
    `,
    // Tabela de revendas
    `
        CREATE TABLE IF NOT EXISTS revendas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE,
            contato TEXT DEFAULT '',
            email TEXT DEFAULT '',
            partner_id TEXT DEFAULT '',
            link_base TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            ativo INTEGER DEFAULT 1,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `,
    // Associação pedido ↔ revendas
    `
        CREATE TABLE IF NOT EXISTS pedido_revendas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id TEXT NOT NULL,
            revenda_id INTEGER NOT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(pedido_id),
            FOREIGN KEY (revenda_id) REFERENCES revendas(id),
            UNIQUE(pedido_id, revenda_id)
        )
    `,
    // Usuários (auth via Microsoft Entra ID)
    `
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            nome TEXT DEFAULT '',
            role TEXT NOT NULL DEFAULT 'admin',
            ativo INTEGER NOT NULL DEFAULT 1,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `,
    // Pool de links GDAP
    `
        CREATE TABLE IF NOT EXISTS gdap_pool (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            link TEXT NOT NULL,
            label TEXT DEFAULT '',
            status TEXT DEFAULT 'disponivel',
            pedido_id TEXT,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            usado_em DATETIME
        )
    `,
    // Audit log
    `
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            acao TEXT NOT NULL,
            entidade TEXT NOT NULL,
            entidade_id TEXT,
            usuario TEXT,
            detalhes TEXT DEFAULT '',
            ip TEXT,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `,
];

const MIGRATION_STATEMENTS = [
    `ALTER TABLE pedidos ADD COLUMN gdap_link TEXT`,
    `ALTER TABLE pedidos ADD COLUMN gdap_relationship_id TEXT`,
    `ALTER TABLE pedidos ADD COLUMN revenda_nome TEXT DEFAULT ''`,
    `ALTER TABLE revendas ADD COLUMN partner_id TEXT DEFAULT ''`,
    `ALTER TABLE revendas ADD COLUMN link_base TEXT DEFAULT ''`,
    `ALTER TABLE revendas ADD COLUMN categoria TEXT DEFAULT ''`,
];

const INDEX_STATEMENTS = [
    `CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)`,
    `CREATE INDEX IF NOT EXISTS idx_usuarios_role ON usuarios(role)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_pedido_id ON pedidos(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_token ON pedidos(token)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_revenda_nome ON pedidos(revenda_nome)`,
    `CREATE INDEX IF NOT EXISTS idx_licencas_pedido_id ON licencas(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_pedido_id ON logs(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_revendas_nome ON revendas(nome)`,
    `CREATE INDEX IF NOT EXISTS idx_pedido_revendas_pedido ON pedido_revendas(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedido_revendas_revenda ON pedido_revendas(revenda_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gdap_pool_status ON gdap_pool(status)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_acao ON audit_log(acao)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_entidade ON audit_log(entidade)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_criado ON audit_log(criado_em)`,
];

function runStatements(database, statements, callback) {
    statements.forEach((sql) => database.run(sql, callback));
}

function getDb() {
    if (!db) {
        // Garante que o diretório data/ existe
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
        const database = getDb();

        // Helper: loga erros de migration exceto "duplicate column"
        const migrationCb = (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('[DB Migration]', err.message);
            }
        };

        database.serialize(() => {
            runStatements(database, CREATE_TABLE_STATEMENTS);
            runStatements(database, MIGRATION_STATEMENTS, migrationCb);

            // O último índice finaliza a inicialização para manter ordem e erro original.
            runStatements(database, INDEX_STATEMENTS.slice(0, -1));
            database.run(INDEX_STATEMENTS[INDEX_STATEMENTS.length - 1], (err) => {
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

function closeDb() {
    return new Promise((resolve) => {
        if (db) {
            db.close(() => { db = null; resolve(); });
        } else {
            resolve();
        }
    });
}

module.exports = { getDb, initDatabase, dbGet, dbAll, dbRun, closeDb };
