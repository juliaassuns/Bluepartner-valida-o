/**
 * Testes de API — endpoints públicos e autenticados
 * 
 * Cobre todos os endpoints do server.js:
 * - Rotas públicas (pedido por token, validação, GDAP status)
 * - Rotas admin (CRUD pedidos, licenças, logs, dashboard)
 * - Rotas superadmin (revendas, usuários, GDAP pool)
 * - Auth (login check, session)
 */

// Mock jose (ESM-only) antes de carregar qualquer módulo
jest.mock('jose', () => ({
    jwtVerify: jest.fn(),
    createRemoteJWKSet: jest.fn(() => jest.fn()),
}));

// Mock @azure/msal-node para evitar chamadas reais
jest.mock('@azure/msal-node', () => ({
    ConfidentialClientApplication: jest.fn(() => ({
        getAuthCodeUrl: jest.fn(),
        acquireTokenByCode: jest.fn(),
        acquireTokenByClientCredential: jest.fn(),
    })),
}));

const request = require('supertest');
const { cleanTestDb } = require('./setup');

// Limpa DB antes de carregar server
cleanTestDb();

const { initDatabase, dbRun, dbGet, closeDb } = require('../db');
const { app } = require('../server');

// ===== HELPERS PARA SESSÃO FAKE =====
function loginAsAdmin() {
    app.__testSession = { email: 'admin@test.com', nome: 'Admin Test', role: 'admin', ativo: true };
}
function loginAsSuperAdmin() {
    app.__testSession = { email: 'super@test.com', nome: 'Super Admin', role: 'superadmin', ativo: true };
}
function logout() {
    app.__testSession = null;
}

// ===== SETUP =====
beforeAll(async () => {
    await initDatabase();

    // Seed de dados mínimos para teste
    await dbRun(
        'INSERT INTO usuarios (email, nome, role, ativo) VALUES (?, ?, ?, ?)',
        ['admin@test.com', 'Admin Test', 'admin', 1]
    );
    await dbRun(
        'INSERT INTO usuarios (email, nome, role, ativo) VALUES (?, ?, ?, ?)',
        ['super@test.com', 'Super Admin', 'superadmin', 1]
    );
    await dbRun(
        'INSERT INTO revendas (nome, contato, email, partner_id, link_base, categoria, ativo) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['Ingram Micro Test', 'Contato', 'ingram@test.com', 'P123', '', 'ingram', 1]
    );
    await dbRun(
        'INSERT INTO revendas (nome, contato, email, partner_id, link_base, categoria, ativo) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['TD SYNNEX Test', 'Contato2', 'tds@test.com', 'P456', '', 'tds', 1]
    );
    await dbRun(
        'INSERT INTO pedidos (pedido_id, token, cliente, cnpj, revenda, revenda_nome, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['PED-API-001', 'validtoken123', 'Empresa Teste SA', '12.345.678/0001-90', 'ingram_micro_test', 'Ingram Micro Test', 'PENDENTE']
    );
    await dbRun(
        'INSERT INTO licencas (pedido_id, produto, qtd, duracao, preco) VALUES (?, ?, ?, ?, ?)',
        ['PED-API-001', 'Microsoft 365 E3', 50, '12 meses NCE', 'R$ 45.000,00/ano']
    );
    await dbRun(
        'INSERT INTO licencas (pedido_id, produto, qtd, duracao, preco) VALUES (?, ?, ?, ?, ?)',
        ['PED-API-001', 'Power BI Pro', 10, '12 meses NCE', 'R$ 6.000,00/ano']
    );
    // Junction
    const rv = await dbGet("SELECT id FROM revendas WHERE nome = 'Ingram Micro Test'");
    await dbRun('INSERT INTO pedido_revendas (pedido_id, revenda_id) VALUES (?, ?)', ['PED-API-001', rv.id]);
});

afterAll(async () => {
    logout();
    await closeDb();
    cleanTestDb();
});

// =============================================
// ROTAS PÚBLICAS
// =============================================

describe('GET /api/pedido/:pedidoId/:token (público)', () => {
    test('deve retornar pedido com token válido', async () => {
        const res = await request(app).get('/api/pedido/PED-API-001/validtoken123');
        expect(res.status).toBe(200);
        expect(res.body.cliente).toBe('Empresa Teste SA');
        expect(res.body.cnpj).toBe('12.345.678/0001-90');
        expect(res.body.pedidoId).toBe('PED-API-001');
        expect(res.body.status).toBe('PENDENTE');
        expect(res.body.licencas).toHaveLength(2);
        expect(res.body.revendas).toBeInstanceOf(Array);
    });

    test('deve retornar licenças com campos corretos', async () => {
        const res = await request(app).get('/api/pedido/PED-API-001/validtoken123');
        const lic = res.body.licencas.find(l => l.produto === 'Microsoft 365 E3');
        expect(lic).toBeTruthy();
        expect(lic.qtd).toBe(50);
        expect(lic.preco).toBe('R$ 45.000,00/ano');
    });

    test('deve retornar 404 com token inválido', async () => {
        const res = await request(app).get('/api/pedido/PED-API-001/tokeninvalido');
        expect(res.status).toBe(404);
        expect(res.body.error).toBeTruthy();
    });

    test('deve retornar 404 com pedidoId inexistente', async () => {
        const res = await request(app).get('/api/pedido/PED-INEXISTENTE/validtoken123');
        expect(res.status).toBe(404);
    });

    test('deve retornar 400 com formato inválido', async () => {
        const res = await request(app).get('/api/pedido/PED WITH SPACES/tok en');
        expect(res.status).toBe(400);
    });
});

describe('POST /api/validar (público)', () => {
    test('deve registrar validação com sucesso', async () => {
        const res = await request(app)
            .post('/api/validar')
            .send({
                pedidoId: 'PED-API-001',
                token: 'validtoken123',
                revenda: 'ingram',
                status: 'VALIDADO'
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.logId).toBeGreaterThan(0);
    });

    test('deve atualizar status do pedido para VALIDADO', async () => {
        const pedido = await dbGet("SELECT status FROM pedidos WHERE pedido_id = 'PED-API-001'");
        expect(pedido.status).toBe('VALIDADO');
    });

    test('deve retornar 400 sem pedidoId', async () => {
        const res = await request(app)
            .post('/api/validar')
            .send({ token: 'abc' });
        expect(res.status).toBe(400);
    });

    test('deve retornar 400 sem token', async () => {
        const res = await request(app)
            .post('/api/validar')
            .send({ pedidoId: 'PED-API-001' });
        expect(res.status).toBe(400);
    });
});

describe('GET /api/gdap/status (público)', () => {
    test('deve retornar status do GDAP', async () => {
        const res = await request(app).get('/api/gdap/status');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('configured');
        expect(res.body).toHaveProperty('partnerName');
        expect(res.body).toHaveProperty('poolDisponivel');
    });
});

// =============================================
// ROTAS QUE REQUEREM AUTH (admin ou superadmin)
// =============================================

describe('Rotas protegidas - sem sessão', () => {
    beforeAll(() => logout());

    test('GET /api/pedidos deve retornar 401', async () => {
        const res = await request(app).get('/api/pedidos');
        expect(res.status).toBe(401);
    });

    test('POST /api/pedidos deve retornar 401', async () => {
        const res = await request(app).post('/api/pedidos').send({});
        expect(res.status).toBe(401);
    });

    test('GET /api/logs deve retornar 401', async () => {
        const res = await request(app).get('/api/logs');
        expect(res.status).toBe(401);
    });

    test('GET /api/revendas deve retornar 401', async () => {
        const res = await request(app).get('/api/revendas');
        expect(res.status).toBe(401);
    });

    test('GET /api/usuarios deve retornar 401', async () => {
        const res = await request(app).get('/api/usuarios');
        expect(res.status).toBe(401);
    });
});

describe('GET /api/pedidos (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('deve listar pedidos', async () => {
        const res = await request(app).get('/api/pedidos');
        expect(res.status).toBe(200);
        expect(res.body.total).toBeGreaterThanOrEqual(1);
        expect(res.body.pedidos).toBeInstanceOf(Array);
    });

    test('deve filtrar pedidos por search', async () => {
        const res = await request(app).get('/api/pedidos?search=Empresa Teste');
        expect(res.status).toBe(200);
        expect(res.body.pedidos.length).toBeGreaterThanOrEqual(1);
    });

    test('deve filtrar pedidos por status', async () => {
        const res = await request(app).get('/api/pedidos?status=VALIDADO');
        expect(res.status).toBe(200);
        res.body.pedidos.forEach(p => {
            expect(p.status).toBe('VALIDADO');
        });
    });

    test('deve paginar pedidos', async () => {
        const res = await request(app).get('/api/pedidos?page=1&pageSize=1');
        expect(res.status).toBe(200);
        expect(res.body.page).toBe(1);
        expect(res.body.pageSize).toBe(1);
        expect(res.body.totalPages).toBeGreaterThanOrEqual(1);
    });

    test('pedidos devem incluir revendas associadas', async () => {
        const res = await request(app).get('/api/pedidos');
        const pedido = res.body.pedidos.find(p => p.pedido_id === 'PED-API-001');
        expect(pedido).toBeTruthy();
        expect(pedido.revendas).toBeInstanceOf(Array);
    });
});

describe('POST /api/pedidos (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('deve criar pedido novo', async () => {
        const rv = await dbGet("SELECT id FROM revendas WHERE nome = 'Ingram Micro Test'");
        const res = await request(app)
            .post('/api/pedidos')
            .send({
                cliente: 'Novo Cliente Ltda',
                cnpj: '99.888.777/0001-66',
                revendas: [rv.id]
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.pedidoId).toBeTruthy();
        expect(res.body.token).toBeTruthy();
        expect(res.body.link).toContain('pedidoId=');
        expect(res.body.revendas).toContain('Ingram Micro Test');
    });

    test('deve retornar 400 sem cliente', async () => {
        const res = await request(app)
            .post('/api/pedidos')
            .send({ cnpj: '11.222.333/0001-44' });
        expect(res.status).toBe(400);
    });

    test('deve retornar 400 sem CNPJ', async () => {
        const res = await request(app)
            .post('/api/pedidos')
            .send({ cliente: 'Empresa' });
        expect(res.status).toBe(400);
    });
});

describe('GET /api/pedido-completo/:pedidoId (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('deve retornar pedido completo com token', async () => {
        const res = await request(app).get('/api/pedido-completo/PED-API-001');
        expect(res.status).toBe(200);
        expect(res.body.pedido_id).toBe('PED-API-001');
        expect(res.body.token).toBe('validtoken123');
        expect(res.body.revendas).toBeInstanceOf(Array);
    });

    test('deve retornar 404 para pedido inexistente', async () => {
        const res = await request(app).get('/api/pedido-completo/PED-NOPE');
        expect(res.status).toBe(404);
    });
});

describe('PUT /api/pedidos/:pedidoId (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('deve editar pedido existente', async () => {
        const res = await request(app)
            .put('/api/pedidos/PED-API-001')
            .send({ cliente: 'Empresa Teste SA Atualizada' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.cliente).toBe('Empresa Teste SA Atualizada');
    });

    test('deve retornar 404 para pedido inexistente', async () => {
        const res = await request(app)
            .put('/api/pedidos/PED-NADA')
            .send({ cliente: 'X' });
        expect(res.status).toBe(404);
    });
});

describe('Licenças API (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('GET /api/licencas/:pedidoId - deve listar licenças', async () => {
        const res = await request(app).get('/api/licencas/PED-API-001');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2);
        expect(res.body.licencas).toHaveLength(2);
    });

    test('POST /api/licencas/:pedidoId - deve adicionar licença', async () => {
        const res = await request(app)
            .post('/api/licencas/PED-API-001')
            .send({
                produto: 'Microsoft Teams Phone',
                qtd: 5,
                duracao: '12 meses NCE',
                preco: 'R$ 2.400,00/ano'
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.id).toBeGreaterThan(0);
    });

    test('POST /api/licencas/:pedidoId - deve retornar 400 sem produto', async () => {
        const res = await request(app)
            .post('/api/licencas/PED-API-001')
            .send({ preco: 'R$ 100' });
        expect(res.status).toBe(400);
    });

    test('POST /api/licencas/:pedidoId - deve retornar 404 para pedido inexistente', async () => {
        const res = await request(app)
            .post('/api/licencas/PED-NOPE')
            .send({ produto: 'Test', preco: 'R$ 100' });
        expect(res.status).toBe(404);
    });

    test('DELETE /api/licencas/:licencaId - deve remover licença', async () => {
        // Buscar a licença que acabamos de adicionar
        const licencas = await request(app).get('/api/licencas/PED-API-001');
        const teamLic = licencas.body.licencas.find(l => l.produto === 'Microsoft Teams Phone');
        expect(teamLic).toBeTruthy();

        const res = await request(app).delete(`/api/licencas/${teamLic.id}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('DELETE /api/licencas/:licencaId - deve retornar 404 para licença inexistente', async () => {
        const res = await request(app).delete('/api/licencas/99999');
        expect(res.status).toBe(404);
    });
});

describe('Logs API (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('GET /api/logs/:pedidoId - deve listar logs de um pedido', async () => {
        const res = await request(app).get('/api/logs/PED-API-001');
        expect(res.status).toBe(200);
        expect(res.body.total).toBeGreaterThanOrEqual(1);
        expect(res.body.logs).toBeInstanceOf(Array);
    });

    test('GET /api/logs - deve listar todos os logs paginados', async () => {
        const res = await request(app).get('/api/logs?page=1&pageSize=10');
        expect(res.status).toBe(200);
        expect(res.body.page).toBe(1);
        expect(res.body.pageSize).toBe(10);
        expect(res.body.logs).toBeInstanceOf(Array);
    });

    test('GET /api/logs - deve filtrar por pedidoId', async () => {
        const res = await request(app).get('/api/logs?pedidoId=PED-API-001');
        expect(res.status).toBe(200);
        res.body.logs.forEach(log => {
            expect(log.pedido_id).toBe('PED-API-001');
        });
    });
});

describe('GET /api/pedidos/:pedidoId/historico (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('deve retornar histórico completo', async () => {
        const res = await request(app).get('/api/pedidos/PED-API-001/historico');
        expect(res.status).toBe(200);
        expect(res.body.pedido).toBeTruthy();
        expect(res.body.pedido.pedidoId).toBe('PED-API-001');
        expect(res.body.licencas).toBeInstanceOf(Array);
        expect(res.body.revendas).toBeInstanceOf(Array);
        expect(res.body.validacoes).toBeInstanceOf(Array);
        expect(res.body.timeline).toBeInstanceOf(Array);
        expect(res.body.totalLicencas).toBeGreaterThanOrEqual(2);
    });

    test('deve retornar 404 para pedido inexistente', async () => {
        const res = await request(app).get('/api/pedidos/PED-INVALID/historico');
        expect(res.status).toBe(404);
    });
});

describe('GET /api/admin/dashboard (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('deve retornar métricas do dashboard', async () => {
        const res = await request(app).get('/api/admin/dashboard');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('pedidosNoMes');
        expect(res.body).toHaveProperty('clientes');
        expect(res.body).toHaveProperty('usuariosEmRisco');
        expect(res.body).toHaveProperty('chartData');
        expect(res.body).toHaveProperty('topRevendas');
        expect(res.body).toHaveProperty('porStatus');
    });
});

describe('GET /api/pedidos/exportar (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('deve exportar pedidos como CSV', async () => {
        const res = await request(app).get('/api/pedidos/exportar');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.text).toContain('Pedido ID');
        expect(res.text).toContain('PED-API-001');
    });
});

describe('GET /api/audit-log (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('deve listar audit log paginado', async () => {
        const res = await request(app).get('/api/audit-log?page=1&pageSize=25');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('page');
        expect(res.body).toHaveProperty('total');
        expect(res.body.logs).toBeInstanceOf(Array);
    });
});

// =============================================
// ROTAS SUPERADMIN
// =============================================

describe('Revendas API (admin vs superadmin)', () => {
    test('admin pode listar revendas', async () => {
        loginAsAdmin();
        const res = await request(app).get('/api/revendas');
        expect(res.status).toBe(200);
        expect(res.body.revendas).toBeInstanceOf(Array);
    });

    test('admin pode listar revendas ativas', async () => {
        loginAsAdmin();
        const res = await request(app).get('/api/revendas/ativas');
        expect(res.status).toBe(200);
        expect(res.body.revendas).toBeInstanceOf(Array);
    });

    test('admin NÃO pode criar revenda (requires superadmin)', async () => {
        loginAsAdmin();
        const res = await request(app)
            .post('/api/revendas')
            .send({ nome: 'Revenda Admin Teste' });
        expect(res.status).toBe(403);
    });
});

describe('Revendas CRUD (superadmin)', () => {
    beforeAll(() => loginAsSuperAdmin());

    let createdRevendaId;

    test('deve criar revenda', async () => {
        const res = await request(app)
            .post('/api/revendas')
            .send({
                nome: 'Nova Revenda Super',
                contato: 'Maria',
                email: 'maria@revenda.com',
                partner_id: 'P789',
                categoria: 'ingram'
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        createdRevendaId = res.body.id;
    });

    test('não deve criar revenda duplicada', async () => {
        const res = await request(app)
            .post('/api/revendas')
            .send({ nome: 'Nova Revenda Super' });
        expect(res.status).toBe(409);
    });

    test('deve retornar 400 sem nome', async () => {
        const res = await request(app)
            .post('/api/revendas')
            .send({ contato: 'X' });
        expect(res.status).toBe(400);
    });

    test('deve editar revenda', async () => {
        const res = await request(app)
            .put(`/api/revendas/${createdRevendaId}`)
            .send({ nome: 'Revenda Editada', email: 'novo@email.com' });
        expect(res.status).toBe(200);
        expect(res.body.nome).toBe('Revenda Editada');
    });

    test('deve deletar revenda sem pedidos', async () => {
        const res = await request(app).delete(`/api/revendas/${createdRevendaId}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('não deve deletar revenda com pedidos associados', async () => {
        // Ingram Micro Test tem o PED-API-001 associado
        const rv = await dbGet("SELECT id FROM revendas WHERE nome = 'Ingram Micro Test'");
        const res = await request(app).delete(`/api/revendas/${rv.id}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('pedido(s) associado(s)');
    });
});

describe('Importação de revendas (superadmin)', () => {
    beforeAll(() => loginAsSuperAdmin());

    test('deve importar múltiplas revendas', async () => {
        const res = await request(app)
            .post('/api/revendas/importar')
            .send({ nomes: ['Import Rev A', 'Import Rev B', 'Import Rev C'] });
        expect(res.status).toBe(200);
        expect(res.body.added).toBe(3);
    });

    test('deve ignorar revendas que já existem', async () => {
        const res = await request(app)
            .post('/api/revendas/importar')
            .send({ nomes: ['Import Rev A', 'Import Nova'] });
        expect(res.status).toBe(200);
        expect(res.body.added).toBe(1);
        expect(res.body.skipped).toBe(1);
    });
});

describe('Dashboard de revendas (superadmin)', () => {
    beforeAll(() => loginAsSuperAdmin());

    test('deve retornar dashboard de revendas', async () => {
        const res = await request(app).get('/api/revendas/dashboard');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('totalRevendas');
        expect(res.body).toHaveProperty('ativas');
        expect(res.body).toHaveProperty('totalPedidos');
        expect(res.body.revendas).toBeInstanceOf(Array);
    });

    test('admin não pode acessar dashboard de revendas', async () => {
        loginAsAdmin();
        const res = await request(app).get('/api/revendas/dashboard');
        expect(res.status).toBe(403);
    });
});

describe('Usuários CRUD (superadmin)', () => {
    beforeAll(() => loginAsSuperAdmin());

    let createdUserId;

    test('deve listar usuários', async () => {
        const res = await request(app).get('/api/usuarios');
        expect(res.status).toBe(200);
        expect(res.body.total).toBeGreaterThanOrEqual(2);
        expect(res.body.usuarios).toBeInstanceOf(Array);
    });

    test('deve criar usuário', async () => {
        const res = await request(app)
            .post('/api/usuarios')
            .send({ email: 'novo_user@test.com', role: 'admin' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.email).toBe('novo_user@test.com');
        expect(res.body.role).toBe('admin');
        createdUserId = res.body.id;
    });

    test('deve retornar 409 para email duplicado', async () => {
        const res = await request(app)
            .post('/api/usuarios')
            .send({ email: 'novo_user@test.com', role: 'admin' });
        expect(res.status).toBe(409);
    });

    test('deve retornar 400 para email inválido', async () => {
        const res = await request(app)
            .post('/api/usuarios')
            .send({ email: 'nao-e-email', role: 'admin' });
        expect(res.status).toBe(400);
    });

    test('deve retornar 400 sem email', async () => {
        const res = await request(app)
            .post('/api/usuarios')
            .send({ role: 'admin' });
        expect(res.status).toBe(400);
    });

    test('deve atualizar role do usuário', async () => {
        const res = await request(app)
            .put(`/api/usuarios/${createdUserId}`)
            .send({ role: 'superadmin' });
        expect(res.status).toBe(200);
        expect(res.body.role).toBe('superadmin');
    });

    test('deve desativar usuário', async () => {
        const res = await request(app)
            .put(`/api/usuarios/${createdUserId}`)
            .send({ ativo: false });
        expect(res.status).toBe(200);
        expect(res.body.ativo).toBe(false);
    });

    test('deve deletar usuário', async () => {
        const res = await request(app).delete(`/api/usuarios/${createdUserId}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('admin não pode listar usuários', async () => {
        loginAsAdmin();
        const res = await request(app).get('/api/usuarios');
        expect(res.status).toBe(403);
    });
});

// =============================================
// GDAP POOL (superadmin)
// =============================================

describe('GDAP Pool (superadmin)', () => {
    beforeAll(() => loginAsSuperAdmin());

    test('deve listar pool (vazio inicialmente)', async () => {
        const res = await request(app).get('/api/gdap/pool');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('total');
        expect(res.body).toHaveProperty('disponiveis');
        expect(res.body).toHaveProperty('usados');
        expect(res.body.links).toBeInstanceOf(Array);
    });

    test('deve adicionar link ao pool', async () => {
        const res = await request(app)
            .post('/api/gdap/pool')
            .send({ link: 'https://admin.microsoft.com/test-gdap-pool-1', label: 'Teste 1' });
        expect(res.status).toBe(200);
        expect(res.body.added).toBe(1);
    });

    test('deve adicionar múltiplos links ao pool', async () => {
        const res = await request(app)
            .post('/api/gdap/pool')
            .send({
                links: [
                    'https://admin.microsoft.com/test-gdap-pool-2',
                    'https://admin.microsoft.com/test-gdap-pool-3'
                ]
            });
        expect(res.status).toBe(200);
        expect(res.body.added).toBe(2);
    });

    test('não deve duplicar links existentes', async () => {
        const res = await request(app)
            .post('/api/gdap/pool')
            .send({ link: 'https://admin.microsoft.com/test-gdap-pool-1' });
        expect(res.status).toBe(200);
        expect(res.body.added).toBe(0);
    });

    test('pool deve mostrar 3 links disponíveis', async () => {
        const res = await request(app).get('/api/gdap/pool');
        expect(res.body.disponiveis).toBe(3);
    });

    test('deve remover link do pool por ID', async () => {
        const pool = await request(app).get('/api/gdap/pool');
        const linkToDelete = pool.body.links.find(l => l.link.includes('pool-3'));
        const res = await request(app).delete(`/api/gdap/pool/${linkToDelete.id}`);
        expect(res.status).toBe(200);
    });

    test('admin não pode adicionar ao pool', async () => {
        loginAsAdmin();
        const res = await request(app)
            .post('/api/gdap/pool')
            .send({ link: 'https://admin.microsoft.com/blocked' });
        expect(res.status).toBe(403);
    });
});

// =============================================
// DELETE PEDIDO
// =============================================

describe('DELETE /api/pedidos/:pedidoId (admin)', () => {
    beforeAll(async () => {
        loginAsAdmin();
        // Cria um pedido para deletar
        await dbRun(
            'INSERT INTO pedidos (pedido_id, token, cliente, cnpj) VALUES (?, ?, ?, ?)',
            ['PED-DELETE-001', 'del_token', 'Delete Me', '11.111.111/0001-11']
        );
    });

    test('deve deletar pedido existente', async () => {
        const res = await request(app).delete('/api/pedidos/PED-DELETE-001');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('deve retornar 404 para pedido já deletado', async () => {
        const res = await request(app).delete('/api/pedidos/PED-DELETE-001');
        expect(res.status).toBe(404);
    });
});

// =============================================
// AUTH / SESSION
// =============================================

describe('Auth endpoints', () => {
    test('GET /auth/me sem sessão deve retornar 401', async () => {
        logout();
        const res = await request(app).get('/auth/me');
        expect(res.status).toBe(401);
        expect(res.body.user).toBeNull();
    });

    test('GET /api/bi/status requer auth', async () => {
        logout();
        const res = await request(app).get('/api/bi/status');
        expect(res.status).toBe(401);
    });
});

// =============================================
// BI ROUTES
// =============================================

describe('BI API (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('GET /api/bi/status deve retornar configuração BI', async () => {
        const res = await request(app).get('/api/bi/status');
        expect(res.status).toBe(200);
    });
});

// =============================================
// BATCH PEDIDOS
// =============================================

describe('POST /api/pedidos/batch (admin)', () => {
    beforeAll(() => loginAsAdmin());

    test('deve retornar 400 sem array de pedidos', async () => {
        const res = await request(app)
            .post('/api/pedidos/batch')
            .send({});
        expect(res.status).toBe(400);
    });

    test('deve retornar 400 com array vazio', async () => {
        const res = await request(app)
            .post('/api/pedidos/batch')
            .send({ pedidos: [] });
        expect(res.status).toBe(400);
    });

    test('deve processar batch com CNPJ inválido retornando erro no item', async () => {
        const res = await request(app)
            .post('/api/pedidos/batch')
            .send({
                pedidos: [{ cnpj: '123' }]
            });
        expect(res.status).toBe(200);
        expect(res.body.links[0].erro).toContain('CNPJ inválido');
    });
});

// =============================================
// PAGES/STATIC
// =============================================

describe('Páginas estáticas', () => {
    test('GET /login deve servir login.html', async () => {
        const res = await request(app).get('/login');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/html');
    });

    test('GET /admin sem sessão deve redirecionar para /login', async () => {
        logout();
        const res = await request(app).get('/admin');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login');
    });

    test('GET /superadmin sem sessão deve redirecionar para /login', async () => {
        logout();
        const res = await request(app).get('/superadmin');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login');
    });
});
