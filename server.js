require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const helmet = require('helmet');
const fetch = global.fetch;
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { jwtVerify, createRemoteJWKSet } = require('jose');
const { initDatabase, dbGet, dbAll, dbRun } = require('./db');
const { criarConviteGDAP, isGdapConfigured, listarRelacoesAtivas, consultarRelacao, lerLicencasCliente } = require('./gdap');
const { isFabricConfigured, fabricSqlQuery, executeDaxQuery, listDatasets, listDatasetTables, syncRevendasFromFabric, listWorkspaces, listWorkspaceItems, listLakehouses, listLakehouseTables, describeTable, previewTable, getDelegatedToken, resolveToken } = require('./fabric');
const { isBiConfigured, fetchPontuacaoBI, getSugestoes } = require('./bi');
const { isIngramConfigured, getIngramLicencasNormalizadas } = require('./ingram');
const { isTdsConfigured, getTdsLicencasNormalizadas } = require('./tds');

// ===== STATUS CONSTANTS =====
const STATUS = {
    PENDENTE: 'PENDENTE',
    VALIDADO: 'VALIDADO',
    DIVERGENTE: 'DIVERGENTE',
};
const GDAP_STATUS = {
    DISPONIVEL: 'disponivel',
    USADO: 'usado',
};

// Multer config — upload to temp dir
const upload = multer({
    dest: path.join(__dirname, 'data', 'uploads'),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.csv', '.xlsx', '.xls', '.pdf', '.docx', '.doc'].includes(ext)) cb(null, true);
        else cb(new Error('Formato não suportado'), false);
    }
});

const app = express();
const PORT = process.env.PORT || 3000;

// ===== AUTH CONFIG (Microsoft Entra ID) =====
// Required envs:
// ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REDIRECT_URI, SESSION_SECRET
const ENTRA_TENANT_ID = process.env.ENTRA_TENANT_ID;
const ENTRA_CLIENT_ID = process.env.ENTRA_CLIENT_ID;
const ENTRA_CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET;
const ENTRA_REDIRECT_URI = process.env.ENTRA_REDIRECT_URI || 'http://localhost:3000/auth/callback';

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const isEntraConfigured = !!(ENTRA_TENANT_ID && ENTRA_CLIENT_ID && ENTRA_CLIENT_SECRET);

const msalClient = isEntraConfigured
    ? new ConfidentialClientApplication({
        auth: {
            clientId: ENTRA_CLIENT_ID,
            authority: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`,
            clientSecret: ENTRA_CLIENT_SECRET
        }
    })
    : null;

const jwks = isEntraConfigured
    ? createRemoteJWKSet(
        new URL(`https://login.microsoftonline.com/${ENTRA_TENANT_ID}/discovery/v2.0/keys`)
    )
    : null;

// ===== SESSION CONFIG =====
app.set('trust proxy', 1);
app.use(session({
    name: 'bp.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000 // 8h
    }
}));

// Test mode: permite injetar sessão fake para testes automatizados
if (process.env.NODE_ENV === 'test') {
    app.use((req, res, next) => {
        if (app.__testSession) {
            req.session = req.session || {};
            req.session.user = app.__testSession;
        }
        next();
    });
}

// ===== MIDDLEWARE =====

// HTTPS redirect (production)
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' &&
        req.headers['x-forwarded-proto'] !== 'https' &&
        !req.hostname.includes('localhost')) {
        return res.redirect(301, 'https://' + req.hostname + req.originalUrl);
    }
    next();
});

// Security headers
app.use(helmet({
    contentSecurityPolicy: false, // CSP can break inline scripts
    crossOriginEmbedderPolicy: false
}));

// HSTS
app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// CORS
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Global rate limit: 100 requests per minute
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' }
});
app.use(globalLimiter);

// Strict rate limit for auth + validation
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 15,
    message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' }
});

// Rate limit for public validation endpoint
const validarLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Muitas tentativas de validação. Tente novamente em 15 minutos.' }
});

// Request logging
app.use((req, res, next) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${req.method} ${req.url}`);
    next();
});

// ===== AUTH HELPERS / MIDDLEWARE =====
async function verifyEntraIdToken(idToken) {
    if (!isEntraConfigured || !jwks) {
        throw new Error('Entra ID não configurado');
    }
    const { payload } = await jwtVerify(idToken, jwks, {
        issuer: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`,
        audience: ENTRA_CLIENT_ID
    });
    return payload;
}

function requireSession(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'Sessão inválida' });
    }
    next();
}

function requireAdminOrSuper(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ error: 'Sessão inválida' });
    if (!['admin', 'superadmin'].includes(req.session.user.role)) {
        return res.status(403).json({ error: 'Sem permissão' });
    }
    next();
}

function requireSuperAdmin(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ error: 'Sessão inválida' });
    if (req.session.user.role !== 'superadmin') {
        return res.status(403).json({ error: 'Acesso restrito ao super admin' });
    }
    next();
}

// ===== AUDIT LOG HELPER =====
async function auditLog(req, acao, entidade, entidadeId, detalhes) {
    try {
        const usuario = req.session?.user?.email || 'sistema';
        const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection?.remoteAddress || 'unknown';
        await dbRun(
            'INSERT INTO audit_log (acao, entidade, entidade_id, usuario, detalhes, ip) VALUES (?, ?, ?, ?, ?, ?)',
            [acao, entidade, entidadeId || '', usuario, typeof detalhes === 'object' ? JSON.stringify(detalhes) : String(detalhes || ''), ip]
        );
    } catch (e) {
        console.warn('[AUDIT] Falha ao gravar log:', e.message);
    }
}

// ===== AUTH ROUTES (Microsoft Entra ID) =====

/**
 * GET /auth/login → redireciona para Microsoft
 */
app.get('/auth/login', authLimiter, async (req, res) => {
    if (!ENTRA_TENANT_ID || !ENTRA_CLIENT_ID || !ENTRA_CLIENT_SECRET) {
        return res.status(500).send('Entra ID não configurado. Preencha ENTRA_* no .env');
    }

    // Se o query param ?fabric=1, pede scopes extras do Power BI (precisa admin consent)
    const wantFabric = req.query.fabric === '1';
    const scopes = wantFabric
        ? ['openid', 'profile', 'email', 'https://analysis.windows.net/powerbi/api/Dataset.Read.All', 'https://analysis.windows.net/powerbi/api/Workspace.Read.All']
        : ['openid', 'profile', 'email'];

    const authCodeUrl = await msalClient.getAuthCodeUrl({
        redirectUri: ENTRA_REDIRECT_URI,
        scopes,
        prompt: 'select_account',
        state: wantFabric ? 'fabric' : ''
    });

    res.redirect(authCodeUrl);
});

/**
 * GET /auth/callback → recebe o code, troca por token, valida e cria sessão
 */
app.get('/auth/callback', async (req, res) => {
    try {
        const code = req.query.code;
        if (!code) return res.status(400).send('Código ausente');

        const wantFabric = req.query.state === 'fabric';
        const scopes = wantFabric
            ? ['openid', 'profile', 'email', 'https://analysis.windows.net/powerbi/api/Dataset.Read.All', 'https://analysis.windows.net/powerbi/api/Workspace.Read.All']
            : ['openid', 'profile', 'email'];

        const tokenResponse = await msalClient.acquireTokenByCode({
            code: String(code),
            redirectUri: ENTRA_REDIRECT_URI,
            scopes
        });

        const idToken = tokenResponse.idToken;
        const claims = await verifyEntraIdToken(idToken);

        const email =
            claims.preferred_username ||
            claims.email ||
            (Array.isArray(claims.emails) ? claims.emails[0] : null);

        const nome = claims.name || '';

        if (!email) return res.status(400).send('Não foi possível identificar o e-mail do usuário');

        // Verifica usuário cadastrado no banco e ativo
        const userRow = await dbGet('SELECT email, nome, role, ativo, criado_em FROM usuarios WHERE LOWER(email) = LOWER(?)', [email]);
        if (!userRow) {
            return res.status(403).send(`Usuário não cadastrado (${email}). Peça ao superadmin para adicionar seu e-mail.`);
        }
        if (!userRow.ativo) return res.status(403).send('Usuário inativo');

        // Opcional: atualizar nome se vazio
        if ((!userRow.nome || !userRow.nome.trim()) && nome) {
            await dbRun('UPDATE usuarios SET nome = ? WHERE LOWER(email) = LOWER(?)', [nome, email]);
        }

        req.session.user = {
            email: userRow.email,
            nome: userRow.nome || nome || '',
            role: userRow.role,
            ativo: !!userRow.ativo
        };

        // Audit log: login
        try {
            await dbRun(
                'INSERT INTO audit_log (usuario, acao, detalhes) VALUES (?, ?, ?)',
                [email, 'LOGIN', `Role: ${userRow.role}, IP: ${req.ip}`]
            );
        } catch (_) { /* não bloqueia login se audit falhar */ }

        // Guarda access token para fluxo delegado (Fabric/Power BI e Graph/GDAP)
        if (tokenResponse.accessToken) {
            req.session.fabricToken = tokenResponse.accessToken;
            req.session.graphToken = tokenResponse.accessToken;
        }

        // Redireciona baseado em role
        if (userRow.role === 'superadmin') return res.redirect('/superadmin');
        return res.redirect('/admin');
    } catch (err) {
        console.error('Erro no /auth/callback:', err);
        res.status(500).send('Erro ao autenticar');
    }
});

/**
 * GET /auth/logout → encerra sessão
 */
app.get('/auth/logout', (req, res) => {
    const userEmail = req.session?.user?.email || 'unknown';
    // Audit log: logout
    dbRun(
        'INSERT INTO audit_log (usuario, acao, detalhes) VALUES (?, ?, ?)',
        [userEmail, 'LOGOUT', `IP: ${req.ip}`]
    ).catch(() => { /* não bloqueia logout */ });
    req.session.destroy(() => {
        res.clearCookie('bp.sid');
        res.redirect('/login');
    });
});

/**
 * GET /auth/me → retorna usuário logado
 */
app.get('/auth/me', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ user: null });
    res.json({ user: req.session.user });
});

// ===== PAGE GUARDS =====
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/admin', (req, res) => {
    if (!req.session?.user) return res.redirect('/login');
    if (!['admin', 'superadmin'].includes(req.session.user.role)) return res.status(403).send('Sem permissão');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/superadmin', (req, res) => {
    if (!req.session?.user) return res.redirect('/login');
    if (req.session.user.role !== 'superadmin') return res.status(403).send('Acesso restrito ao super admin');
    res.sendFile(path.join(__dirname, 'public', 'superadmin.html'));
});

// Bloquear acesso direto a .html protegidos
app.get(['/admin.html', '/superadmin.html'], (req, res) => {
    res.redirect('/login');
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ===== MIDDLEWARE: Validação de Token =====
async function validateToken(req, res, next) {
    const { pedidoId, token } = req.params;

    if (!pedidoId || !token) {
        return res.status(400).json({ error: 'pedidoId e token são obrigatórios' });
    }

    // Sanitização básica
    if (!/^[A-Za-z0-9_-]+$/.test(pedidoId) || !/^[A-Za-z0-9_-]+$/.test(token)) {
        return res.status(400).json({ error: 'Formato de pedidoId ou token inválido' });
    }

    try {
        const pedido = await dbGet(
            'SELECT * FROM pedidos WHERE pedido_id = ? AND token = ?',
            [pedidoId, token]
        );

        if (!pedido) {
            return res.status(404).json({ error: 'Pedido não encontrado ou token inválido' });
        }

        req.pedido = pedido;
        next();
    } catch (err) {
        console.error('Erro na validação de token:', err);
        return res.status(500).json({ error: 'Erro interno ao validar token' });
    }
}

// ===== ROTAS API =====

/**
 * GET /health — Health check para monitoramento Azure
 */
app.get('/health', async (req, res) => {
    try {
        await dbGet('SELECT 1');
        res.json({ status: 'ok', uptime: process.uptime() });
    } catch (err) {
        res.status(503).json({ status: 'error', error: 'Database unreachable' });
    }
});

/**
 * GET /api/pedido/:pedidoId/:token
 * Retorna dados do pedido com licenças após validar token
 */
app.get('/api/pedido/:pedidoId/:token', validateToken, async (req, res) => {
    try {
        const pedido = req.pedido;
        const licencas = await dbAll(
            'SELECT produto, qtd, duracao, preco FROM licencas WHERE pedido_id = ?',
            [pedido.pedido_id]
        );

        // Buscar revendas associadas ao pedido via junction table
        const revendas = await dbAll(
            `SELECT r.id, r.nome, r.partner_id, r.link_base 
             FROM pedido_revendas pr 
             JOIN revendas r ON r.id = pr.revenda_id 
             WHERE pr.pedido_id = ?`,
            [pedido.pedido_id]
        );

        res.json({
            cliente: pedido.cliente,
            cnpj: pedido.cnpj,
            pedidoId: pedido.pedido_id,
            revenda: pedido.revenda,
            revendas: revendas.map(r => ({
                id: r.id,
                nome: r.nome,
                partnerId: r.partner_id || '',
                linkBase: r.link_base || ''
            })),
            status: pedido.status,
            gdapLink: pedido.gdap_link || process.env.GDAP_DEFAULT_LINK || null,
            licencas: licencas
        });
    } catch (err) {
        console.error('Erro ao buscar pedido:', err);
        res.status(500).json({ error: 'Erro interno ao buscar dados do pedido' });
    }
});

/**
 * POST /api/validar
 * Salva log completo da validação
 */
app.post('/api/validar', validarLimiter, async (req, res) => {
    try {
        const { pedidoId, token, revenda, timestamp, status } = req.body;

        if (!pedidoId || !token) {
            return res.status(400).json({ error: 'pedidoId e token são obrigatórios' });
        }

        // Captura IP real (considera proxy reverso)
        const ip = req.headers['x-forwarded-for']
            || req.headers['x-real-ip']
            || req.connection?.remoteAddress
            || req.socket?.remoteAddress
            || 'unknown';

        const userAgent = req.headers['user-agent'] || 'unknown';
        const logTimestamp = timestamp || new Date().toISOString();
        const logStatus = status || 'VALIDADO';

        // Insere log
        const result = await dbRun(
            `INSERT INTO logs (pedido_id, token, revenda, timestamp, ip, user_agent, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [pedidoId, token, revenda || 'unknown', logTimestamp, ip, userAgent, logStatus]
        );

        // Atualiza status do pedido
        await dbRun(
            `UPDATE pedidos SET status = 'VALIDADO', atualizado_em = CURRENT_TIMESTAMP 
             WHERE pedido_id = ?`,
            [pedidoId]
        );

        console.log(`✅ Validação registrada: ${pedidoId} via ${revenda} | IP: ${ip}`);

        res.json({
            success: true,
            logId: result.lastID,
            message: 'Validação registrada com sucesso'
        });
    } catch (err) {
        console.error('Erro ao salvar validação:', err);
        res.status(500).json({ error: 'Erro interno ao salvar validação' });
    }
});

/**
 * POST /api/pedidos
 * Cria um novo pedido e gera link único para enviar ao cliente
 */
app.post('/api/pedidos', requireAdminOrSuper, async (req, res) => {
    try {
        const { cliente, cnpj, revendas: revendaIds } = req.body;

        if (!cliente || !cnpj) {
            return res.status(400).json({ error: 'Nome do cliente e CNPJ são obrigatórios' });
        }

        // Revendas são opcionais
        let validRevendas = [];
        if (Array.isArray(revendaIds) && revendaIds.length > 0) {
            const placeholders = revendaIds.map(() => '?').join(',');
            validRevendas = await dbAll(
                `SELECT id, nome FROM revendas WHERE id IN (${placeholders}) AND ativo = 1`,
                revendaIds
            );
        }

        // Gera pedidoId com componente aleatório (não sequencial)
        const ts = Date.now().toString(36);
        const rand = crypto.randomBytes(3).toString('hex');
        const pedidoId = `PED-${ts}-${rand}`.toUpperCase();

        // Gera token forte (32 chars hex = 128 bits de entropia)
        const token = crypto.randomBytes(16).toString('hex');

        // Tenta gerar link GDAP individual para este pedido
        let gdapLink = null;
        let gdapRelationshipId = null;

        // 1. Tenta pegar do pool de links pré-cadastrados (atomic claim para evitar race condition)
        const claimResult = await dbRun(
            "UPDATE gdap_pool SET status = 'usado', pedido_id = ?, usado_em = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM gdap_pool WHERE status = 'disponivel' ORDER BY criado_em ASC LIMIT 1)",
            [pedidoId]
        );
        if (claimResult.changes > 0) {
            const claimed = await dbGet("SELECT link FROM gdap_pool WHERE pedido_id = ? AND status = 'usado' ORDER BY usado_em DESC LIMIT 1", [pedidoId]);
            if (claimed) gdapLink = claimed.link;
            console.log(`[GDAP Pool] Link atribuído ao pedido ${pedidoId}`);
        }

        // 2. Se não tem no pool, tenta gerar via API (se configurada)
        if (!gdapLink && isGdapConfigured()) {
            try {
                console.log(`[GDAP] Gerando convite individual para pedido ${pedidoId}...`);
                const gdapResult = await criarConviteGDAP({
                    displayName: `Licenças - ${cliente.trim()} (${pedidoId})`
                });
                gdapLink = gdapResult.inviteLink;
                gdapRelationshipId = gdapResult.relationshipId;
                console.log(`[GDAP] ✅ Link gerado para ${pedidoId}: ${gdapLink}`);
            } catch (gdapErr) {
                console.error(`[GDAP] ⚠️ Falha ao gerar link para ${pedidoId}:`, gdapErr.message);
            }
        }

        // 3. Fallback: usa link GDAP padrão do .env
        if (!gdapLink && process.env.GDAP_DEFAULT_LINK) {
            gdapLink = process.env.GDAP_DEFAULT_LINK;
            console.log(`[GDAP] Usando link padrão (GDAP_DEFAULT_LINK) para ${pedidoId}`);
        }

        // Monta revenda legado (primeiro nome) e revenda_nome para backward compat
        const primeiraRevenda = validRevendas.length > 0 ? validRevendas[0] : null;
        const revendaVal = primeiraRevenda ? primeiraRevenda.nome.toLowerCase().replace(/\s+/g, '_') : null;
        const revendaNome = validRevendas.length > 0 ? validRevendas.map(r => r.nome).join(', ') : null;

        await dbRun(
            'INSERT INTO pedidos (pedido_id, token, cliente, cnpj, revenda, revenda_nome, gdap_link, gdap_relationship_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [pedidoId, token, cliente.trim(), cnpj.trim(), revendaVal, revendaNome, gdapLink, gdapRelationshipId]
        );

        // Inserir associações na tabela pedido_revendas
        for (const rv of validRevendas) {
            await dbRun(
                'INSERT INTO pedido_revendas (pedido_id, revenda_id) VALUES (?, ?)',
                [pedidoId, rv.id]
            );
        }

        const revendaNomes = validRevendas.map(r => r.nome);
        console.log(`📋 Novo pedido criado: ${pedidoId} → ${cliente} [Revendas: ${revendaNomes.join(', ') || 'nenhuma'}]`);
        await auditLog(req, 'CRIAR_PEDIDO', 'pedido', pedidoId, { cliente: cliente.trim(), cnpj: cnpj.trim(), revendas: revendaNomes });

        res.json({
            success: true,
            pedidoId,
            token,
            cliente: cliente.trim(),
            cnpj: cnpj.trim(),
            revendas: revendaNomes,
            gdapLink,
            link: `/?pedidoId=${pedidoId}&token=${token}`
        });
    } catch (err) {
        console.error('Erro ao criar pedido:', err);
        res.status(500).json({ error: 'Erro interno ao criar pedido' });
    }
});

/**
 * POST /api/pedidos/batch
 * Cria múltiplos pedidos em lote, consulta CNPJ na OpenCNPJ e retorna links.
 * Body: { pedidos: [{ pedidoId?: string, cnpj: string, revendas?: number[] }] }
 * Usado pelo Power Automate / Copilot Studio.
 */
app.post('/api/pedidos/batch', requireAdminOrSuper, async (req, res) => {
    try {
        const { pedidos } = req.body;

        if (!Array.isArray(pedidos) || pedidos.length === 0) {
            return res.status(400).json({ error: 'Envie um array "pedidos" com pelo menos 1 item' });
        }

        if (pedidos.length > 100) {
            return res.status(400).json({ error: 'Máximo de 100 pedidos por lote' });
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const results = [];

        for (const item of pedidos) {
            const cnpjRaw = String(item.cnpj || '').replace(/[.\-\/]/g, '').replace(/\D/g, '');

            if (!/^\d{14}$/.test(cnpjRaw)) {
                results.push({
                    pedidoId: item.pedidoId || null,
                    erro: `CNPJ inválido: ${item.cnpj || '(vazio)'}`
                });
                continue;
            }

            // Consulta OpenCNPJ
            let cliente = '';
            let situacao = '';
            try {
                const cnpjRes = await fetch(`https://api.opencnpj.org/${cnpjRaw}`, {
                    headers: { 'Accept': 'application/json', 'User-Agent': 'BluePartner-Validacao/1.0' }
                });
                if (cnpjRes.ok) {
                    const cnpjData = await cnpjRes.json();
                    cliente = cnpjData.razao_social || '';
                    situacao = cnpjData.situacao_cadastral || '';
                }
            } catch (e) {
                console.warn(`[BATCH] Falha ao consultar CNPJ ${cnpjRaw}:`, e.message);
            }

            // Gera identificadores
            const ts = Date.now().toString(36);
            const rand = crypto.randomBytes(3).toString('hex');
            const pedidoId = (item.pedidoId || `PED-${ts}-${rand}`).toUpperCase();
            const token = crypto.randomBytes(16).toString('hex');

            // Resolve revendas: aceita array de IDs ou fallback
            let revendaIds = item.revendas;
            if (!Array.isArray(revendaIds) || revendaIds.length === 0) {
                // Backward compat: tenta converter campo revenda (string) para ID
                if (item.revenda) {
                    const rv = await dbGet('SELECT id FROM revendas WHERE LOWER(nome) = LOWER(?) AND ativo = 1', [item.revenda]);
                    if (rv) revendaIds = [rv.id];
                }
            }
            if (!Array.isArray(revendaIds) || revendaIds.length === 0) {
                // Pega primeira revenda ativa como fallback
                const fallback = await dbGet('SELECT id FROM revendas WHERE ativo = 1 ORDER BY id ASC LIMIT 1');
                revendaIds = fallback ? [fallback.id] : [];
            }

            // Valida revendas
            let validRevendas = [];
            if (revendaIds.length > 0) {
                const ph = revendaIds.map(() => '?').join(',');
                validRevendas = await dbAll(`SELECT id, nome FROM revendas WHERE id IN (${ph}) AND ativo = 1`, revendaIds);
            }

            // GDAP: pool → API → fallback
            let gdapLink = null;
            let gdapRelationshipId = null;

            const claimResult = await dbRun(
                "UPDATE gdap_pool SET status = 'usado', pedido_id = ?, usado_em = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM gdap_pool WHERE status = 'disponivel' ORDER BY criado_em ASC LIMIT 1)",
                [pedidoId]
            );
            if (claimResult.changes > 0) {
                const claimed = await dbGet("SELECT link FROM gdap_pool WHERE pedido_id = ? AND status = 'usado' ORDER BY usado_em DESC LIMIT 1", [pedidoId]);
                if (claimed) gdapLink = claimed.link;
            } else if (isGdapConfigured()) {
                try {
                    const gdapResult = await criarConviteGDAP({ displayName: `Licenças - ${cliente || cnpjRaw} (${pedidoId})` });
                    gdapLink = gdapResult.inviteLink;
                    gdapRelationshipId = gdapResult.relationshipId;
                } catch (e) {
                    console.warn(`[BATCH] GDAP falhou para ${pedidoId}:`, e.message);
                }
            }
            if (!gdapLink && process.env.GDAP_DEFAULT_LINK) {
                gdapLink = process.env.GDAP_DEFAULT_LINK;
            }

            // Monta dados legado
            const revendaNomes = validRevendas.map(r => r.nome);
            const revendaVal = validRevendas.length > 0 ? validRevendas[0].nome.toLowerCase().replace(/\s+/g, '_') : '';
            const revendaNome = revendaNomes.join(', ');

            // Insere pedido no banco
            await dbRun(
                'INSERT INTO pedidos (pedido_id, token, cliente, cnpj, revenda, revenda_nome, gdap_link, gdap_relationship_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [pedidoId, token, cliente.trim(), cnpjRaw, revendaVal, revendaNome, gdapLink, gdapRelationshipId]
            );

            // Insere associações pedido_revendas
            for (const rv of validRevendas) {
                await dbRun('INSERT INTO pedido_revendas (pedido_id, revenda_id) VALUES (?, ?)', [pedidoId, rv.id]);
            }

            const link = `${baseUrl}/?pedidoId=${pedidoId}&token=${token}`;

            results.push({ pedidoId, link, cliente, situacao, revendas: revendaNomes });
        }

        console.log(`📦 Batch: ${results.length} pedidos criados`);
        res.json({ total: results.length, links: results });
    } catch (err) {
        console.error('Erro no batch de pedidos:', err);
        res.status(500).json({ error: 'Erro interno ao processar lote' });
    }
});

/**
 * GET /api/pedido-completo/:pedidoId
 * Retorna pedido com token (uso interno admin — REQUER AUTH)
 */
app.get('/api/pedido-completo/:pedidoId', requireAdminOrSuper, async (req, res) => {
    try {
        const pedido = await dbGet(
            'SELECT pedido_id, token, cliente, cnpj, revenda, revenda_nome, status, gdap_link FROM pedidos WHERE pedido_id = ?',
            [req.params.pedidoId]
        );
        if (!pedido) return res.status(404).json({ error: 'Não encontrado' });

        const revendas = await dbAll(
            `SELECT r.id, r.nome FROM pedido_revendas pr JOIN revendas r ON r.id = pr.revenda_id WHERE pr.pedido_id = ?`,
            [pedido.pedido_id]
        );

        res.json({ ...pedido, gdap_link: pedido.gdap_link || null, revendas });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno' });
    }
});

/**
 * PUT /api/pedidos/:pedidoId
 * Edita um pedido existente
 */
app.put('/api/pedidos/:pedidoId', requireAdminOrSuper, async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const { cliente, cnpj, revendas: revendaIds, gdapLink } = req.body;

        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });

        const newCliente = (cliente || pedido.cliente).trim();
        const newCnpj = (cnpj || pedido.cnpj).trim();

        // Atualiza link GDAP se fornecido (permite inserção/edição manual)
        const newGdapLink = gdapLink !== undefined ? (gdapLink || null) : pedido.gdap_link;

        // Se revendaIds fornecido, atualiza associações
        let revendaNomes = [];
        if (Array.isArray(revendaIds) && revendaIds.length > 0) {
            const ph = revendaIds.map(() => '?').join(',');
            const validRevendas = await dbAll(
                `SELECT id, nome FROM revendas WHERE id IN (${ph}) AND ativo = 1`,
                revendaIds
            );
            if (validRevendas.length === 0) {
                return res.status(400).json({ error: 'Nenhuma revenda válida selecionada' });
            }

            // Remove associações antigas e insere novas
            await dbRun('DELETE FROM pedido_revendas WHERE pedido_id = ?', [pedidoId]);
            for (const rv of validRevendas) {
                await dbRun('INSERT INTO pedido_revendas (pedido_id, revenda_id) VALUES (?, ?)', [pedidoId, rv.id]);
            }
            revendaNomes = validRevendas.map(r => r.nome);
        } else {
            // Mantém revendas existentes
            const existingRvs = await dbAll(
                `SELECT r.nome FROM pedido_revendas pr JOIN revendas r ON r.id = pr.revenda_id WHERE pr.pedido_id = ?`,
                [pedidoId]
            );
            revendaNomes = existingRvs.map(r => r.nome);
        }

        const newRevenda = revendaNomes.length > 0 ? revendaNomes[0].toLowerCase().replace(/\s+/g, '_') : (pedido.revenda || '');
        const newRevendaNome = revendaNomes.length > 0 ? revendaNomes.join(', ') : (pedido.revenda_nome || '');

        await dbRun(
            'UPDATE pedidos SET cliente = ?, cnpj = ?, revenda = ?, revenda_nome = ?, gdap_link = ?, atualizado_em = CURRENT_TIMESTAMP WHERE pedido_id = ?',
            [newCliente, newCnpj, newRevenda, newRevendaNome, newGdapLink, pedidoId]
        );

        console.log(`✏️ Pedido editado: ${pedidoId}`);
        await auditLog(req, 'EDITAR_PEDIDO', 'pedido', pedidoId, { cliente: newCliente, cnpj: newCnpj, revendas: revendaNomes });
        res.json({ success: true, pedidoId, cliente: newCliente, cnpj: newCnpj, revendas: revendaNomes, gdapLink: newGdapLink });
    } catch (err) {
        console.error('Erro ao editar pedido:', err);
        res.status(500).json({ error: 'Erro interno ao editar pedido' });
    }
});

/**
 * GET /api/licencas/:pedidoId
 * Lista licenças de um pedido (uso admin)
 */
app.get('/api/licencas/:pedidoId', requireAdminOrSuper, async (req, res) => {
    try {
        const licencas = await dbAll(
            'SELECT id, pedido_id, produto, qtd, duracao, preco FROM licencas WHERE pedido_id = ? ORDER BY id ASC',
            [req.params.pedidoId]
        );
        res.json({ pedidoId: req.params.pedidoId, total: licencas.length, licencas });
    } catch (err) {
        console.error('Erro ao buscar licenças:', err);
        res.status(500).json({ error: 'Erro ao buscar licenças' });
    }
});

/**
 * POST /api/licencas/:pedidoId
 * Adiciona uma licença a um pedido
 */
app.post('/api/licencas/:pedidoId', requireAdminOrSuper, async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const { produto, qtd, duracao, preco } = req.body;

        if (!produto || !preco) {
            return res.status(400).json({ error: 'Produto e preço são obrigatórios' });
        }

        const pedido = await dbGet('SELECT id FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });

        const result = await dbRun(
            'INSERT INTO licencas (pedido_id, produto, qtd, duracao, preco) VALUES (?, ?, ?, ?, ?)',
            [pedidoId, produto.trim(), qtd || 1, duracao || '12 meses NCE', preco.trim()]
        );

        console.log(`📦 Licença adicionada ao pedido ${pedidoId}: ${produto}`);
        res.json({ success: true, id: result.lastID, pedidoId, produto: produto.trim() });
    } catch (err) {
        console.error('Erro ao adicionar licença:', err);
        res.status(500).json({ error: 'Erro interno ao adicionar licença' });
    }
});

/**
 * DELETE /api/licencas/:licencaId
 * Remove uma licença específica
 */
app.delete('/api/licencas/:licencaId', requireAdminOrSuper, async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM licencas WHERE id = ?', [req.params.licencaId]);
        if (result.changes === 0) return res.status(404).json({ error: 'Licença não encontrada' });
        res.json({ success: true, message: 'Licença removida' });
    } catch (err) {
        console.error('Erro ao remover licença:', err);
        res.status(500).json({ error: 'Erro interno' });
    }
});

/**
 * POST /api/proposta/:pedidoId
 * Upload de proposta (PDF, CSV, XLSX, XLS) e importa itens como licenças
 */
app.post('/api/proposta/:pedidoId', requireAdminOrSuper, upload.single('arquivo'), async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (!pedido) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

        const ext = path.extname(req.file.originalname).toLowerCase();
        let items = [];

        if (ext === '.csv') {
            // Parse CSV
            const raw = fs.readFileSync(req.file.path, 'utf-8');
            const lines = raw.split(/\r?\n/).filter(l => l.trim());
            if (lines.length < 2) {
                fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'Arquivo CSV vazio ou sem dados' });
            }
            // Detect separator
            const sep = lines[0].includes(';') ? ';' : ',';
            const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/["']/g, ''));
            
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
                if (cols.length < 2) continue;
                const item = mapColumns(headers, cols);
                if (item.produto) items.push(item);
            }
        } else if (['.xlsx', '.xls'].includes(ext)) {
            // Parse Excel
            const workbook = XLSX.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            if (!rows.length) {
                fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'Planilha vazia' });
            }

            const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim());
            for (const row of rows) {
                const cols = Object.values(row).map(v => String(v).trim());
                const item = mapColumns(headers, cols);
                if (item.produto) items.push(item);
            }
        } else if (['.docx', '.doc'].includes(ext)) {
            // Parse Word
            const result = await mammoth.extractRawText({ path: req.file.path });
            const text = result.value || '';
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);

            for (const line of lines) {
                const pricePattern = /R\$\s*[\d.,]+/g;
                const prices = line.match(pricePattern);
                if (prices && prices.length >= 1) {
                    let productName = line;
                    prices.forEach(p => { productName = productName.replace(p, ''); });
                    const qtyMatch = productName.match(/(\d+)\s*$/);
                    const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                    if (qtyMatch) productName = productName.replace(qtyMatch[0], '');
                    productName = productName.replace(/\s+/g, ' ').replace(/^[\s,\-]+|[\s,\-]+$/g, '').trim();
                    if (productName.length > 3) {
                        items.push({ produto: productName, qtd: qty, duracao: '12 meses NCE', preco: prices[0] });
                    }
                }
            }
        } else if (ext === '.pdf') {
            // Parse PDF — extract table from BluePartner proposal format
            const pdfBuffer = fs.readFileSync(req.file.path);
            const pdfData = await pdfParse(pdfBuffer);
            const text = pdfData.text || '';

            // Strategy: join all lines between table header and total, then split by SKU
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
            let inTable = false;
            let tableText = '';

            for (const line of lines) {
                if (/part[\-\s]?number/i.test(line) && /produto/i.test(line)) {
                    inTable = true;
                    continue;
                }
                if (inTable && /^total\s+(mensal|anual)/i.test(line)) break;
                if (inTable && /^(condi[çc]|proposta\s+v[aá]lida|12\s+parcelas|pagamento)/i.test(line)) break;
                if (inTable) tableText += line + ' ';
            }

            // Split by SKU codes (e.g., CFQ7TTC0LH0L0001P1YM)
            // Use lazy match + lookahead to avoid eating first letter of product name
            const skuPattern = /([A-Z]{3}[A-Z0-9]{10,}?(?=[A-Z][a-z]|\s|$))/g;
            const skuMatches = [...tableText.matchAll(skuPattern)];

            if (skuMatches.length > 0) {
                for (let i = 0; i < skuMatches.length; i++) {
                    const start = skuMatches[i].index + skuMatches[i][0].length;
                    const end = i + 1 < skuMatches.length ? skuMatches[i + 1].index : tableText.length;
                    let segment = tableText.substring(start, end).trim();

                    // Try to extract: ProductName ... R$ unitPrice QTY R$ totalPrice
                    // The qty is glued between unit price and total price
                    // Pattern: R$ DD,DD + QTY(1-4 digits) + R$ DD,DD
                    const priceQtyPattern = /R\$\s*(\d+[.,]\d{2})(\d{1,4})R\$\s*([\d.,]+)/;
                    const pqMatch = segment.match(priceQtyPattern);

                    let productName, qty, preco;

                    if (pqMatch) {
                        preco = 'R$ ' + pqMatch[1];
                        qty = parseInt(pqMatch[2]) || 1;
                        // Product name is everything before the first R$
                        const firstR = segment.indexOf('R$');
                        productName = firstR > 0 ? segment.substring(0, firstR).trim() : segment;
                    } else {
                        // Fallback: extract prices normally
                        const allPrices = segment.match(/R\$\s*[\d.,]+/g) || [];
                        preco = allPrices[0] || '—';
                        // Remove prices to get product + qty
                        let cleaned = segment;
                        allPrices.forEach(p => { cleaned = cleaned.replace(p, ' '); });
                        const qtyMatch = cleaned.match(/\b(\d{1,4})\b\s*$/);
                        qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                        if (qtyMatch) cleaned = cleaned.replace(new RegExp('\\b' + qtyMatch[1] + '\\b\\s*$'), '');
                        productName = cleaned;
                    }

                    // Clean product name
                    productName = productName
                        .replace(/\(NCE[^)]*\)/gi, '')
                        .replace(/NCE\s+COM\s+MTH[\-\s]*ANN/gi, '')
                        .replace(/[\(\)]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .replace(/^[\s,\-]+|[\s,\-]+$/g, '')
                        .trim();

                    if (productName.length > 3 && preco) {
                        items.push({
                            produto: productName,
                            qtd: qty,
                            duracao: '12 meses NCE',
                            preco: preco
                        });
                    }
                }
            } else {
                // Fallback: try line-by-line parsing for non-SKU PDFs
                for (const line of lines) {
                    if (!inTable) continue;
                    const pricePattern = /R\$\s*[\d.,]+/g;
                    const prices = line.match(pricePattern);
                    if (prices && prices.length >= 1) {
                        let productName = line;
                        prices.forEach(p => { productName = productName.replace(p, ''); });
                        const qtyMatch = productName.match(/(\d+)\s*$/);
                        const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                        if (qtyMatch) productName = productName.replace(qtyMatch[0], '');
                        productName = productName.replace(/\s+/g, ' ').replace(/^[\s,\-]+|[\s,\-]+$/g, '').trim();
                        if (productName.length > 3) {
                            items.push({ produto: productName, qtd: qty, duracao: '12 meses NCE', preco: prices[0] });
                        }
                    }
                }
            }
        } else {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Formato não suportado. Use PDF, CSV, XLSX ou XLS.' });
        }

        // Clean up file
        fs.unlinkSync(req.file.path);

        if (!items.length) {
            return res.status(400).json({ error: 'Nenhum item encontrado na proposta. Verifique se as colunas estão corretas.' });
        }

        // Insert all items as licenses
        let inserted = 0;
        for (const item of items) {
            await dbRun(
                'INSERT INTO licencas (pedido_id, produto, qtd, duracao, preco) VALUES (?, ?, ?, ?, ?)',
                [pedidoId, item.produto, item.qtd, item.duracao, item.preco]
            );
            inserted++;
        }

        console.log(`[PROPOSTA] ${inserted} itens importados para ${pedidoId}`);
        await auditLog(req, 'UPLOAD_PROPOSTA', 'pedido', pedidoId, {
            arquivo: req.file.originalname,
            tipo: ext,
            itensImportados: inserted,
            itens: items.map(i => ({ produto: i.produto, qtd: i.qtd }))
        });
        res.json({ success: true, imported: inserted, items });
    } catch (err) {
        console.error('Erro ao processar proposta:', err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Erro ao processar arquivo: ' + err.message });
    }
});

/**
 * Helper: map column headers to fields
 */
function mapColumns(headers, cols) {
    const find = (...keywords) => {
        const idx = headers.findIndex(h => keywords.some(k => h.includes(k)));
        return idx >= 0 ? cols[idx] : '';
    };

    const produto = find('produto', 'product', 'item', 'descri', 'nome', 'licen', 'name', 'sku', 'oferta', 'offer');
    const qtdRaw = find('qtd', 'quant', 'qty', 'seats', 'usu', 'licen');
    const duracao = find('dura', 'period', 'vigencia', 'prazo', 'term', 'billing') || '12 meses NCE';
    const preco = find('preco', 'preço', 'price', 'valor', 'value', 'custo', 'cost', 'unit');

    return {
        produto: produto || '',
        qtd: parseInt(qtdRaw) || 1,
        duracao: duracao || '12 meses NCE',
        preco: preco || '—'
    };
}

/**
 * GET /api/pedidos/:pedidoId/historico
 * Retorna histórico completo de um pedido: dados, licenças, revendas, validações, e eventos do audit_log
 */
app.get('/api/pedidos/:pedidoId/historico', requireAdminOrSuper, async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });

        // Licenças atuais
        const licencas = await dbAll(
            'SELECT id, produto, qtd, duracao, preco FROM licencas WHERE pedido_id = ? ORDER BY id ASC',
            [pedidoId]
        );

        // Revendas associadas
        const revendas = await dbAll(
            `SELECT r.id, r.nome, r.categoria 
             FROM pedido_revendas pr 
             JOIN revendas r ON r.id = pr.revenda_id 
             WHERE pr.pedido_id = ?`,
            [pedidoId]
        );

        // Logs de validação (acessos do cliente)
        const validacoes = await dbAll(
            'SELECT id, timestamp, ip, user_agent, status, criado_em FROM logs WHERE pedido_id = ? ORDER BY criado_em DESC',
            [pedidoId]
        );

        // Eventos do audit_log (ações do admin)
        const eventos = await dbAll(
            'SELECT id, acao, usuario, detalhes, ip, criado_em FROM audit_log WHERE entidade_id = ? ORDER BY criado_em DESC',
            [pedidoId]
        );

        // Montar timeline unificada
        const timeline = [];

        // Criação do pedido
        timeline.push({
            tipo: 'criacao',
            icone: '🆕',
            titulo: 'Pedido criado',
            descricao: `Cliente: ${pedido.cliente} | CNPJ: ${pedido.cnpj}`,
            data: pedido.criado_em,
            usuario: null
        });

        // Eventos do audit_log
        for (const ev of eventos) {
            let titulo = ev.acao;
            let descricao = '';
            let icone = '📝';
            let detalhes = {};
            try { detalhes = JSON.parse(ev.detalhes || '{}'); } catch(e) {}

            switch (ev.acao) {
                case 'CRIAR_PEDIDO':
                    continue; // Já adicionamos acima
                case 'EDITAR_PEDIDO':
                    icone = '✏️';
                    titulo = 'Pedido editado';
                    descricao = detalhes.alteracoes || JSON.stringify(detalhes);
                    break;
                case 'UPLOAD_PROPOSTA':
                    icone = '📄';
                    titulo = 'Proposta importada';
                    descricao = `Arquivo: ${detalhes.arquivo || '?'} | ${detalhes.itensImportados || 0} licenças importadas`;
                    break;
                case 'EXCLUIR_PEDIDO':
                    icone = '🗑️';
                    titulo = 'Pedido excluído';
                    break;
                default:
                    descricao = JSON.stringify(detalhes).substring(0, 200);
            }

            timeline.push({
                tipo: 'evento',
                icone,
                titulo,
                descricao,
                data: ev.criado_em,
                usuario: ev.usuario
            });
        }

        // Validações do cliente
        for (const v of validacoes) {
            timeline.push({
                tipo: 'validacao',
                icone: v.status === 'VALIDADO' ? '✅' : '📋',
                titulo: v.status === 'VALIDADO' ? 'Cliente validou o pedido' : 'Cliente acessou o link',
                descricao: `IP: ${v.ip || '?'}`,
                data: v.criado_em || v.timestamp,
                usuario: null
            });
        }

        // Ordenar timeline por data (mais recente primeiro)
        timeline.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

        // GDAP info
        let gdapInfo = null;
        if (pedido.gdap_link || pedido.gdap_relationship_id) {
            gdapInfo = {
                link: pedido.gdap_link,
                relationshipId: pedido.gdap_relationship_id,
                status: pedido.gdap_relationship_id ? 'configurado' : 'link_manual'
            };
        }

        res.json({
            pedido: {
                pedidoId: pedido.pedido_id,
                cliente: pedido.cliente,
                cnpj: pedido.cnpj,
                status: pedido.status,
                revendaNome: pedido.revenda_nome || pedido.revenda,
                gdapLink: pedido.gdap_link,
                criadoEm: pedido.criado_em,
                atualizadoEm: pedido.atualizado_em
            },
            licencas,
            revendas,
            gdapInfo,
            validacoes,
            timeline,
            totalLicencas: licencas.length,
            totalValidacoes: validacoes.length
        });

    } catch (err) {
        console.error('❌ Erro ao buscar histórico:', err);
        res.status(500).json({ error: 'Erro ao buscar histórico', message: err.message });
    }
});

/**
 * DELETE /api/pedidos/:pedidoId
 * Remove um pedido
 */
app.delete('/api/pedidos/:pedidoId', requireAdminOrSuper, async (req, res) => {
    try {
        const { pedidoId } = req.params;
        await dbRun('DELETE FROM pedido_revendas WHERE pedido_id = ?', [pedidoId]);
        await dbRun('DELETE FROM licencas WHERE pedido_id = ?', [pedidoId]);
        await dbRun('DELETE FROM logs WHERE pedido_id = ?', [pedidoId]);
        const result = await dbRun('DELETE FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        await auditLog(req, 'EXCLUIR_PEDIDO', 'pedido', pedidoId, {});
        res.json({ success: true, message: `Pedido ${pedidoId} removido` });
    } catch (err) {
        console.error('Erro ao remover pedido:', err);
        res.status(500).json({ error: 'Erro interno' });
    }
});

/**
 * GET /api/logs/:pedidoId
 * Retorna logs de validação de um pedido (uso interno)
 */
app.get('/api/logs/:pedidoId', requireAdminOrSuper, async (req, res) => {
    try {
        const logs = await dbAll(
            'SELECT * FROM logs WHERE pedido_id = ? ORDER BY criado_em DESC',
            [req.params.pedidoId]
        );
        res.json({ pedidoId: req.params.pedidoId, total: logs.length, logs });
    } catch (err) {
        console.error('Erro ao buscar logs:', err);
        res.status(500).json({ error: 'Erro ao buscar logs' });
    }
});

/**
 * GET /api/logs
 * Lista logs com filtro e paginação (para a tela "Logs")
 * Query:
 * - pedidoId (opcional)
 * - from (YYYY-MM-DD) (opcional)
 * - to (YYYY-MM-DD) (opcional)
 * - page (default 1)
 * - pageSize (default 10, max 100)
 */
app.get('/api/logs', requireAdminOrSuper, async (req, res) => {
    try {
        const pedidoId = (req.query.pedidoId || '').toString().trim();
        const from = (req.query.from || '').toString().trim();
        const to = (req.query.to || '').toString().trim();

        const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
        const pageSizeRaw = parseInt(req.query.pageSize || '10', 10) || 10;
        const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
        const offset = (page - 1) * pageSize;

        const where = [];
        const params = [];

        if (pedidoId) {
            where.push('pedido_id = ?');
            params.push(pedidoId);
        }

        if (from) {
            // include day start
            where.push("datetime(timestamp) >= datetime(? || ' 00:00:00')");
            params.push(from);
        }
        if (to) {
            // include day end
            where.push("datetime(timestamp) <= datetime(? || ' 23:59:59')");
            params.push(to);
        }

        const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

        const totalRow = await dbGet(
            `SELECT COUNT(*) as total FROM logs ${whereSql}`,
            params
        );

        const logs = await dbAll(
            `SELECT * FROM logs ${whereSql} ORDER BY criado_em DESC LIMIT ? OFFSET ?`,
            [...params, pageSize, offset]
        );

        res.json({
            page,
            pageSize,
            total: totalRow?.total || 0,
            totalPages: Math.max(1, Math.ceil((totalRow?.total || 0) / pageSize)),
            logs
        });
    } catch (err) {
        console.error('Erro ao listar logs:', err);
        res.status(500).json({ error: 'Erro ao listar logs' });
    }
});

/**
 * GET /api/pedidos
 * Lista pedidos com filtros opcionais e paginação
 * Query: search, status, revenda, from, to, page, pageSize
 */
app.get('/api/pedidos', requireAdminOrSuper, async (req, res) => {
    try {
        const search = (req.query.search || '').trim();
        const statusFilter = (req.query.status || '').trim().toUpperCase();
        const revendaFilter = (req.query.revenda || '').trim();
        const from = (req.query.from || '').trim();
        const to = (req.query.to || '').trim();

        const where = [];
        const params = [];

        if (search) {
            where.push("(p.pedido_id LIKE ? OR p.cliente LIKE ? OR p.cnpj LIKE ? OR p.revenda_nome LIKE ?)");
            const like = `%${search}%`;
            params.push(like, like, like, like);
        }
        if (statusFilter && ['PENDENTE', 'VALIDADO', 'DIVERGENTE'].includes(statusFilter)) {
            where.push("p.status = ?");
            params.push(statusFilter);
        }
        if (revendaFilter) {
            where.push("(p.revenda_nome LIKE ? OR p.pedido_id IN (SELECT pr2.pedido_id FROM pedido_revendas pr2 JOIN revendas r2 ON r2.id = pr2.revenda_id WHERE r2.nome LIKE ?))");
            params.push(`%${revendaFilter}%`, `%${revendaFilter}%`);
        }
        if (from) {
            where.push("p.criado_em >= datetime(? || ' 00:00:00')");
            params.push(from);
        }
        if (to) {
            where.push("p.criado_em <= datetime(? || ' 23:59:59')");
            params.push(to);
        }

        const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

        const totalRow = await dbGet(`SELECT COUNT(*) as total FROM pedidos p ${whereSql}`, params);
        const total = totalRow?.total || 0;

        // Paginação opcional (se page vier, pagina; senão retorna tudo para backward compat)
        const pageRaw = parseInt(req.query.page || '0', 10);
        const pageSizeRaw = parseInt(req.query.pageSize || '50', 10);
        const page = pageRaw > 0 ? pageRaw : 0;
        const pageSize = Math.min(200, Math.max(1, pageSizeRaw));

        let sql = `SELECT p.pedido_id, p.cliente, p.cnpj, p.revenda, p.revenda_nome, p.status, p.criado_em, p.atualizado_em FROM pedidos p ${whereSql} ORDER BY p.criado_em DESC`;
        const queryParams = [...params];

        if (page > 0) {
            sql += ` LIMIT ? OFFSET ?`;
            queryParams.push(pageSize, (page - 1) * pageSize);
        } else {
            // Safeguard: limita mesmo sem paginação explícita
            sql += ` LIMIT 1000`;
        }

        const pedidos = await dbAll(sql, queryParams);

        // Buscar revendas de todos os pedidos de uma vez
        const allPR = await dbAll(
            `SELECT pr.pedido_id, r.id as revenda_id, r.nome as revenda_nome_full 
             FROM pedido_revendas pr 
             JOIN revendas r ON r.id = pr.revenda_id`
        );
        const prMap = {};
        for (const pr of allPR) {
            if (!prMap[pr.pedido_id]) prMap[pr.pedido_id] = [];
            prMap[pr.pedido_id].push({ id: pr.revenda_id, nome: pr.revenda_nome_full });
        }

        const result = pedidos.map(p => ({
            ...p,
            revendas: prMap[p.pedido_id] || []
        }));

        const resp = { total, pedidos: result };
        if (page > 0) {
            resp.page = page;
            resp.pageSize = pageSize;
            resp.totalPages = Math.max(1, Math.ceil(total / pageSize));
        }
        res.json(resp);
    } catch (err) {
        console.error('Erro ao listar pedidos:', err);
        res.status(500).json({ error: 'Erro ao listar pedidos' });
    }
});

/**
 * GET /api/pedidos/exportar
 * Exporta pedidos como CSV (com mesmos filtros)
 */
app.get('/api/pedidos/exportar', requireAdminOrSuper, async (req, res) => {
    try {
        const search = (req.query.search || '').trim();
        const statusFilter = (req.query.status || '').trim().toUpperCase();
        const revendaFilter = (req.query.revenda || '').trim();
        const from = (req.query.from || '').trim();
        const to = (req.query.to || '').trim();

        const where = [];
        const params = [];

        if (search) {
            where.push("(p.pedido_id LIKE ? OR p.cliente LIKE ? OR p.cnpj LIKE ? OR p.revenda_nome LIKE ?)");
            const like = `%${search}%`;
            params.push(like, like, like, like);
        }
        if (statusFilter && ['PENDENTE', 'VALIDADO', 'DIVERGENTE'].includes(statusFilter)) {
            where.push("p.status = ?");
            params.push(statusFilter);
        }
        if (revendaFilter) {
            where.push("p.revenda_nome LIKE ?");
            params.push(`%${revendaFilter}%`);
        }
        if (from) {
            where.push("p.criado_em >= datetime(? || ' 00:00:00')");
            params.push(from);
        }
        if (to) {
            where.push("p.criado_em <= datetime(? || ' 23:59:59')");
            params.push(to);
        }

        const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const pedidos = await dbAll(
            `SELECT p.pedido_id, p.cliente, p.cnpj, p.revenda_nome, p.status, p.criado_em FROM pedidos p ${whereSql} ORDER BY p.criado_em DESC`,
            params
        );

        // CSV header
        const header = 'Pedido ID;Cliente;CNPJ;Revenda;Status;Data Criação';
        const rows = pedidos.map(p => {
            const dt = p.criado_em ? new Date(p.criado_em).toLocaleString('pt-BR') : '';
            return [p.pedido_id, p.cliente, p.cnpj, p.revenda_nome, p.status, dt]
                .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
                .join(';');
        });

        const csv = '\uFEFF' + header + '\n' + rows.join('\n');
        await auditLog(req, 'EXPORTAR_PEDIDOS', 'pedido', '', { filtros: { search, statusFilter, revendaFilter, from, to }, total: pedidos.length });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="pedidos_${new Date().toISOString().slice(0,10)}.csv"`);
        res.send(csv);
    } catch (err) {
        console.error('Erro ao exportar pedidos:', err);
        res.status(500).json({ error: 'Erro ao exportar' });
    }
});

/**
 * GET /api/audit-log
 * Lista histórico de alterações (audit log)
 * Query: page, pageSize, acao, entidade
 */
app.get('/api/audit-log', requireAdminOrSuper, async (req, res) => {
    try {
        const acao = (req.query.acao || '').trim();
        const entidade = (req.query.entidade || '').trim();
        const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '25', 10) || 25));
        const offset = (page - 1) * pageSize;

        const where = [];
        const params = [];
        if (acao) { where.push('acao = ?'); params.push(acao); }
        if (entidade) { where.push('entidade = ?'); params.push(entidade); }

        const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const totalRow = await dbGet(`SELECT COUNT(*) as total FROM audit_log ${whereSql}`, params);
        const logs = await dbAll(
            `SELECT * FROM audit_log ${whereSql} ORDER BY criado_em DESC LIMIT ? OFFSET ?`,
            [...params, pageSize, offset]
        );

        res.json({
            page, pageSize,
            total: totalRow?.total || 0,
            totalPages: Math.max(1, Math.ceil((totalRow?.total || 0) / pageSize)),
            logs
        });
    } catch (err) {
        console.error('Erro ao listar audit log:', err);
        res.status(500).json({ error: 'Erro ao listar histórico' });
    }
});

/**
 * GET /api/admin/dashboard
 * Métricas aprimoradas para o dashboard
 */
app.get('/api/admin/dashboard', requireAdminOrSuper, async (req, res) => {
    try {
        const pedidosNoMesRow = await dbGet(
            `SELECT COUNT(*) as total FROM pedidos
             WHERE criado_em >= datetime('now', 'start of month')
               AND criado_em < datetime('now', 'start of month', '+1 month')`
        );
        const clientesRow = await dbGet(`SELECT COUNT(DISTINCT cnpj) as total FROM pedidos`);
        const usuariosNoPrazo7DiasRow = await dbGet(
            `SELECT COUNT(*) as total FROM pedidos WHERE status = 'PENDENTE' AND criado_em >= datetime('now', '-7 days')`
        );
        const usuariosEmRiscoRow = await dbGet(
            `SELECT COUNT(*) as total FROM pedidos WHERE status = 'PENDENTE' AND criado_em < datetime('now', '-7 days')`
        );

        // Dados para gráfico mensal agrupado por revenda/categoria
        const chartData = await dbAll(`
            SELECT 
                CAST(strftime('%m', p.criado_em) AS INTEGER) as mes,
                COALESCE(r.categoria, p.revenda, 'outros') as categoria,
                COUNT(*) as total
            FROM pedidos p
            LEFT JOIN pedido_revendas pr ON pr.pedido_id = p.pedido_id
            LEFT JOIN revendas r ON r.id = pr.revenda_id
            WHERE p.criado_em >= datetime('now', 'start of year')
            GROUP BY mes, categoria
            ORDER BY mes
        `);

        // Top revendas
        const topRevendas = await dbAll(`
            SELECT r.nome, r.categoria, COUNT(pr.pedido_id) as total
            FROM revendas r
            JOIN pedido_revendas pr ON pr.revenda_id = r.id
            GROUP BY r.id
            ORDER BY total DESC
            LIMIT 5
        `);

        // Pedidos por status
        const porStatus = await dbAll(`SELECT status, COUNT(*) as total FROM pedidos GROUP BY status`);

        res.json({
            pedidosNoMes: pedidosNoMesRow?.total || 0,
            clientes: clientesRow?.total || 0,
            usuariosEmRisco: usuariosEmRiscoRow?.total || 0,
            usuariosNoPrazo7Dias: usuariosNoPrazo7DiasRow?.total || 0,
            chartData,
            topRevendas,
            porStatus,
        });
    } catch (err) {
        console.error('Erro ao gerar dashboard admin:', err);
        res.status(500).json({ error: 'Erro ao gerar dashboard admin' });
    }
});

/**
 * GET /api/cnpj/:cnpj
 * Consulta dados de CNPJ via OpenCNPJ API e retorna dados normalizados
 */
app.get('/api/cnpj/:cnpj', requireAdminOrSuper, async (req, res) => {
    try {
        const raw = String(req.params.cnpj || '');
        const cnpj = raw.replace(/[.\-\/]/g, '').replace(/\D/g, '');

        if (!/^\d{14}$/.test(cnpj)) {
            return res.status(400).json({ error: 'CNPJ inválido' });
        }

        const url = `https://api.opencnpj.org/${cnpj}`;

        const apiRes = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'BluePartner-Validacao/1.0'
            }
        });

        if (apiRes.status === 404) {
            return res.status(404).json({ error: 'CNPJ não encontrado' });
        }

        if (!apiRes.ok) {
            const text = await apiRes.text().catch(() => '');
            return res.status(502).json({
                error: 'Falha ao consultar CNPJ',
                status: apiRes.status,
                details: text?.slice?.(0, 500) || ''
            });
        }

        const data = await apiRes.json();

        const resp = {
            nome: data.razao_social || null,
            situacao: data.situacao_cadastral || null,
            cidade: `${data.municipio || ''}, ${data.uf || ''}`.replace(/^, |, $/g, '') || null
        };

        res.json(resp);
    } catch (err) {
        console.error('Erro ao consultar CNPJ:', err);
        res.status(500).json({ error: 'Erro interno ao consultar CNPJ' });
    }
});

// ===== ROTAS REVENDAS =====

/**
 * GET /api/revendas
 * Lista todas as revendas cadastradas
 */
app.get('/api/revendas', requireAdminOrSuper, async (req, res) => {
    try {
        const revendas = await dbAll('SELECT * FROM revendas ORDER BY nome ASC');
        // Conta pedidos por revenda via junction table
        const counts = await dbAll(
            `SELECT revenda_id, COUNT(*) as total FROM pedido_revendas GROUP BY revenda_id`
        );
        const countMap = {};
        counts.forEach(c => { countMap[c.revenda_id] = c.total; });

        const result = revendas.map(r => ({
            ...r,
            pedidos_count: countMap[r.id] || 0
        }));

        res.json({ total: result.length, revendas: result });
    } catch (err) {
        console.error('Erro ao listar revendas:', err);
        res.status(500).json({ error: 'Erro ao listar revendas' });
    }
});

/**
 * GET /api/revendas/ativas
 * Lista apenas revendas ativas (para uso no dropdown do admin)
 */
app.get('/api/revendas/ativas', requireAdminOrSuper, async (req, res) => {
    try {
        const revendas = await dbAll('SELECT id, nome, partner_id, link_base, categoria FROM revendas WHERE ativo = 1 ORDER BY nome ASC');
        res.json({ revendas });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao listar revendas ativas' });
    }
});

/**
 * POST /api/revendas
 * Cria uma nova revenda
 */
app.post('/api/revendas', requireSuperAdmin, async (req, res) => {
    try {
        const { nome, contato, email, partner_id, link_base, categoria } = req.body;
        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'Nome da revenda é obrigatório' });
        }

        // Verifica duplicata
        const existing = await dbGet('SELECT id FROM revendas WHERE LOWER(nome) = LOWER(?)', [nome.trim()]);
        if (existing) {
            return res.status(409).json({ error: 'Revenda com este nome já existe' });
        }

        const validCat = ['ingram', 'tds'].includes((categoria || '').toLowerCase()) ? categoria.toLowerCase() : '';

        const result = await dbRun(
            'INSERT INTO revendas (nome, contato, email, partner_id, link_base, categoria) VALUES (?, ?, ?, ?, ?, ?)',
            [nome.trim(), (contato || '').trim(), (email || '').trim(), (partner_id || '').trim(), (link_base || '').trim(), validCat]
        );

        console.log(`🏪 Nova revenda criada: ${nome.trim()}`);
        res.json({ success: true, id: result.lastID, nome: nome.trim() });
    } catch (err) {
        console.error('Erro ao criar revenda:', err);
        res.status(500).json({ error: 'Erro ao criar revenda' });
    }
});

/**
 * PUT /api/revendas/:id
 * Edita uma revenda
 */
app.put('/api/revendas/:id', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, contato, email, partner_id, link_base, ativo, categoria } = req.body;

        const revenda = await dbGet('SELECT * FROM revendas WHERE id = ?', [id]);
        if (!revenda) return res.status(404).json({ error: 'Revenda não encontrada' });

        const newNome = (nome || revenda.nome).trim();
        const newContato = contato !== undefined ? (contato || '').trim() : revenda.contato;
        const newEmail = email !== undefined ? (email || '').trim() : revenda.email;
        const newPartnerId = partner_id !== undefined ? (partner_id || '').trim() : (revenda.partner_id || '');
        const newLinkBase = link_base !== undefined ? (link_base || '').trim() : (revenda.link_base || '');
        const newAtivo = ativo !== undefined ? (ativo ? 1 : 0) : revenda.ativo;
        const newCategoria = categoria !== undefined
            ? (['ingram', 'tds'].includes((categoria || '').toLowerCase()) ? categoria.toLowerCase() : '')
            : (revenda.categoria || '');

        // Se mudou o nome, atualiza revenda_nome nos pedidos (backward compat)
        if (newNome !== revenda.nome) {
            await dbRun(
                'UPDATE pedidos SET revenda_nome = REPLACE(revenda_nome, ?, ?) WHERE revenda_nome LIKE ?',
                [revenda.nome, newNome, `%${revenda.nome}%`]
            );
        }

        await dbRun(
            'UPDATE revendas SET nome = ?, contato = ?, email = ?, partner_id = ?, link_base = ?, ativo = ?, categoria = ? WHERE id = ?',
            [newNome, newContato, newEmail, newPartnerId, newLinkBase, newAtivo, newCategoria, id]
        );

        console.log(`✏️ Revenda editada: ${newNome}`);
        res.json({ success: true, id: parseInt(id), nome: newNome });
    } catch (err) {
        console.error('Erro ao editar revenda:', err);
        res.status(500).json({ error: 'Erro ao editar revenda' });
    }
});

/**
 * DELETE /api/revendas/:id
 * Remove uma revenda
 */
app.delete('/api/revendas/:id', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const revenda = await dbGet('SELECT * FROM revendas WHERE id = ?', [id]);
        if (!revenda) return res.status(404).json({ error: 'Revenda não encontrada' });

        // Verifica se tem pedidos associados via junction table
        const pedidosCount = await dbGet(
            'SELECT COUNT(*) as total FROM pedido_revendas WHERE revenda_id = ?',
            [id]
        );
        if (pedidosCount && pedidosCount.total > 0) {
            return res.status(400).json({ 
                error: `Revenda tem ${pedidosCount.total} pedido(s) associado(s). Desative-a em vez de excluir.` 
            });
        }

        await dbRun('DELETE FROM revendas WHERE id = ?', [id]);
        console.log(`🗑️ Revenda removida: ${revenda.nome}`);
        res.json({ success: true, message: `Revenda ${revenda.nome} removida` });
    } catch (err) {
        console.error('Erro ao remover revenda:', err);
        res.status(500).json({ error: 'Erro ao remover revenda' });
    }
});

/**
 * POST /api/revendas/importar
 * Importa múltiplas revendas de uma vez
 */
app.post('/api/revendas/importar', requireSuperAdmin, async (req, res) => {
    try {
        const { nomes } = req.body;
        if (!nomes || !Array.isArray(nomes) || !nomes.length) {
            return res.status(400).json({ error: 'Informe um array de nomes' });
        }

        let added = 0;
        let skipped = 0;
        for (const nome of nomes) {
            const trimmed = (nome || '').trim();
            if (!trimmed) continue;
            const existing = await dbGet('SELECT id FROM revendas WHERE LOWER(nome) = LOWER(?)', [trimmed]);
            if (existing) { skipped++; continue; }
            await dbRun('INSERT INTO revendas (nome) VALUES (?)', [trimmed]);
            added++;
        }

        console.log(`🏪 Importação de revendas: ${added} adicionada(s), ${skipped} ignorada(s)`);
        res.json({ success: true, added, skipped, message: `${added} revenda(s) adicionada(s), ${skipped} ignorada(s)` });
    } catch (err) {
        console.error('Erro ao importar revendas:', err);
        res.status(500).json({ error: 'Erro ao importar revendas' });
    }
});

/**
 * GET /api/revendas/dashboard
 * Dashboard de revendas com contagem de pedidos (superadmin)
 */
app.get('/api/revendas/dashboard', requireSuperAdmin, async (req, res) => {
    try {
        const stats = await dbAll(`
            SELECT 
                r.id, r.nome, r.contato, r.email, r.partner_id, r.link_base, r.categoria, r.ativo,
                COUNT(pr.pedido_id) as total_pedidos,
                SUM(CASE WHEN p.status = 'VALIDADO' THEN 1 ELSE 0 END) as validados,
                SUM(CASE WHEN p.status = 'PENDENTE' THEN 1 ELSE 0 END) as pendentes
            FROM revendas r
            LEFT JOIN pedido_revendas pr ON pr.revenda_id = r.id
            LEFT JOIN pedidos p ON p.pedido_id = pr.pedido_id
            GROUP BY r.id
            ORDER BY total_pedidos DESC, r.nome ASC
        `);

        const totalRevendas = stats.length;
        const ativas = stats.filter(r => r.ativo).length;
        const totalPedidos = stats.reduce((s, r) => s + r.total_pedidos, 0);

        res.json({ totalRevendas, ativas, totalPedidos, revendas: stats });
    } catch (err) {
        console.error('Erro no dashboard de revendas:', err);
        res.status(500).json({ error: 'Erro ao gerar dashboard' });
    }
});

// ===== ROTAS GDAP =====

/**
 * GET /api/gdap/status
 * Verifica se o GDAP está configurado e mostra contagem do pool
 */
app.get('/api/gdap/status', async (req, res) => {
    let poolCount = 0;
    try {
        const row = await dbGet("SELECT COUNT(*) as total FROM gdap_pool WHERE status = 'disponivel'");
        poolCount = row ? row.total : 0;
    } catch {}
    res.json({
        configured: isGdapConfigured(),
        partnerName: process.env.GDAP_PARTNER_NAME || 'Blue Partner',
        poolDisponivel: poolCount,
    });
});

// ===== POOL DE LINKS GDAP =====

/**
 * GET /api/gdap/pool
 * Lista todos os links GDAP do pool
 */
app.get('/api/gdap/pool', requireAdminOrSuper, async (req, res) => {
    try {
        const links = await dbAll('SELECT * FROM gdap_pool ORDER BY criado_em DESC');
        const disponiveis = links.filter(l => l.status === 'disponivel').length;
        const usados = links.filter(l => l.status === 'usado').length;
        res.json({ total: links.length, disponiveis, usados, links });
    } catch (err) {
        console.error('Erro ao listar pool GDAP:', err);
        res.status(500).json({ error: 'Erro ao listar pool' });
    }
});

/**
 * POST /api/gdap/pool
 * Adiciona um ou mais links GDAP ao pool
 * Body: { links: ["url1", "url2", ...] } ou { link: "url", label: "descrição" }
 */
app.post('/api/gdap/pool', requireSuperAdmin, async (req, res) => {
    try {
        const { link, links, label } = req.body;
        const toAdd = links || (link ? [link] : []);

        if (!toAdd.length) {
            return res.status(400).json({ error: 'Informe ao menos um link GDAP' });
        }

        let added = 0;
        for (const url of toAdd) {
            const trimmed = url.trim();
            if (!trimmed) continue;

            // Verifica se já existe no pool
            const existing = await dbGet('SELECT id FROM gdap_pool WHERE link = ?', [trimmed]);
            if (existing) continue;

            await dbRun(
                'INSERT INTO gdap_pool (link, label, status) VALUES (?, ?, ?)',
                [trimmed, label || '', 'disponivel']
            );
            added++;
        }

        console.log(`[GDAP Pool] ✅ ${added} link(s) adicionado(s) ao pool`);
        res.json({ success: true, added, message: `${added} link(s) adicionado(s) ao pool` });
    } catch (err) {
        console.error('Erro ao adicionar ao pool:', err);
        res.status(500).json({ error: 'Erro ao adicionar links ao pool' });
    }
});

/**
 * DELETE /api/gdap/pool/clear-used
 * Remove all used links from the pool
 */
app.delete('/api/gdap/pool/clear-used', requireSuperAdmin, async (req, res) => {
    try {
        const result = await dbRun("DELETE FROM gdap_pool WHERE status = 'usado'");
        const removed = result.changes || 0;
        console.log(`[GDAP Pool] 🗑️ ${removed} link(s) usado(s) removido(s)`);
        res.json({ success: true, removed, message: `${removed} link(s) usado(s) removido(s)` });
    } catch (err) {
        console.error('Erro ao limpar pool:', err);
        res.status(500).json({ error: 'Erro ao limpar links usados' });
    }
});

/**
 * DELETE /api/gdap/pool/:id
 * Remove um link do pool
 */
app.delete('/api/gdap/pool/:id', requireSuperAdmin, async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM gdap_pool WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Link não encontrado' });
        res.json({ success: true, message: 'Link removido do pool' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao remover link' });
    }
});

/**
 * POST /api/gdap/criar-convite
 * Cria relação GDAP e retorna link de convite
 * Body (opcional): { displayName, duration }
 */
app.post('/api/gdap/criar-convite', requireAdminOrSuper, async (req, res) => {
    try {
        if (!isGdapConfigured()) {
            return res.status(503).json({
                error: 'GDAP não configurado',
                message: 'Defina GDAP_TENANT_ID, GDAP_CLIENT_ID e GDAP_CLIENT_SECRET no .env',
            });
        }

        const { displayName, duration } = req.body || {};

        const result = await criarConviteGDAP({ displayName, duration });

        res.json({
            success: true,
            ...result,
        });
    } catch (err) {
        console.error('❌ Erro GDAP:', err.message);
        res.status(500).json({
            error: 'Erro ao criar convite GDAP',
            message: err.message
        });
    }
});

/**
 * POST /api/gdap/gerar-link/:pedidoId
 * Gera (ou regenera) um link GDAP exclusivo para um pedido específico.
 * Cada cliente recebe seu próprio link — resolve o problema de link único.
 */
app.post('/api/gdap/gerar-link/:pedidoId', requireAdminOrSuper, async (req, res) => {
    try {
        if (!isGdapConfigured()) {
            return res.status(503).json({
                error: 'GDAP não configurado',
                message: 'Defina GDAP_TENANT_ID, GDAP_CLIENT_ID e GDAP_CLIENT_SECRET no .env',
            });
        }

        const { pedidoId } = req.params;
        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });

        console.log(`[GDAP] Gerando novo link para pedido ${pedidoId}...`);

        const result = await criarConviteGDAP({
            displayName: `Licenças - ${pedido.cliente} (${pedidoId})`
        });

        await dbRun(
            'UPDATE pedidos SET gdap_link = ?, gdap_relationship_id = ?, atualizado_em = CURRENT_TIMESTAMP WHERE pedido_id = ?',
            [result.inviteLink, result.relationshipId, pedidoId]
        );

        console.log(`[GDAP] ✅ Novo link gerado para ${pedidoId}: ${result.inviteLink}`);

        res.json({
            success: true,
            pedidoId,
            gdapLink: result.inviteLink,
            relationshipId: result.relationshipId,
            message: 'Novo link GDAP gerado com sucesso'
        });
    } catch (err) {
        console.error('❌ Erro ao gerar link GDAP:', err.message);
        res.status(500).json({
            error: 'Erro ao gerar link GDAP',
            message: err.message
        });
    }
});

// ===== ROTAS LICENÇAS (via GDAP) =====

/**
 * GET /api/gdap/relacoes-ativas
 * Lista todas as relações GDAP ativas (status = active) com dados do cliente
 */
app.get('/api/gdap/relacoes-ativas', requireAdminOrSuper, async (req, res) => {
    try {
        if (!isGdapConfigured()) {
            return res.status(503).json({ error: 'GDAP não configurado' });
        }
        const relacoes = await listarRelacoesAtivas();
        res.json({ total: relacoes.length, relacoes });
    } catch (err) {
        console.error('❌ Erro ao listar relações GDAP:', err.message);
        res.status(500).json({ error: 'Erro ao listar relações ativas', message: err.message });
    }
});

/**
 * GET /api/gdap/status/:relationshipId
 * Consulta status de uma relação GDAP específica
 */
app.get('/api/gdap/status/:relationshipId', requireAdminOrSuper, async (req, res) => {
    try {
        if (!isGdapConfigured()) {
            return res.status(503).json({ error: 'GDAP não configurado' });
        }
        const relacao = await consultarRelacao(req.params.relationshipId);
        res.json(relacao);
    } catch (err) {
        console.error('❌ Erro ao consultar relação GDAP:', err.message);
        const status = err.response?.status === 404 ? 404 : 500;
        res.status(status).json({
            error: 'Erro ao consultar relação GDAP',
            message: err.response?.data?.error?.message || err.message
        });
    }
});

/**
 * GET /api/gdap/licencas/:customerTenantId
 * Lê as licenças (subscribedSkus) do tenant do cliente via GDAP
 */
app.get('/api/gdap/licencas/:customerTenantId', requireAdminOrSuper, async (req, res) => {
    try {
        if (!isGdapConfigured()) {
            return res.status(503).json({ error: 'GDAP não configurado' });
        }
        const licencas = await lerLicencasCliente(req.params.customerTenantId);
        res.json({ customerTenantId: req.params.customerTenantId, total: licencas.length, licencas });
    } catch (err) {
        console.error('❌ Erro ao ler licenças:', err.message);
        res.status(500).json({ error: 'Erro ao ler licenças do cliente', message: err.message });
    }
});

/**
 * GET /api/gdap/comparar/:pedidoId
 * Compara licenças do pedido (Ingram/TDS) com o portal do cliente (via GDAP)
 * 1. Busca licenças locais do pedido
 * 2. Busca relationship GDAP do pedido → tenant do cliente
 * 3. Lê subscribedSkus do portal
 * 4. Faz match fuzzy entre produto do pedido e SKU do portal
 */
app.get('/api/gdap/comparar/:pedidoId', requireAdminOrSuper, async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });

        // 1. Licenças locais (o que foi pedido na Ingram/TDS)
        const licencasLocal = await dbAll(
            'SELECT id, produto, qtd, duracao, preco FROM licencas WHERE pedido_id = ? ORDER BY id ASC',
            [pedidoId]
        );

        if (!licencasLocal.length) {
            return res.json({
                pedidoId,
                cliente: pedido.cliente,
                cnpj: pedido.cnpj,
                gdapStatus: 'sem_licencas',
                message: 'Nenhuma licença cadastrada neste pedido. Adicione licenças ou importe uma proposta.',
                pedido: licencasLocal,
                portal: [],
                comparacao: []
            });
        }

        // 2. Verificar se tem GDAP relationship
        if (!isGdapConfigured()) {
            return res.json({
                pedidoId,
                cliente: pedido.cliente,
                cnpj: pedido.cnpj,
                gdapStatus: 'nao_configurado',
                message: 'GDAP não configurado. Configure GDAP_TENANT_ID, GDAP_CLIENT_ID e GDAP_CLIENT_SECRET no .env',
                pedido: licencasLocal,
                portal: [],
                comparacao: licencasLocal.map(l => ({ ...l, portalMatch: null, resultado: 'gdap_nao_configurado' }))
            });
        }

        let portalLicencas = [];
        let gdapStatus = 'sem_relacao';
        let gdapMessage = '';
        let customerTenantId = null;

        if (pedido.gdap_relationship_id) {
            try {
                // Consultar relação para pegar o tenant do cliente
                const relacao = await consultarRelacao(pedido.gdap_relationship_id);
                if (relacao.status === 'active' && relacao.customer?.tenantId) {
                    customerTenantId = relacao.customer.tenantId;
                    gdapStatus = 'ativo';
                    portalLicencas = await lerLicencasCliente(customerTenantId);
                } else if (relacao.status === 'approvalPending') {
                    gdapStatus = 'pendente';
                    gdapMessage = 'O cliente ainda não aceitou o convite GDAP. Aguardando aprovação.';
                } else {
                    gdapStatus = relacao.status || 'inativo';
                    gdapMessage = `Relação GDAP com status "${relacao.status}". O cliente precisa aceitar o convite.`;
                }
            } catch (err) {
                gdapStatus = 'erro';
                gdapMessage = 'Erro ao consultar relação GDAP: ' + err.message;
            }
        } else {
            gdapMessage = 'Este pedido não tem um link GDAP gerado. Gere um link GDAP na página de pedidos para poder comparar.';
        }

        // 3. Fazer matching fuzzy entre produto local e SKU do portal
        const skuNameMap = {
            'microsoft 365 business basic': ['O365_BUSINESS_ESSENTIALS', 'SMB_BUSINESS_ESSENTIALS'],
            'microsoft 365 business standard': ['O365_BUSINESS_PREMIUM', 'SMB_BUSINESS_PREMIUM'],
            'microsoft 365 business premium': ['SPB'],
            'microsoft 365 apps for business': ['SMB_BUSINESS'],
            'microsoft 365 apps for enterprise': ['OFFICESUBSCRIPTION'],
            'office 365 e1': ['STANDARDPACK'],
            'office 365 e3': ['ENTERPRISEPACK'],
            'office 365 e5': ['ENTERPRISEPREMIUM', 'ENTERPRISEPREMIUM_NOPSTNCONF'],
            'microsoft 365 e3': ['SPE_E3'],
            'microsoft 365 e5': ['SPE_E5'],
            'microsoft 365 f1': ['SPE_F1', 'M365_F1'],
            'microsoft 365 f3': ['SPE_F1', 'M365_F1'],
            'office 365 f1': ['DESKLESSPACK'],
            'office 365 f3': ['DESKLESSPACK'],
            'power bi pro': ['POWER_BI_PRO'],
            'power bi premium': ['POWER_BI_PREMIUM_PER_USER'],
            'project plan 3': ['PROJECTPROFESSIONAL'],
            'project plan 5': ['PROJECTPREMIUM'],
            'visio plan 2': ['VISIOCLIENT'],
            'exchange online plan 1': ['EXCHANGESTANDARD'],
            'exchange online plan 2': ['EXCHANGEENTERPRISE'],
            'defender for office 365': ['ATP_ENTERPRISE', 'THREAT_INTELLIGENCE'],
            'defender for endpoint': ['WIN_DEF_ATP'],
            'enterprise mobility': ['EMS', 'EMSPREMIUM'],
            'azure ad premium p1': ['AAD_PREMIUM'],
            'azure ad premium p2': ['AAD_PREMIUM_P2'],
            'entra id p1': ['AAD_PREMIUM'],
            'entra id p2': ['AAD_PREMIUM_P2'],
            'intune': ['INTUNE_A'],
            'teams exploratory': ['TEAMS_EXPLORATORY'],
            'sharepoint online plan 1': ['SHAREPOINTSTANDARD'],
            'sharepoint online plan 2': ['SHAREPOINTENTERPRISE'],
            'power automate': ['FLOW_FREE'],
            'azure information protection': ['RIGHTSMANAGEMENT'],
            'copilot': ['Microsoft_365_Copilot'],
        };

        const comparacao = licencasLocal.map(licLocal => {
            const produtoLower = (licLocal.produto || '').toLowerCase().trim();
            let portalMatch = null;
            let resultado = 'nao_encontrada';

            // 1. Tentar match direto pelo SKU
            portalMatch = portalLicencas.find(p =>
                p.skuPartNumber.toLowerCase() === produtoLower
            );

            // 2. Tentar match pelo mapa de nomes
            if (!portalMatch) {
                for (const [nome, skus] of Object.entries(skuNameMap)) {
                    if (produtoLower.includes(nome) || nome.includes(produtoLower)) {
                        portalMatch = portalLicencas.find(p =>
                            skus.includes(p.skuPartNumber)
                        );
                        if (portalMatch) break;
                    }
                }
            }

            // 3. Tentar match parcial (palavras-chave)
            if (!portalMatch) {
                const palavras = produtoLower.split(/[\s\-\_\(\)]+/).filter(w => w.length > 2);
                portalMatch = portalLicencas.find(p => {
                    const skuLow = p.skuPartNumber.toLowerCase();
                    return palavras.filter(w => skuLow.includes(w)).length >= 2;
                });
            }

            if (portalMatch) {
                if (portalMatch.capabilityStatus === 'Enabled') {
                    resultado = portalMatch.total >= (licLocal.qtd || 1) ? 'ok' : 'qtd_divergente';
                } else {
                    resultado = 'suspensa';
                }
            } else if (gdapStatus !== 'ativo') {
                resultado = 'gdap_indisponivel';
            }

            return {
                ...licLocal,
                portalMatch: portalMatch ? {
                    skuPartNumber: portalMatch.skuPartNumber,
                    capabilityStatus: portalMatch.capabilityStatus,
                    total: portalMatch.total,
                    consumed: portalMatch.consumed,
                    available: portalMatch.available
                } : null,
                resultado
            };
        });

        res.json({
            pedidoId,
            cliente: pedido.cliente,
            cnpj: pedido.cnpj,
            customerTenantId,
            gdapStatus,
            gdapMessage,
            pedido: licencasLocal,
            portal: portalLicencas,
            comparacao
        });

    } catch (err) {
        console.error('❌ Erro ao comparar licenças:', err);
        res.status(500).json({ error: 'Erro ao comparar licenças', message: err.message });
    }
});

/**
 * GET /api/gdap/comparar-completo/:pedidoId
 * Comparação 3 vias: Proposta (licenças locais) vs Portal (GDAP) vs Distribuidor (Ingram/TDS)
 * 
 * Fluxo:
 * 1. Busca licenças do pedido (proposta local)
 * 2. Busca licenças do portal do cliente via GDAP (se configurado)
 * 3. Identifica o distribuidor pela categoria da revenda do pedido
 * 4. Busca licenças no distribuidor (Ingram ou TDS, se configurado)
 * 5. Faz matching fuzzy entre as 3 fontes
 */
app.get('/api/gdap/comparar-completo/:pedidoId', requireAdminOrSuper, async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });

        // 1. Licenças locais (proposta)
        const licencasLocal = await dbAll(
            'SELECT id, produto, qtd, duracao, preco FROM licencas WHERE pedido_id = ? ORDER BY id ASC',
            [pedidoId]
        );

        if (!licencasLocal.length) {
            return res.json({
                pedidoId,
                cliente: pedido.cliente,
                cnpj: pedido.cnpj,
                gdapStatus: 'sem_licencas',
                distribuidorStatus: 'sem_licencas',
                message: 'Nenhuma licença cadastrada neste pedido.',
                proposta: [],
                portal: [],
                distribuidor: [],
                comparacao: []
            });
        }

        // 2. Identificar distribuidor pela revenda do pedido
        const revendasPedido = await dbAll(
            `SELECT r.id, r.nome, r.categoria 
             FROM pedido_revendas pr 
             JOIN revendas r ON r.id = pr.revenda_id 
             WHERE pr.pedido_id = ?`,
            [pedidoId]
        );

        // Determinar a categoria do distribuidor
        let distribuidorCategoria = null;
        let distribuidorNome = null;
        for (const rv of revendasPedido) {
            const cat = (rv.categoria || '').toLowerCase().trim();
            if (cat === 'ingram' || cat === 'tds') {
                distribuidorCategoria = cat;
                distribuidorNome = rv.nome;
                break;
            }
        }

        // 3. Buscar licenças do portal (GDAP)
        let portalLicencas = [];
        let gdapStatus = 'sem_relacao';
        let gdapMessage = '';
        let customerTenantId = null;

        if (!isGdapConfigured()) {
            gdapStatus = 'nao_configurado';
            gdapMessage = 'GDAP não configurado no servidor.';
        } else if (pedido.gdap_relationship_id) {
            try {
                const relacao = await consultarRelacao(pedido.gdap_relationship_id);
                if (relacao.status === 'active' && relacao.customer?.tenantId) {
                    customerTenantId = relacao.customer.tenantId;
                    gdapStatus = 'ativo';
                    portalLicencas = await lerLicencasCliente(customerTenantId);
                } else if (relacao.status === 'approvalPending') {
                    gdapStatus = 'pendente';
                    gdapMessage = 'O cliente ainda não aceitou o convite GDAP.';
                } else {
                    gdapStatus = relacao.status || 'inativo';
                    gdapMessage = `Relação GDAP com status "${relacao.status}".`;
                }
            } catch (err) {
                gdapStatus = 'erro';
                gdapMessage = 'Erro ao consultar GDAP: ' + err.message;
            }
        } else {
            gdapMessage = 'Pedido sem link GDAP gerado.';
        }

        // 4. Buscar licenças do distribuidor
        let distribuidorLicencas = [];
        let distribuidorStatus = 'nao_configurado';
        let distribuidorMessage = '';

        if (!distribuidorCategoria) {
            distribuidorStatus = 'sem_revenda';
            distribuidorMessage = 'Nenhuma revenda com categoria Ingram ou TDS associada a este pedido.';
        } else if (distribuidorCategoria === 'ingram') {
            if (!isIngramConfigured()) {
                distribuidorStatus = 'nao_configurado';
                distribuidorMessage = 'API Ingram Micro não configurada. Defina INGRAM_CLIENT_ID e INGRAM_CLIENT_SECRET no .env';
            } else {
                try {
                    // Usar CNPJ ou tenant como identificador do cliente na Ingram
                    const ingramCustomerId = pedido.cnpj || pedido.cliente;
                    distribuidorLicencas = await getIngramLicencasNormalizadas(ingramCustomerId);
                    distribuidorStatus = 'ativo';
                } catch (err) {
                    distribuidorStatus = 'erro';
                    distribuidorMessage = 'Erro ao consultar Ingram: ' + err.message;
                }
            }
        } else if (distribuidorCategoria === 'tds') {
            if (!isTdsConfigured()) {
                distribuidorStatus = 'nao_configurado';
                distribuidorMessage = 'API TD SYNNEX não configurada. Defina TDS_CLIENT_ID e TDS_CLIENT_SECRET no .env';
            } else {
                try {
                    const tdsCustomerId = pedido.cnpj || pedido.cliente;
                    distribuidorLicencas = await getTdsLicencasNormalizadas(tdsCustomerId);
                    distribuidorStatus = 'ativo';
                } catch (err) {
                    distribuidorStatus = 'erro';
                    distribuidorMessage = 'Erro ao consultar TD SYNNEX: ' + err.message;
                }
            }
        }

        // 5. Matching fuzzy 3 vias
        const skuNameMap = {
            'microsoft 365 business basic': ['O365_BUSINESS_ESSENTIALS', 'SMB_BUSINESS_ESSENTIALS'],
            'microsoft 365 business standard': ['O365_BUSINESS_PREMIUM', 'SMB_BUSINESS_PREMIUM'],
            'microsoft 365 business premium': ['SPB'],
            'microsoft 365 apps for business': ['SMB_BUSINESS'],
            'microsoft 365 apps for enterprise': ['OFFICESUBSCRIPTION'],
            'office 365 e1': ['STANDARDPACK'],
            'office 365 e3': ['ENTERPRISEPACK'],
            'office 365 e5': ['ENTERPRISEPREMIUM', 'ENTERPRISEPREMIUM_NOPSTNCONF'],
            'microsoft 365 e3': ['SPE_E3'],
            'microsoft 365 e5': ['SPE_E5'],
            'microsoft 365 f1': ['SPE_F1', 'M365_F1'],
            'microsoft 365 f3': ['SPE_F1', 'M365_F1'],
            'office 365 f1': ['DESKLESSPACK'],
            'office 365 f3': ['DESKLESSPACK'],
            'power bi pro': ['POWER_BI_PRO'],
            'power bi premium': ['POWER_BI_PREMIUM_PER_USER'],
            'project plan 3': ['PROJECTPROFESSIONAL'],
            'project plan 5': ['PROJECTPREMIUM'],
            'visio plan 2': ['VISIOCLIENT'],
            'exchange online plan 1': ['EXCHANGESTANDARD'],
            'exchange online plan 2': ['EXCHANGEENTERPRISE'],
            'defender for office 365': ['ATP_ENTERPRISE', 'THREAT_INTELLIGENCE'],
            'defender for endpoint': ['WIN_DEF_ATP'],
            'enterprise mobility': ['EMS', 'EMSPREMIUM'],
            'azure ad premium p1': ['AAD_PREMIUM'],
            'azure ad premium p2': ['AAD_PREMIUM_P2'],
            'entra id p1': ['AAD_PREMIUM'],
            'entra id p2': ['AAD_PREMIUM_P2'],
            'intune': ['INTUNE_A'],
            'teams exploratory': ['TEAMS_EXPLORATORY'],
            'sharepoint online plan 1': ['SHAREPOINTSTANDARD'],
            'sharepoint online plan 2': ['SHAREPOINTENTERPRISE'],
            'power automate': ['FLOW_FREE'],
            'azure information protection': ['RIGHTSMANAGEMENT'],
            'copilot': ['Microsoft_365_Copilot'],
        };

        function fuzzyMatchPortal(produtoLower, portalList) {
            // 1. Match direto
            let match = portalList.find(p => p.skuPartNumber.toLowerCase() === produtoLower);
            // 2. Nome → SKU map
            if (!match) {
                for (const [nome, skus] of Object.entries(skuNameMap)) {
                    if (produtoLower.includes(nome) || nome.includes(produtoLower)) {
                        match = portalList.find(p => skus.includes(p.skuPartNumber));
                        if (match) break;
                    }
                }
            }
            // 3. Match parcial
            if (!match) {
                const palavras = produtoLower.split(/[\s\-\_\(\)]+/).filter(w => w.length > 2);
                match = portalList.find(p => {
                    const skuLow = p.skuPartNumber.toLowerCase();
                    return palavras.filter(w => skuLow.includes(w)).length >= 2;
                });
            }
            return match;
        }

        function fuzzyMatchDistribuidor(produtoLower, distList) {
            // Match pelo nome do produto ou SKU
            let match = distList.find(d =>
                d.skuPartNumber.toLowerCase() === produtoLower ||
                d.productName.toLowerCase() === produtoLower
            );
            // Match parcial pelo nome
            if (!match) {
                for (const [nome, skus] of Object.entries(skuNameMap)) {
                    if (produtoLower.includes(nome) || nome.includes(produtoLower)) {
                        match = distList.find(d =>
                            skus.includes(d.skuPartNumber) ||
                            d.productName.toLowerCase().includes(nome)
                        );
                        if (match) break;
                    }
                }
            }
            // Match por palavras-chave
            if (!match) {
                const palavras = produtoLower.split(/[\s\-\_\(\)]+/).filter(w => w.length > 2);
                match = distList.find(d => {
                    const dLow = (d.productName + ' ' + d.skuPartNumber).toLowerCase();
                    return palavras.filter(w => dLow.includes(w)).length >= 2;
                });
            }
            return match;
        }

        const comparacao = licencasLocal.map(licLocal => {
            const produtoLower = (licLocal.produto || '').toLowerCase().trim();

            // Match no portal
            const portalMatch = fuzzyMatchPortal(produtoLower, portalLicencas);

            // Match no distribuidor
            const distMatch = fuzzyMatchDistribuidor(produtoLower, distribuidorLicencas);

            // Resultado portal
            let resultadoPortal = 'indisponivel';
            if (portalMatch) {
                if (portalMatch.capabilityStatus === 'Enabled') {
                    resultadoPortal = portalMatch.total >= (licLocal.qtd || 1) ? 'ok' : 'qtd_divergente';
                } else {
                    resultadoPortal = 'suspensa';
                }
            } else if (gdapStatus === 'ativo') {
                resultadoPortal = 'nao_encontrada';
            }

            // Resultado distribuidor
            let resultadoDist = 'indisponivel';
            if (distMatch) {
                const distAtivo = (distMatch.status || '').toLowerCase();
                if (['active', 'ativo', 'enabled', 'provisioned'].includes(distAtivo)) {
                    resultadoDist = distMatch.quantity >= (licLocal.qtd || 1) ? 'ok' : 'qtd_divergente';
                } else {
                    resultadoDist = 'suspensa';
                }
            } else if (distribuidorStatus === 'ativo') {
                resultadoDist = 'nao_encontrada';
            }

            // Resultado geral (consolidado)
            let resultadoGeral = 'pendente';
            if (resultadoPortal === 'ok' && resultadoDist === 'ok') {
                resultadoGeral = 'ok';
            } else if (resultadoPortal === 'ok' && distribuidorStatus !== 'ativo') {
                resultadoGeral = 'parcial_portal';
            } else if (resultadoDist === 'ok' && gdapStatus !== 'ativo') {
                resultadoGeral = 'parcial_distribuidor';
            } else if (resultadoPortal === 'qtd_divergente' || resultadoDist === 'qtd_divergente') {
                resultadoGeral = 'qtd_divergente';
            } else if (resultadoPortal === 'suspensa' || resultadoDist === 'suspensa') {
                resultadoGeral = 'suspensa';
            } else if (resultadoPortal === 'nao_encontrada' || resultadoDist === 'nao_encontrada') {
                resultadoGeral = 'nao_encontrada';
            }

            return {
                ...licLocal,
                portalMatch: portalMatch ? {
                    skuPartNumber: portalMatch.skuPartNumber,
                    capabilityStatus: portalMatch.capabilityStatus,
                    total: portalMatch.total,
                    consumed: portalMatch.consumed,
                    available: portalMatch.available
                } : null,
                distribuidorMatch: distMatch ? {
                    skuPartNumber: distMatch.skuPartNumber,
                    productName: distMatch.productName,
                    quantity: distMatch.quantity,
                    status: distMatch.status
                } : null,
                resultadoPortal,
                resultadoDist,
                resultadoGeral
            };
        });

        res.json({
            pedidoId,
            cliente: pedido.cliente,
            cnpj: pedido.cnpj,
            customerTenantId,
            gdapStatus,
            gdapMessage,
            distribuidorCategoria: distribuidorCategoria || null,
            distribuidorNome: distribuidorNome || null,
            distribuidorStatus,
            distribuidorMessage,
            proposta: licencasLocal,
            portal: portalLicencas,
            distribuidor: distribuidorLicencas,
            comparacao
        });

    } catch (err) {
        console.error('❌ Erro na comparação completa:', err);
        res.status(500).json({ error: 'Erro na comparação completa', message: err.message });
    }
});

// ===== ROTAS GESTÃO DE USUÁRIOS (superadmin) =====

/**
 * GET /api/usuarios
 * Lista todos os usuários cadastrados
 */
app.get('/api/usuarios', requireSuperAdmin, async (req, res) => {
    try {
        const usuarios = await dbAll('SELECT id, email, nome, role, ativo, criado_em FROM usuarios ORDER BY criado_em DESC');
        res.json({ total: usuarios.length, usuarios });
    } catch (err) {
        console.error('Erro ao listar usuários:', err);
        res.status(500).json({ error: 'Erro ao listar usuários' });
    }
});

/**
 * POST /api/usuarios
 * Cria um novo usuário (apenas email + role, sem senha)
 */
app.post('/api/usuarios', requireSuperAdmin, async (req, res) => {
    try {
        const { email, role } = req.body;
        if (!email || !email.trim()) {
            return res.status(400).json({ error: 'E-mail é obrigatório' });
        }
        const trimmedEmail = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            return res.status(400).json({ error: 'E-mail inválido' });
        }
        const validRole = ['admin', 'superadmin'].includes(role) ? role : 'admin';

        const existing = await dbGet('SELECT id FROM usuarios WHERE LOWER(email) = ?', [trimmedEmail]);
        if (existing) {
            return res.status(409).json({ error: 'Usuário com este e-mail já existe' });
        }

        const result = await dbRun(
            'INSERT INTO usuarios (email, role) VALUES (?, ?)',
            [trimmedEmail, validRole]
        );

        console.log(`👤 Novo usuário criado: ${trimmedEmail} (${validRole})`);
        res.json({ success: true, id: result.lastID, email: trimmedEmail, role: validRole });
    } catch (err) {
        console.error('Erro ao criar usuário:', err);
        res.status(500).json({ error: 'Erro ao criar usuário' });
    }
});

/**
 * PUT /api/usuarios/:id
 * Atualiza role e/ou status de um usuário
 */
app.put('/api/usuarios/:id', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { role, ativo } = req.body;

        const user = await dbGet('SELECT * FROM usuarios WHERE id = ?', [id]);
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

        // Impede que o superadmin desative a si mesmo
        if (req.session.user.email.toLowerCase() === user.email.toLowerCase() && ativo === false) {
            return res.status(400).json({ error: 'Você não pode desativar sua própria conta' });
        }

        const newRole = role && ['admin', 'superadmin'].includes(role) ? role : user.role;
        const newAtivo = ativo !== undefined ? (ativo ? 1 : 0) : user.ativo;

        await dbRun(
            'UPDATE usuarios SET role = ?, ativo = ? WHERE id = ?',
            [newRole, newAtivo, id]
        );

        console.log(`✏️ Usuário atualizado: ${user.email} → role=${newRole}, ativo=${newAtivo}`);
        res.json({ success: true, id: parseInt(id), email: user.email, role: newRole, ativo: !!newAtivo });
    } catch (err) {
        console.error('Erro ao atualizar usuário:', err);
        res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }
});

/**
 * DELETE /api/usuarios/:id
 * Remove um usuário
 */
app.delete('/api/usuarios/:id', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const user = await dbGet('SELECT * FROM usuarios WHERE id = ?', [id]);
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

        // Impede que o superadmin delete a si mesmo
        if (req.session.user.email.toLowerCase() === user.email.toLowerCase()) {
            return res.status(400).json({ error: 'Você não pode remover sua própria conta' });
        }

        await dbRun('DELETE FROM usuarios WHERE id = ?', [id]);
        console.log(`🗑️ Usuário removido: ${user.email}`);
        res.json({ success: true, message: `Usuário ${user.email} removido` });
    } catch (err) {
        console.error('Erro ao remover usuário:', err);
        res.status(500).json({ error: 'Erro ao remover usuário' });
    }
});

// ===== ROTAS BI (PONTUAÇÃO / SUGESTÕES) =====

/**
 * GET /api/bi/status
 * Verifica se a integração BI está configurada
 */
app.get('/api/bi/status', requireAdminOrSuper, (req, res) => {
    res.json(isBiConfigured());
});

/**
 * GET /api/bi/pontuacao
 * Retorna pontuação de todas as revendas do BI
 */
app.get('/api/bi/pontuacao', requireAdminOrSuper, async (req, res) => {
    try {
        const bi = isBiConfigured();
        if (!bi.configured) {
            return res.json({ configured: false, dados: [], message: 'BI não configurado' });
        }
        const dados = await fetchPontuacaoBI();
        res.json({ configured: true, dados });
    } catch (err) {
        console.error('Erro ao buscar pontuação BI:', err.message);
        res.status(500).json({ error: 'Erro ao consultar BI: ' + err.message });
    }
});

/**
 * GET /api/bi/sugestoes
 * Retorna revendas que precisam de mais pedidos para bater meta (ordenadas por urgência)
 */
app.get('/api/bi/sugestoes', requireAdminOrSuper, async (req, res) => {
    try {
        const bi = isBiConfigured();
        if (!bi.configured) {
            return res.json({ configured: false, sugestoes: [], resumo: null, message: 'BI não configurado — configure BI_SCORING_DAX ou BI_SCORING_TABLE no .env' });
        }
        const result = await getSugestoes();
        res.json({ configured: true, ...result });
    } catch (err) {
        console.error('Erro ao buscar sugestões BI:', err.message);
        res.status(500).json({ error: 'Erro ao consultar sugestões: ' + err.message });
    }
});

// ===== ROTAS FABRIC / POWER BI =====

/**
 * GET /api/fabric/status
 * Verifica se Fabric está configurado e retorna status da conexão
 */
app.get('/api/fabric/status', requireSuperAdmin, async (req, res) => {
    try {
        const status = isFabricConfigured();
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fabric/datasets
 * Lista datasets disponíveis no workspace Power BI
 */
app.get('/api/fabric/datasets', requireSuperAdmin, async (req, res) => {
    try {
        const datasets = await listDatasets(req.query.workspaceId);
        res.json({ datasets });
    } catch (err) {
        console.error('Erro ao listar datasets:', err.message);
        res.status(500).json({ error: 'Erro ao listar datasets: ' + err.message });
    }
});

/**
 * GET /api/fabric/tables
 * Lista tabelas de um dataset
 */
app.get('/api/fabric/tables', requireSuperAdmin, async (req, res) => {
    try {
        const tables = await listDatasetTables(req.query.datasetId);
        res.json({ tables });
    } catch (err) {
        console.error('Erro ao listar tabelas:', err.message);
        res.status(500).json({ error: 'Erro ao listar tabelas: ' + err.message });
    }
});

/**
 * POST /api/fabric/query
 * Executa query DAX contra dataset Power BI
 */
app.post('/api/fabric/query', requireSuperAdmin, async (req, res) => {
    try {
        const { dax, datasetId } = req.body;
        if (!dax) return res.status(400).json({ error: 'Query DAX é obrigatória' });
        const rows = await executeDaxQuery(dax, datasetId);
        res.json({ rows, total: rows.length });
    } catch (err) {
        console.error('Erro ao executar DAX:', err.message);
        res.status(500).json({ error: 'Erro na query: ' + err.message });
    }
});

/**
 * POST /api/fabric/sql-query
 * Executa query SQL contra Fabric SQL endpoint
 */
app.post('/api/fabric/sql-query', requireSuperAdmin, async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Query SQL é obrigatória' });
        // Só permite SELECT (read-only)
        const normalized = query.trim().toUpperCase();
        if (!normalized.startsWith('SELECT')) {
            return res.status(400).json({ error: 'Apenas queries SELECT são permitidas' });
        }
        const result = await fabricSqlQuery(query);
        res.json({ rows: result.recordset, total: result.recordset.length });
    } catch (err) {
        console.error('Erro ao executar SQL Fabric:', err.message);
        res.status(500).json({ error: 'Erro na query SQL: ' + err.message });
    }
});

/**
 * POST /api/fabric/sync-revendas
 * Sincroniza revendas do Fabric para o banco local
 */
app.post('/api/fabric/sync-revendas', requireSuperAdmin, async (req, res) => {
    try {
        const { tableName, columnMap } = req.body;
        if (!tableName) return res.status(400).json({ error: 'Nome da tabela é obrigatório' });
        const result = await syncRevendasFromFabric(tableName, columnMap || {}, dbRun, dbGet);
        console.log(`🔄 Sync Fabric revendas: ${JSON.stringify(result)}`);
        res.json(result);
    } catch (err) {
        console.error('Erro ao sync revendas Fabric:', err.message);
        res.status(500).json({ error: 'Erro ao sincronizar: ' + err.message });
    }
});

/**
 * POST /api/fabric/test-connection
 * Testa a conexão com Fabric SQL ou Power BI
 */
app.post('/api/fabric/test-connection', requireSuperAdmin, async (req, res) => {
    const results = { sql: null, powerbi: null, onelake: null };
    const status = isFabricConfigured();
    const userToken = req.session.fabricToken || null;

    if (status.sql && status.credentials) {
        try {
            const r = await fabricSqlQuery('SELECT 1 AS ok');
            results.sql = { connected: true, message: 'Conectado ao Fabric SQL' };
        } catch (err) {
            results.sql = { connected: false, message: err.message };
        }
    }

    // Power BI: tenta delegado primeiro, depois client credentials
    if (status.credentials) {
        try {
            const datasets = await listDatasets(null, userToken);
            results.powerbi = { connected: true, message: `${datasets.length} dataset(s) encontrado(s)`, datasets: datasets.length };
        } catch (err) {
            results.powerbi = { connected: false, message: err.message };
        }
    }

    // OneLake: tenta delegado primeiro via token do usuário
    if (status.credentials) {
        try {
            const items = await listWorkspaceItems(null, null, userToken);
            results.onelake = { connected: true, message: `${items.length} item(ns) no workspace`, items: items.length };
        } catch (err) {
            // Se OBO falhou e não tem workspace configurado, tenta listar workspaces
            try {
                const workspaces = await listWorkspaces(userToken);
                results.onelake = { connected: true, message: `${workspaces.length} workspace(s) encontrado(s)`, workspaces: workspaces.map(w => ({ id: w.id, name: w.displayName })) };
            } catch (err2) {
                results.onelake = { connected: false, message: err2.message };
            }
        }
    }

    // Info sobre modo de autenticação
    results.authMode = userToken ? 'delegated (token do usuário)' : 'client_credentials (service principal)';

    res.json(results);
});

// ===== ROTAS ONELAKE CATALOG =====

/**
 * GET /api/onelake/workspaces
 * Lista workspaces acessíveis no Fabric (usa token delegado do usuário logado)
 */
app.get('/api/onelake/workspaces', requireSuperAdmin, async (req, res) => {
    try {
        const userToken = req.session.fabricToken || null;
        const workspaces = await listWorkspaces(userToken);
        res.json({ workspaces });
    } catch (err) {
        console.error('Erro ao listar workspaces:', err.message);
        res.status(500).json({ error: 'Erro ao listar workspaces: ' + err.message });
    }
});

/**
 * GET /api/onelake/items
 * Lista itens de um workspace (Lakehouse, Warehouse, SemanticModel, etc.)
 * Query params: workspaceId, type
 */
app.get('/api/onelake/items', requireSuperAdmin, async (req, res) => {
    try {
        const userToken = req.session.fabricToken || null;
        const items = await listWorkspaceItems(req.query.workspaceId, req.query.type, userToken);
        res.json({ items });
    } catch (err) {
        console.error('Erro ao listar itens:', err.message);
        res.status(500).json({ error: 'Erro ao listar itens: ' + err.message });
    }
});

/**
 * GET /api/onelake/lakehouses
 * Lista lakehouses de um workspace
 */
app.get('/api/onelake/lakehouses', requireSuperAdmin, async (req, res) => {
    try {
        const userToken = req.session.fabricToken || null;
        const lakehouses = await listLakehouses(req.query.workspaceId, userToken);
        res.json({ lakehouses });
    } catch (err) {
        console.error('Erro ao listar lakehouses:', err.message);
        res.status(500).json({ error: 'Erro ao listar lakehouses: ' + err.message });
    }
});

/**
 * GET /api/onelake/lakehouses/:lakehouseId/tables
 * Lista tabelas de um Lakehouse específico
 */
app.get('/api/onelake/lakehouses/:lakehouseId/tables', requireSuperAdmin, async (req, res) => {
    try {
        const userToken = req.session.fabricToken || null;
        const tables = await listLakehouseTables(req.params.lakehouseId, req.query.workspaceId, userToken);
        res.json({ tables });
    } catch (err) {
        console.error('Erro ao listar tabelas do lakehouse:', err.message);
        res.status(500).json({ error: 'Erro ao listar tabelas: ' + err.message });
    }
});

/**
 * GET /api/onelake/table/describe
 * Retorna colunas/tipos de uma tabela do OneLake (via SQL endpoint)
 * Query param: tableName
 */
app.get('/api/onelake/table/describe', requireSuperAdmin, async (req, res) => {
    try {
        const { tableName } = req.query;
        if (!tableName) return res.status(400).json({ error: 'tableName é obrigatório' });
        const columns = await describeTable(tableName);
        res.json({ tableName, columns });
    } catch (err) {
        console.error('Erro ao descrever tabela:', err.message);
        res.status(500).json({ error: 'Erro ao descrever tabela: ' + err.message });
    }
});

/**
 * GET /api/onelake/table/preview
 * Preview das primeiras linhas de uma tabela do OneLake
 * Query params: tableName, limit (default 50, max 1000)
 */
app.get('/api/onelake/table/preview', requireSuperAdmin, async (req, res) => {
    try {
        const { tableName, limit } = req.query;
        if (!tableName) return res.status(400).json({ error: 'tableName é obrigatório' });
        const data = await previewTable(tableName, limit);
        res.json(data);
    } catch (err) {
        console.error('Erro ao preview tabela:', err.message);
        res.status(500).json({ error: 'Erro ao ler tabela: ' + err.message });
    }
});

// ===== SPA FALLBACK =====
// Rota do cliente (aceite) — servida somente via link com parâmetros
app.get('/validar', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/validar/:pedidoId/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Página principal
app.get('/', (req, res) => {
    // Se tem parâmetros de pedido, serve a página do cliente
    if (req.query.pedidoId && req.query.token) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    // Senão, manda para login/admin conforme sessão
    if (!req.session?.user) return res.redirect('/login');
    if (req.session.user.role === 'superadmin') return res.redirect('/superadmin');
    return res.redirect('/admin');
});

// Qualquer outra rota não-API manda para /admin (que já valida sessão)
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        return res.redirect('/admin');
    }
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// ===== START =====
async function start() {
    try {
        await initDatabase();
        console.log('📦 Banco de dados inicializado');

        // Auto-seed: garante que superadmin existe no banco (importante para deploy no Azure)
        const superadminEmail = 'julia.silva@bluepartner.com.br';
        const existing = await dbGet('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?)', [superadminEmail]);
        if (!existing) {
            await dbRun(
                'INSERT INTO usuarios (email, nome, role, ativo) VALUES (?, ?, ?, ?)',
                [superadminEmail, 'Julia da Assunção Silva', 'superadmin', 1]
            );
            console.log(`👤 Superadmin criada automaticamente: ${superadminEmail}`);
        }

        app.listen(PORT, () => {
            console.log('');
            console.log('═══════════════════════════════════════════════════');
            console.log('  🚀 BluePartner Validação Server');
            console.log(`  🌐 http://localhost:${PORT}`);
            console.log('═══════════════════════════════════════════════════');
            console.log('');
            console.log('  Links de teste:');
            console.log(`  📋 Rode "npm run seed" para criar pedidos de teste`);
            console.log('');
            console.log('  API:');
            console.log(`  GET  /api/pedido/:id/:token`);
            console.log(`  POST /api/validar`);
            console.log(`  GET  /api/logs/:pedidoId`);
            console.log(`  GET  /api/pedidos`);
            console.log('');
            console.log('');
            console.log('  🔒 Auth/Sessão:');
            console.log(`  Entra redirect: ${ENTRA_REDIRECT_URI}`);
            console.log(`  Cookie secure: ${process.env.NODE_ENV === 'production'}`);
            console.log('');
            console.log('  GDAP:');
            console.log(`  GET  /api/gdap/status`);
            console.log(`  POST /api/gdap/criar-convite (auth)`);
            if (!isGdapConfigured()) {
                console.log('  ⚠️  GDAP não configurado — preencha GDAP_* no .env');
            } else {
                console.log('  ✅ GDAP configurado');
            }
            console.log('');
        });
    } catch (err) {
        console.error('❌ Falha ao iniciar servidor:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    start();
}

module.exports = { app, start };
