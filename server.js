require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initDatabase, dbGet, dbAll, dbRun } = require('./db');
const { criarConviteGDAP, isGdapConfigured } = require('./gdap');

// Multer config — upload to temp dir
const upload = multer({
    dest: path.join(__dirname, 'data', 'uploads'),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.csv', '.xlsx', '.xls', '.pdf'].includes(ext)) cb(null, true);
        else cb(new Error('Formato não suportado'), false);
    }
});

const app = express();
const PORT = process.env.PORT || 3000;

// ===== SECURITY CONFIG =====
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
// Default password: BluPartner@2026 (hashed with bcrypt)
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || bcrypt.hashSync('BluPartner@2026', 10);
const JWT_EXPIRES = '8h';

// Super Admin credentials (separate from regular admin)
const SUPER_ADMIN_USER = process.env.SUPER_ADMIN_USER || 'superadmin';
// Default password: BluPartner@Super2026
const SUPER_ADMIN_PASS_HASH = process.env.SUPER_ADMIN_PASS_HASH || bcrypt.hashSync('BluPartner@Super2026', 10);

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

// Request logging
app.use((req, res, next) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${req.method} ${req.url}`);
    next();
});

// ===== AUTH MIDDLEWARE =====
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autenticação necessário' });
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.adminUser = decoded.user;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
}

// Super Admin middleware — requires role: 'superadmin' in JWT
function requireSuperAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autenticação necessário' });
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'superadmin') {
            return res.status(403).json({ error: 'Acesso restrito ao super admin' });
        }
        req.adminUser = decoded.user;
        req.isSuperAdmin = true;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
}

// Auth middleware that allows both admin and superadmin
function requireAuthOrSuper(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autenticação necessário' });
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.adminUser = decoded.user;
        req.isSuperAdmin = decoded.role === 'superadmin';
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
}

// ===== AUTH ROUTES =====

/**
 * POST /api/auth/login
 * Admin login — returns JWT token
 */
app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { user, password } = req.body;
    if (!user || !password) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }
    if (user !== ADMIN_USER || !bcrypt.compareSync(password, ADMIN_PASS_HASH)) {
        console.log(`🚫 Login falhou para: ${user}`);
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }
    const token = jwt.sign({ user, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    console.log(`🔑 Login admin: ${user}`);
    res.json({ success: true, token, expiresIn: JWT_EXPIRES });
});

/**
 * GET /api/auth/verify
 * Verify if current JWT is valid
 */
app.get('/api/auth/verify', requireAuth, (req, res) => {
    res.json({ valid: true, user: req.adminUser });
});

/**
 * POST /api/auth/superlogin
 * Super Admin login — returns JWT with role: 'superadmin'
 */
app.post('/api/auth/superlogin', authLimiter, async (req, res) => {
    const { user, password } = req.body;
    if (!user || !password) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }
    if (user !== SUPER_ADMIN_USER || !bcrypt.compareSync(password, SUPER_ADMIN_PASS_HASH)) {
        console.log(`🚫 Super admin login falhou para: ${user}`);
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }
    const token = jwt.sign({ user, role: 'superadmin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    console.log(`🔑 Login SUPER ADMIN: ${user}`);
    res.json({ success: true, token, expiresIn: JWT_EXPIRES });
});

/**
 * GET /api/auth/superverify
 * Verify if current JWT is valid AND has superadmin role
 */
app.get('/api/auth/superverify', requireSuperAdmin, (req, res) => {
    res.json({ valid: true, user: req.adminUser, role: 'superadmin' });
});

// Block direct access to admin.html without auth cookie/token
// (serves login page if not authenticated)
app.use('/admin.html', (req, res, next) => {
    // Always serve the file — auth is checked client-side via JWT
    next();
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

        res.json({
            cliente: pedido.cliente,
            cnpj: pedido.cnpj,
            pedidoId: pedido.pedido_id,
            revenda: pedido.revenda,
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
app.post('/api/validar', async (req, res) => {
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
app.post('/api/pedidos', requireAuth, async (req, res) => {
    try {
        const { cliente, cnpj, revenda, revenda_nome } = req.body;

        if (!cliente || !cnpj) {
            return res.status(400).json({ error: 'Nome do cliente e CNPJ são obrigatórios' });
        }

        const revendaVal = (revenda || 'ingram').toLowerCase();
        if (!['ingram', 'tds'].includes(revendaVal)) {
            return res.status(400).json({ error: 'Distribuidor deve ser "ingram" ou "tds"' });
        }

        const revendaNome = (revenda_nome || '').trim();

        // Gera pedidoId com componente aleatório (não sequencial)
        const ts = Date.now().toString(36);
        const rand = crypto.randomBytes(3).toString('hex');
        const pedidoId = `PED-${ts}-${rand}`.toUpperCase();

        // Gera token forte (32 chars hex = 128 bits de entropia)
        const token = crypto.randomBytes(16).toString('hex');

        // Tenta gerar link GDAP individual para este pedido
        let gdapLink = null;
        let gdapRelationshipId = null;

        // 1. Tenta pegar do pool de links pré-cadastrados
        const poolLink = await dbGet("SELECT * FROM gdap_pool WHERE status = 'disponivel' ORDER BY criado_em ASC LIMIT 1");
        if (poolLink) {
            gdapLink = poolLink.link;
            await dbRun(
                "UPDATE gdap_pool SET status = 'usado', pedido_id = ?, usado_em = CURRENT_TIMESTAMP WHERE id = ?",
                [pedidoId, poolLink.id]
            );
            console.log(`[GDAP Pool] Link #${poolLink.id} atribuído ao pedido ${pedidoId}`);
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

        await dbRun(
            'INSERT INTO pedidos (pedido_id, token, cliente, cnpj, revenda, revenda_nome, gdap_link, gdap_relationship_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [pedidoId, token, cliente.trim(), cnpj.trim(), revendaVal, revendaNome, gdapLink, gdapRelationshipId]
        );

        console.log(`📋 Novo pedido criado: ${pedidoId} → ${cliente} (${revendaVal}) [Revenda: ${revendaNome || 'N/A'}]`);

        res.json({
            success: true,
            pedidoId,
            token,
            cliente: cliente.trim(),
            cnpj: cnpj.trim(),
            revenda: revendaVal,
            revenda_nome: revendaNome,
            gdapLink,
            link: `/?pedidoId=${pedidoId}&token=${token}&revenda=${revendaVal}`
        });
    } catch (err) {
        console.error('Erro ao criar pedido:', err);
        res.status(500).json({ error: 'Erro interno ao criar pedido' });
    }
});

/**
 * GET /api/pedido-completo/:pedidoId
 * Retorna pedido com token (uso interno admin — REQUER AUTH)
 */
app.get('/api/pedido-completo/:pedidoId', requireAuth, async (req, res) => {
    try {
        const pedido = await dbGet(
            'SELECT pedido_id, token, cliente, cnpj, revenda, revenda_nome, status, gdap_link FROM pedidos WHERE pedido_id = ?',
            [req.params.pedidoId]
        );
        if (!pedido) return res.status(404).json({ error: 'Não encontrado' });
        res.json({ ...pedido, gdap_link: pedido.gdap_link || null });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno' });
    }
});

/**
 * PUT /api/pedidos/:pedidoId
 * Edita um pedido existente
 */
app.put('/api/pedidos/:pedidoId', requireAuth, async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const { cliente, cnpj, revenda, revenda_nome, gdapLink } = req.body;

        const pedido = await dbGet('SELECT * FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });

        const newCliente = (cliente || pedido.cliente).trim();
        const newCnpj = (cnpj || pedido.cnpj).trim();
        const newRevenda = (revenda || pedido.revenda).toLowerCase();
        const newRevendaNome = revenda_nome !== undefined ? (revenda_nome || '').trim() : (pedido.revenda_nome || '');

        if (!['ingram', 'tds'].includes(newRevenda)) {
            return res.status(400).json({ error: 'Distribuidor deve ser "ingram" ou "tds"' });
        }

        // Atualiza link GDAP se fornecido (permite inserção/edição manual)
        const newGdapLink = gdapLink !== undefined ? (gdapLink || null) : pedido.gdap_link;

        await dbRun(
            'UPDATE pedidos SET cliente = ?, cnpj = ?, revenda = ?, revenda_nome = ?, gdap_link = ?, atualizado_em = CURRENT_TIMESTAMP WHERE pedido_id = ?',
            [newCliente, newCnpj, newRevenda, newRevendaNome, newGdapLink, pedidoId]
        );

        console.log(`✏️ Pedido editado: ${pedidoId}`);
        res.json({ success: true, pedidoId, cliente: newCliente, cnpj: newCnpj, revenda: newRevenda, revenda_nome: newRevendaNome, gdapLink: newGdapLink });
    } catch (err) {
        console.error('Erro ao editar pedido:', err);
        res.status(500).json({ error: 'Erro interno ao editar pedido' });
    }
});

/**
 * GET /api/licencas/:pedidoId
 * Lista licenças de um pedido (uso admin)
 */
app.get('/api/licencas/:pedidoId', requireAuth, async (req, res) => {
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
app.post('/api/licencas/:pedidoId', requireAuth, async (req, res) => {
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
app.delete('/api/licencas/:licencaId', requireAuth, async (req, res) => {
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
app.post('/api/proposta/:pedidoId', requireAuth, upload.single('arquivo'), async (req, res) => {
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
 * DELETE /api/pedidos/:pedidoId
 * Remove um pedido
 */
app.delete('/api/pedidos/:pedidoId', requireAuth, async (req, res) => {
    try {
        const { pedidoId } = req.params;
        await dbRun('DELETE FROM licencas WHERE pedido_id = ?', [pedidoId]);
        await dbRun('DELETE FROM logs WHERE pedido_id = ?', [pedidoId]);
        const result = await dbRun('DELETE FROM pedidos WHERE pedido_id = ?', [pedidoId]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
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
app.get('/api/logs/:pedidoId', requireAuth, async (req, res) => {
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
 * GET /api/pedidos
 * Lista todos os pedidos (uso interno/admin)
 */
app.get('/api/pedidos', requireAuth, async (req, res) => {
    try {
        const pedidos = await dbAll(
            'SELECT pedido_id, cliente, cnpj, revenda, revenda_nome, status, criado_em, atualizado_em FROM pedidos ORDER BY criado_em DESC'
        );
        res.json({ total: pedidos.length, pedidos });
    } catch (err) {
        console.error('Erro ao listar pedidos:', err);
        res.status(500).json({ error: 'Erro ao listar pedidos' });
    }
});

// ===== ROTAS REVENDAS =====

/**
 * GET /api/revendas
 * Lista todas as revendas cadastradas
 */
app.get('/api/revendas', requireAuthOrSuper, async (req, res) => {
    try {
        const revendas = await dbAll('SELECT * FROM revendas ORDER BY nome ASC');
        // Conta pedidos por revenda
        const counts = await dbAll(
            `SELECT revenda_nome, COUNT(*) as total FROM pedidos WHERE revenda_nome != '' GROUP BY revenda_nome`
        );
        const countMap = {};
        counts.forEach(c => { countMap[c.revenda_nome] = c.total; });

        const result = revendas.map(r => ({
            ...r,
            pedidos_count: countMap[r.nome] || 0
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
app.get('/api/revendas/ativas', requireAuth, async (req, res) => {
    try {
        const revendas = await dbAll('SELECT id, nome FROM revendas WHERE ativo = 1 ORDER BY nome ASC');
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
        const { nome, contato, email } = req.body;
        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'Nome da revenda é obrigatório' });
        }

        // Verifica duplicata
        const existing = await dbGet('SELECT id FROM revendas WHERE LOWER(nome) = LOWER(?)', [nome.trim()]);
        if (existing) {
            return res.status(409).json({ error: 'Revenda com este nome já existe' });
        }

        const result = await dbRun(
            'INSERT INTO revendas (nome, contato, email) VALUES (?, ?, ?)',
            [nome.trim(), (contato || '').trim(), (email || '').trim()]
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
        const { nome, contato, email, ativo } = req.body;

        const revenda = await dbGet('SELECT * FROM revendas WHERE id = ?', [id]);
        if (!revenda) return res.status(404).json({ error: 'Revenda não encontrada' });

        const newNome = (nome || revenda.nome).trim();
        const newContato = contato !== undefined ? (contato || '').trim() : revenda.contato;
        const newEmail = email !== undefined ? (email || '').trim() : revenda.email;
        const newAtivo = ativo !== undefined ? (ativo ? 1 : 0) : revenda.ativo;

        // Se mudou o nome, atualiza nos pedidos também
        if (newNome !== revenda.nome) {
            await dbRun(
                'UPDATE pedidos SET revenda_nome = ? WHERE revenda_nome = ?',
                [newNome, revenda.nome]
            );
        }

        await dbRun(
            'UPDATE revendas SET nome = ?, contato = ?, email = ?, ativo = ? WHERE id = ?',
            [newNome, newContato, newEmail, newAtivo, id]
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

        // Verifica se tem pedidos associados
        const pedidosCount = await dbGet(
            'SELECT COUNT(*) as total FROM pedidos WHERE revenda_nome = ?',
            [revenda.nome]
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
                r.id, r.nome, r.contato, r.email, r.ativo,
                COUNT(p.pedido_id) as total_pedidos,
                SUM(CASE WHEN p.status = 'VALIDADO' THEN 1 ELSE 0 END) as validados,
                SUM(CASE WHEN p.status = 'PENDENTE' THEN 1 ELSE 0 END) as pendentes
            FROM revendas r
            LEFT JOIN pedidos p ON p.revenda_nome = r.nome
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
app.get('/api/gdap/pool', requireAuthOrSuper, async (req, res) => {
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
app.post('/api/gdap/criar-convite', requireAuth, async (req, res) => {
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
app.post('/api/gdap/gerar-link/:pedidoId', requireAuth, async (req, res) => {
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

// ===== SPA FALLBACK =====
// Rota do cliente (aceite) — servida somente via link com parâmetros
app.get('/validar', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/validar/:pedidoId/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Super Admin — página oculta
app.get('/superadmin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'superadmin.html'));
});

// Página principal = Admin
app.get('/', (req, res) => {
    // Se tem parâmetros de pedido, serve a página do cliente
    if (req.query.pedidoId && req.query.token) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
// Qualquer outra rota não-API serve o admin
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
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
            console.log('  🔒 Segurança:');
            console.log(`  Admin login: ${ADMIN_USER} / (env ADMIN_PASS_HASH)`);
            console.log(`  JWT expires: ${JWT_EXPIRES}`);
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

start();
