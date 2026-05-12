/**
 * MSSQL Database Module (Production - Azure SQL)
 * Fallback para SQLite se SQL Server não estiver disponível
 */

const sql = require('mssql');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

let pool = null;
let sqliteDb = null;
let usingSQLite = false;

const CREATE_TABLE_STATEMENTS = {
    pedidos: `
        CREATE TABLE IF NOT EXISTS pedidos (
            id INT PRIMARY KEY IDENTITY(1,1),
            pedido_id VARCHAR(100) NOT NULL UNIQUE,
            token VARCHAR(255) NOT NULL,
            cliente VARCHAR(255) NOT NULL,
            cnpj VARCHAR(18) NOT NULL,
            revenda VARCHAR(100) DEFAULT 'ingram',
            status VARCHAR(50) DEFAULT 'PENDENTE',
            gdap_link TEXT,
            gdap_relationship_id VARCHAR(255),
            criado_em DATETIME DEFAULT GETDATE(),
            atualizado_em DATETIME DEFAULT GETDATE()
        )
    `,
    licencas: `
        CREATE TABLE IF NOT EXISTS licencas (
            id INT PRIMARY KEY IDENTITY(1,1),
            pedido_id VARCHAR(100) NOT NULL,
            produto VARCHAR(255) NOT NULL,
            qtd INT NOT NULL DEFAULT 1,
            duracao VARCHAR(100) NOT NULL DEFAULT '12 meses NCE',
            preco VARCHAR(50) NOT NULL,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(pedido_id)
        )
    `,
    logs: `
        CREATE TABLE IF NOT EXISTS logs (
            id INT PRIMARY KEY IDENTITY(1,1),
            pedido_id VARCHAR(100) NOT NULL,
            token VARCHAR(255) NOT NULL,
            revenda VARCHAR(100),
            timestamp VARCHAR(100) NOT NULL,
            ip VARCHAR(50),
            user_agent TEXT,
            status VARCHAR(50) NOT NULL DEFAULT 'VALIDADO',
            criado_em DATETIME DEFAULT GETDATE()
        )
    `,
    revendas: `
        CREATE TABLE IF NOT EXISTS revendas (
            id INT PRIMARY KEY IDENTITY(1,1),
            nome VARCHAR(255) NOT NULL UNIQUE,
            contato VARCHAR(255) DEFAULT '',
            email VARCHAR(255) DEFAULT '',
            partner_id VARCHAR(100) DEFAULT '',
            link_base TEXT DEFAULT '',
            categoria VARCHAR(100) DEFAULT '',
            ativo INT DEFAULT 1,
            criado_em DATETIME DEFAULT GETDATE()
        )
    `,
    pedido_revendas: `
        CREATE TABLE IF NOT EXISTS pedido_revendas (
            id INT PRIMARY KEY IDENTITY(1,1),
            pedido_id VARCHAR(100) NOT NULL,
            revenda_id INT NOT NULL,
            criado_em DATETIME DEFAULT GETDATE(),
            FOREIGN KEY (pedido_id) REFERENCES pedidos(pedido_id),
            FOREIGN KEY (revenda_id) REFERENCES revendas(id),
            UNIQUE(pedido_id, revenda_id)
        )
    `,
    usuarios: `
        CREATE TABLE IF NOT EXISTS usuarios (
            id INT PRIMARY KEY IDENTITY(1,1),
            email VARCHAR(255) NOT NULL UNIQUE,
            nome VARCHAR(255) DEFAULT '',
            role VARCHAR(50) NOT NULL DEFAULT 'admin',
            ativo INT NOT NULL DEFAULT 1,
            criado_em DATETIME DEFAULT GETDATE()
        )
    `,
    gdap_pool: `
        CREATE TABLE IF NOT EXISTS gdap_pool (
            id INT PRIMARY KEY IDENTITY(1,1),
            link TEXT NOT NULL,
            label VARCHAR(255) DEFAULT '',
            status VARCHAR(50) DEFAULT 'disponivel',
            pedido_id VARCHAR(100),
            criado_em DATETIME DEFAULT GETDATE(),
            usado_em DATETIME
        )
    `,
    audit_log: `
        CREATE TABLE IF NOT EXISTS audit_log (
            id INT PRIMARY KEY IDENTITY(1,1),
            acao VARCHAR(100) NOT NULL,
            entidade VARCHAR(100) NOT NULL,
            entidade_id VARCHAR(100),
            usuario VARCHAR(255),
            detalhes TEXT DEFAULT '',
            ip VARCHAR(50),
            criado_em DATETIME DEFAULT GETDATE()
        )
    `
};

const INDEX_STATEMENTS = [
    `CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_pedido_id ON pedidos(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_token ON pedidos(token)`,
    `CREATE INDEX IF NOT EXISTS idx_licencas_pedido_id ON licencas(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_pedido_id ON logs(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_revendas_nome ON revendas(nome)`,
    `CREATE INDEX IF NOT EXISTS idx_gdap_pool_status ON gdap_pool(status)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_criado ON audit_log(criado_em)`,
];

// ============ SQLITE FALLBACK ============

function initSQLite() {
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bluepartner.db');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    sqliteDb = new sqlite3.Database(DB_PATH);
    sqliteDb.run('PRAGMA journal_mode=WAL');
    sqliteDb.run('PRAGMA foreign_keys=ON');

    const CREATE_TABLE_SQLITE = [
        `CREATE TABLE IF NOT EXISTS pedidos (
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
        )`,
        `CREATE TABLE IF NOT EXISTS licencas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id TEXT NOT NULL,
            produto TEXT NOT NULL,
            qtd INTEGER NOT NULL DEFAULT 1,
            duracao TEXT NOT NULL DEFAULT '12 meses NCE',
            preco TEXT NOT NULL,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(pedido_id)
        )`,
        `CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id TEXT NOT NULL,
            token TEXT NOT NULL,
            revenda TEXT,
            timestamp TEXT NOT NULL,
            ip TEXT,
            user_agent TEXT,
            status TEXT NOT NULL DEFAULT 'VALIDADO',
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS revendas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE,
            contato TEXT DEFAULT '',
            email TEXT DEFAULT '',
            partner_id TEXT DEFAULT '',
            link_base TEXT DEFAULT '',
            categoria TEXT DEFAULT '',
            ativo INTEGER DEFAULT 1,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS pedido_revendas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id TEXT NOT NULL,
            revenda_id INTEGER NOT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(pedido_id),
            FOREIGN KEY (revenda_id) REFERENCES revendas(id),
            UNIQUE(pedido_id, revenda_id)
        )`,
        `CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            nome TEXT DEFAULT '',
            role TEXT NOT NULL DEFAULT 'admin',
            ativo INTEGER NOT NULL DEFAULT 1,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS gdap_pool (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            link TEXT NOT NULL,
            label TEXT DEFAULT '',
            status TEXT DEFAULT 'disponivel',
            pedido_id TEXT,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            usado_em DATETIME
        )`,
        `CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            acao TEXT NOT NULL,
            entidade TEXT NOT NULL,
            entidade_id TEXT,
            usuario TEXT,
            detalhes TEXT DEFAULT '',
            ip TEXT,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    ];

    return new Promise((resolve, reject) => {
        sqliteDb.serialize(() => {
            CREATE_TABLE_SQLITE.forEach(sql => sqliteDb.run(sql, (err) => {
                if (err && !err.message.includes('duplicate')) {
                    console.error('[SQLite Migration]', err.message);
                }
            }));

            sqliteDb.run('CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)', () => {
                resolve();
            });
        });
    });
}

// ============ MSSQL INIT ============

async function initDatabase() {
    try {
        // Tenta conectar ao SQL Server se em produção
        if (process.env.NODE_ENV === 'production' && process.env.AZURE_SQL_CONNECTION_STRING) {
            console.log('[DB] Conectando ao SQL Server (Azure)...');
            const config = {
                connectionString: process.env.AZURE_SQL_CONNECTION_STRING,
                options: {
                    encrypt: true,
                    trustServerCertificate: false,
                    enableKeepAlive: true,
                    keepAliveInitialDelayInMs: 30000
                },
                pool: {
                    max: 10,
                    min: 2,
                    idleTimeoutMillis: 30000
                }
            };

            try {
                pool = new sql.ConnectionPool(config);
                await pool.connect();
                console.log('[DB] ✅ Conectado ao SQL Server');

                // Cria tabelas
                for (const [, statement] of Object.entries(CREATE_TABLE_STATEMENTS)) {
                    try {
                        await pool.request().query(statement);
                    } catch (err) {
                        if (!err.message.includes('already exists')) {
                            console.error('[DB] Erro ao criar tabela:', err.message);
                        }
                    }
                }

                // Cria índices
                for (const indexSql of INDEX_STATEMENTS) {
                    try {
                        await pool.request().query(indexSql);
                    } catch (err) {
                        if (!err.message.includes('already exists')) {
                            console.warn('[DB] Índice:', err.message);
                        }
                    }
                }

                usingSQLite = false;
                console.log('[DB] Tabelas e índices SQL Server inicializados');
                return;
            } catch (err) {
                console.warn('[DB] ⚠️  Falha ao conectar SQL Server:', err.message);
                console.log('[DB] Fallback para SQLite...');
            }
        }

        // Fallback para SQLite
        console.log('[DB] Usando SQLite');
        usingSQLite = true;
        await initSQLite();
    } catch (err) {
        console.error('[DB] Erro crítico na inicialização:', err);
        throw err;
    }
}

// ============ QUERY HELPERS ============

function convertSQLiteToMSSQLQuery(sql) {
    // Converte placeholders ? em @param0, @param1, etc
    let paramIndex = 0;
    const converted = sql.replace(/\?/g, () => `@param${paramIndex++}`);
    return converted;
}

function dbGet(sql, params = []) {
    return new Promise(async (resolve, reject) => {
        try {
            if (usingSQLite) {
                sqliteDb.get(sql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            } else {
                try {
                    const request = pool.request();
                    params.forEach((param, i) => {
                        request.input(`param${i}`, param);
                    });
                    const convertedSql = convertSQLiteToMSSQLQuery(sql);
                    const result = await request.query(convertedSql);
                    resolve(result.recordset?.[0] || null);
                } catch (err) {
                    console.error('[DB MSSQL GET Error]', err.message);
                    reject(err);
                }
            }
        } catch (err) {
            reject(err);
        }
    });
}

function dbAll(sql, params = []) {
    return new Promise(async (resolve, reject) => {
        try {
            if (usingSQLite) {
                sqliteDb.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            } else {
                try {
                    const request = pool.request();
                    params.forEach((param, i) => {
                        request.input(`param${i}`, param);
                    });
                    const convertedSql = convertSQLiteToMSSQLQuery(sql);
                    const result = await request.query(convertedSql);
                    resolve(result.recordset || []);
                } catch (err) {
                    console.error('[DB MSSQL ALL Error]', err.message);
                    reject(err);
                }
            }
        } catch (err) {
            reject(err);
        }
    });
}

function dbRun(sql, params = []) {
    return new Promise(async (resolve, reject) => {
        try {
            if (usingSQLite) {
                sqliteDb.run(sql, params, function (err) {
                    if (err) reject(err);
                    else resolve({ lastID: this.lastID, changes: this.changes });
                });
            } else {
                try {
                    const request = pool.request();
                    params.forEach((param, i) => {
                        request.input(`param${i}`, param);
                    });
                    const convertedSql = convertSQLiteToMSSQLQuery(sql);
                    const result = await request.query(convertedSql);
                    resolve({ 
                        lastID: 0, 
                        changes: result.rowsAffected?.[0] || 0 
                    });
                } catch (err) {
                    console.error('[DB MSSQL RUN Error]', err.message);
                    reject(err);
                }
            }
        } catch (err) {
            reject(err);
        }
    });
}

async function closeDb() {
    if (pool) {
        await pool.close();
        pool = null;
    }
    if (sqliteDb) {
        return new Promise((resolve) => {
            sqliteDb.close(() => {
                sqliteDb = null;
                resolve();
            });
        });
    }
}

module.exports = { initDatabase, dbGet, dbAll, dbRun, closeDb };
