/**
 * Testes do módulo db.js — inicialização, CRUD, integridade
 */
const { cleanTestDb } = require('./setup');

// Limpa antes de carregar o módulo
cleanTestDb();

const { initDatabase, dbGet, dbAll, dbRun, closeDb } = require('../db');

beforeAll(async () => {
    await initDatabase();
});

afterAll(async () => {
    await closeDb();
    cleanTestDb();
});

describe('Database - Inicialização', () => {
    test('deve criar todas as tabelas necessárias', async () => {
        const tables = await dbAll(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        );
        const tableNames = tables.map(t => t.name).sort();

        expect(tableNames).toContain('pedidos');
        expect(tableNames).toContain('licencas');
        expect(tableNames).toContain('logs');
        expect(tableNames).toContain('revendas');
        expect(tableNames).toContain('pedido_revendas');
        expect(tableNames).toContain('usuarios');
        expect(tableNames).toContain('gdap_pool');
        expect(tableNames).toContain('audit_log');
    });

    test('deve criar índices nas tabelas', async () => {
        const indexes = await dbAll(
            "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
        );
        const indexNames = indexes.map(i => i.name);

        expect(indexNames).toContain('idx_pedidos_pedido_id');
        expect(indexNames).toContain('idx_pedidos_token');
        expect(indexNames).toContain('idx_licencas_pedido_id');
        expect(indexNames).toContain('idx_logs_pedido_id');
        expect(indexNames).toContain('idx_revendas_nome');
        expect(indexNames).toContain('idx_usuarios_email');
    });
});

describe('Database - CRUD Pedidos', () => {
    test('deve inserir um pedido', async () => {
        const result = await dbRun(
            'INSERT INTO pedidos (pedido_id, token, cliente, cnpj, revenda) VALUES (?, ?, ?, ?, ?)',
            ['PED-TEST-001', 'token123', 'Cliente Teste', '11.222.333/0001-44', 'ingram']
        );
        expect(result.lastID).toBeGreaterThan(0);
    });

    test('deve buscar pedido por pedido_id', async () => {
        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', ['PED-TEST-001']);
        expect(pedido).toBeTruthy();
        expect(pedido.cliente).toBe('Cliente Teste');
        expect(pedido.cnpj).toBe('11.222.333/0001-44');
        expect(pedido.status).toBe('PENDENTE');
    });

    test('deve atualizar status do pedido', async () => {
        await dbRun(
            "UPDATE pedidos SET status = 'VALIDADO' WHERE pedido_id = ?",
            ['PED-TEST-001']
        );
        const pedido = await dbGet('SELECT status FROM pedidos WHERE pedido_id = ?', ['PED-TEST-001']);
        expect(pedido.status).toBe('VALIDADO');
    });

    test('não deve permitir pedido_id duplicado', async () => {
        await expect(
            dbRun(
                'INSERT INTO pedidos (pedido_id, token, cliente, cnpj) VALUES (?, ?, ?, ?)',
                ['PED-TEST-001', 'outro_token', 'Outro', '99.999.999/0001-99']
            )
        ).rejects.toThrow();
    });
});

describe('Database - CRUD Licenças', () => {
    test('deve inserir licença associada a um pedido', async () => {
        const result = await dbRun(
            'INSERT INTO licencas (pedido_id, produto, qtd, duracao, preco) VALUES (?, ?, ?, ?, ?)',
            ['PED-TEST-001', 'Microsoft 365 Business Premium', 10, '12 meses NCE', 'R$ 5.500,00/ano']
        );
        expect(result.lastID).toBeGreaterThan(0);
    });

    test('deve buscar licenças por pedido_id', async () => {
        const licencas = await dbAll('SELECT * FROM licencas WHERE pedido_id = ?', ['PED-TEST-001']);
        expect(licencas).toHaveLength(1);
        expect(licencas[0].produto).toBe('Microsoft 365 Business Premium');
        expect(licencas[0].qtd).toBe(10);
    });

    test('deve remover licença por id', async () => {
        const lic = await dbGet('SELECT id FROM licencas WHERE pedido_id = ?', ['PED-TEST-001']);
        const result = await dbRun('DELETE FROM licencas WHERE id = ?', [lic.id]);
        expect(result.changes).toBe(1);
    });
});

describe('Database - CRUD Revendas', () => {
    test('deve inserir revenda', async () => {
        const result = await dbRun(
            'INSERT INTO revendas (nome, contato, email, partner_id, link_base, categoria) VALUES (?, ?, ?, ?, ?, ?)',
            ['Revenda Teste', 'João', 'joao@teste.com', 'PARTNER123', 'https://example.com', 'ingram']
        );
        expect(result.lastID).toBeGreaterThan(0);
    });

    test('deve buscar revenda por nome', async () => {
        const revenda = await dbGet('SELECT * FROM revendas WHERE nome = ?', ['Revenda Teste']);
        expect(revenda).toBeTruthy();
        expect(revenda.email).toBe('joao@teste.com');
        expect(revenda.categoria).toBe('ingram');
        expect(revenda.ativo).toBe(1);
    });

    test('não deve permitir revenda com nome duplicado', async () => {
        await expect(
            dbRun('INSERT INTO revendas (nome) VALUES (?)', ['Revenda Teste'])
        ).rejects.toThrow();
    });
});

describe('Database - CRUD Usuários', () => {
    test('deve inserir usuário', async () => {
        const result = await dbRun(
            'INSERT INTO usuarios (email, nome, role, ativo) VALUES (?, ?, ?, ?)',
            ['teste@bluepartner.com', 'Teste User', 'admin', 1]
        );
        expect(result.lastID).toBeGreaterThan(0);
    });

    test('deve buscar usuário por email (case-insensitive)', async () => {
        const user = await dbGet('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?)', ['TESTE@BLUEPARTNER.COM']);
        expect(user).toBeTruthy();
        expect(user.nome).toBe('Teste User');
        expect(user.role).toBe('admin');
    });

    test('não deve permitir email duplicado', async () => {
        await expect(
            dbRun('INSERT INTO usuarios (email, role) VALUES (?, ?)', ['teste@bluepartner.com', 'admin'])
        ).rejects.toThrow();
    });
});

describe('Database - Logs e Audit', () => {
    test('deve inserir log de validação', async () => {
        const result = await dbRun(
            'INSERT INTO logs (pedido_id, token, revenda, timestamp, ip, user_agent, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ['PED-TEST-001', 'token123', 'ingram', new Date().toISOString(), '127.0.0.1', 'Jest/1.0', 'VALIDADO']
        );
        expect(result.lastID).toBeGreaterThan(0);
    });

    test('deve inserir audit log', async () => {
        const result = await dbRun(
            'INSERT INTO audit_log (acao, entidade, entidade_id, usuario, detalhes, ip) VALUES (?, ?, ?, ?, ?, ?)',
            ['CRIAR_PEDIDO', 'pedido', 'PED-TEST-001', 'teste@bluepartner.com', '{}', '127.0.0.1']
        );
        expect(result.lastID).toBeGreaterThan(0);
    });

    test('deve buscar logs por pedido_id', async () => {
        const logs = await dbAll('SELECT * FROM logs WHERE pedido_id = ?', ['PED-TEST-001']);
        expect(logs.length).toBeGreaterThan(0);
    });
});

describe('Database - GDAP Pool', () => {
    test('deve inserir link no pool GDAP', async () => {
        const result = await dbRun(
            "INSERT INTO gdap_pool (link, label, status) VALUES (?, ?, ?)",
            ['https://admin.microsoft.com/test-link', 'Link Teste', 'disponivel']
        );
        expect(result.lastID).toBeGreaterThan(0);
    });

    test('deve buscar link disponível do pool', async () => {
        const link = await dbGet("SELECT * FROM gdap_pool WHERE status = 'disponivel' ORDER BY criado_em ASC LIMIT 1");
        expect(link).toBeTruthy();
        expect(link.link).toBe('https://admin.microsoft.com/test-link');
    });

    test('deve marcar link como usado', async () => {
        const link = await dbGet("SELECT * FROM gdap_pool WHERE status = 'disponivel' LIMIT 1");
        await dbRun(
            "UPDATE gdap_pool SET status = 'usado', pedido_id = ? WHERE id = ?",
            ['PED-TEST-001', link.id]
        );
        const updated = await dbGet('SELECT * FROM gdap_pool WHERE id = ?', [link.id]);
        expect(updated.status).toBe('usado');
        expect(updated.pedido_id).toBe('PED-TEST-001');
    });
});

describe('Database - Pedido-Revendas (junction)', () => {
    test('deve associar pedido a revenda', async () => {
        const revenda = await dbGet('SELECT id FROM revendas WHERE nome = ?', ['Revenda Teste']);
        const result = await dbRun(
            'INSERT INTO pedido_revendas (pedido_id, revenda_id) VALUES (?, ?)',
            ['PED-TEST-001', revenda.id]
        );
        expect(result.lastID).toBeGreaterThan(0);
    });

    test('deve buscar revendas de um pedido via JOIN', async () => {
        const revendas = await dbAll(
            `SELECT r.id, r.nome FROM pedido_revendas pr 
             JOIN revendas r ON r.id = pr.revenda_id 
             WHERE pr.pedido_id = ?`,
            ['PED-TEST-001']
        );
        expect(revendas).toHaveLength(1);
        expect(revendas[0].nome).toBe('Revenda Teste');
    });

    test('não deve permitir associação duplicada (UNIQUE constraint)', async () => {
        const revenda = await dbGet('SELECT id FROM revendas WHERE nome = ?', ['Revenda Teste']);
        await expect(
            dbRun(
                'INSERT INTO pedido_revendas (pedido_id, revenda_id) VALUES (?, ?)',
                ['PED-TEST-001', revenda.id]
            )
        ).rejects.toThrow();
    });
});
