require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const { initDatabase, dbGet, dbRun } = require('./db.js');
const authRouter = require('./routes/auth');
const pedidosRouter = require('./routes/pedidos');
const validarRouter = require('./routes/validar');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3001;

const BOOTSTRAP_SUPERADMIN_EMAILS = String(process.env.BOOTSTRAP_SUPERADMIN_EMAILS || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET é obrigatório em produção');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function sanitizeRequestUrl(rawUrl) {
    let safeUrl = String(rawUrl || '/');
    safeUrl = safeUrl.replace(/(\/api\/pedido\/[^/]+\/)([^/?#]+)/gi, '$1[redacted]');
    safeUrl = safeUrl.replace(/(\/validar\/[^/]+\/)([^/?#]+)/gi, '$1[redacted]');
    safeUrl = safeUrl.replace(/([?&](?:token|code|state)=)[^&]*/gi, '$1[redacted]');
    return safeUrl;
}

app.set('trust proxy', 1);
app.use(session({
    name: 'bp.sid',
    secret: SESSION_SECRET,
    store: process.env.NODE_ENV !== 'test'
        ? new FileStore({
            path: path.join(__dirname, '..', 'data', 'sessions'),
            ttl: 8 * 60 * 60,
            retries: 0,
            logFn: () => { }
        })
        : undefined,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000 // 8h
    }
}));

if (process.env.NODE_ENV === 'test') {
    app.use((req, res, next) => {
        if (app.__testSession) {
            req.session = req.session || {};
            req.session.user = app.__testSession;
        }
        next();
    });
}

app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' &&
        req.headers['x-forwarded-proto'] !== 'https' &&
        !req.hostname.includes('localhost')) {
        return res.redirect(301, 'https://' + req.hostname + req.originalUrl);
    }
    next();
});

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
        }
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false
}));

app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

app.use(cors({
    origin: process.env.CORS_ORIGIN || false,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function extractCleanIp(req) {
    const raw = req.headers['x-forwarded-for'] || req.ip || '127.0.0.1';
    const first = raw.split(',')[0].trim();
    if (first.includes('.')) {
        return first.replace(/:\d+$/, '');
    }
    return first;
}

const rlValidate = { ip: false, keyGeneratorIpFallback: false };

const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: extractCleanIp,
    validate: rlValidate,
    message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' }
});
app.use(globalLimiter);

app.use((req, res, next) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${req.method} ${sanitizeRequestUrl(req.originalUrl || req.url)}`);
    next();
});

app.use('/', authRouter);
app.use('/api/pedidos', pedidosRouter);
app.use('/api/validar', validarRouter);
app.use('/api', apiRouter);

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});
app.get(['/privacidade', '/privacidade.html'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'privacidade.html'));
});
app.get(['/termos', '/termos.html'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'termos.html'));
});
app.get('/admin', (req, res) => {
    if (!req.session?.user) return res.redirect('/login');
    if (!['admin', 'superadmin'].includes(req.session.user.role)) return res.status(403).send('Sem permissão');
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});
app.get('/superadmin', (req, res) => {
    if (!req.session?.user) return res.redirect('/login');
    if (req.session.user.role !== 'superadmin') return res.status(403).send('Acesso restrito ao super admin');
    res.sendFile(path.join(__dirname, '..', 'public', 'superadmin.html'));
});

app.get(['/admin.html', '/superadmin.html'], (req, res) => {
    res.redirect('/login');
});

app.use(express.static(path.join(__dirname, '..', 'public')));

async function startServer() {
    try {
        await initDatabase();
        console.log('Banco de dados inicializado com sucesso.');

        if (BOOTSTRAP_SUPERADMIN_EMAILS.length > 0) {
            for (const email of BOOTSTRAP_SUPERADMIN_EMAILS) {
                const existing = await dbGet('SELECT email FROM usuarios WHERE LOWER(email) = LOWER(?)', [email]);
                if (!existing) {
                    await dbRun(
                        "INSERT INTO usuarios (email, nome, role, ativo) VALUES (?, ?, 'superadmin', 1)",
                        [email, email.split('@')[0]]
                    );
                    console.log(`[Bootstrap] Superadmin ${email} adicionado.`);
                }
            }
        }

        app.listen(PORT, () => {
            console.log(`Servidor rodando na porta ${PORT}`);
        });
    } catch (err) {
        console.error('Erro ao inicializar o servidor:', err);
        process.exit(1);
    }
}

startServer();
