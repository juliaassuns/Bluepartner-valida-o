const express = require('express');
const crypto = require('crypto');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { jwtVerify, createRemoteJWKSet } = require('jose');
const { dbGet, dbRun } = require('../db');

const router = express.Router();

// ===== AUTH CONFIG (Microsoft Entra ID) =====
const ENTRA_TENANT_ID = process.env.ENTRA_TENANT_ID;
const ENTRA_CLIENT_ID = process.env.ENTRA_CLIENT_ID;
const ENTRA_CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET;
const ENTRA_REDIRECT_URI = process.env.ENTRA_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const ENTRA_ALLOWED_USER_EMAILS = String(process.env.ENTRA_ALLOWED_USER_EMAILS || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
const ENTRA_ALLOWED_GROUP_IDS = String(process.env.ENTRA_ALLOWED_GROUP_IDS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

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

function generateOAuthState(wantFabric) {
    const nonce = crypto.randomBytes(24).toString('base64url');
    const flow = wantFabric ? 'fabric' : 'base';
    return `${flow}:${nonce}`;
}

function parseOAuthState(value) {
    const state = String(value || '');
    const parts = state.split(':');
    if (parts.length !== 2) return null;
    const [flow, nonce] = parts;
    if (!['base', 'fabric'].includes(flow)) return null;
    if (!/^[A-Za-z0-9_-]{20,}$/.test(nonce)) return null;
    return { flow, nonce, raw: state };
}

function safeStringEquals(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

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

function userInAllowedGroups(groupIds) {
    if (!ENTRA_ALLOWED_GROUP_IDS.length) return true;
    return Array.isArray(groupIds) && groupIds.some(id => ENTRA_ALLOWED_GROUP_IDS.includes(id));
}

function userEmailAllowed(email) {
    if (!ENTRA_ALLOWED_USER_EMAILS.length) return true;
    return ENTRA_ALLOWED_USER_EMAILS.includes(String(email || '').toLowerCase().trim());
}

async function fetchUserGroupIds(accessToken) {
    if (!accessToken) return [];

    const groupIds = [];
    let nextUrl = 'https://graph.microsoft.com/v1.0/me/memberOf?$select=id';

    while (nextUrl) {
        const resp = await fetch(nextUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json'
            }
        });

        if (!resp.ok) {
            throw new Error(`Falha ao consultar grupos do usuário no Graph (${resp.status})`);
        }

        const data = await resp.json();
        const values = Array.isArray(data.value) ? data.value : [];
        for (const item of values) {
            if (item && typeof item.id === 'string') groupIds.push(item.id);
        }

        nextUrl = data['@odata.nextLink'] || null;
    }

    return groupIds;
}

router.get('/auth/login', async (req, res) => {
    if (!ENTRA_TENANT_ID || !ENTRA_CLIENT_ID || !ENTRA_CLIENT_SECRET) {
        return res.status(500).send('Entra ID não configurado. Preencha ENTRA_* no .env');
    }

    const wantFabric = req.query.fabric === '1';
    const scopes = wantFabric
        ? ['openid', 'profile', 'email', 'User.Read', 'https://analysis.windows.net/powerbi/api/Dataset.Read.All', 'https://analysis.windows.net/powerbi/api/Workspace.Read.All']
        : ['openid', 'profile', 'email', 'User.Read'];

    const oauthState = generateOAuthState(wantFabric);
    req.session.oauthState = {
        value: oauthState,
        createdAt: Date.now()
    };

    const authCodeUrl = await msalClient.getAuthCodeUrl({
        redirectUri: ENTRA_REDIRECT_URI,
        scopes,
        prompt: 'select_account',
        state: oauthState
    });

    res.redirect(authCodeUrl);
});

router.get('/auth/callback', async (req, res) => {
    try {
        const code = req.query.code;
        if (!code) return res.status(400).send('Código ausente');

        const parsedState = parseOAuthState(req.query.state);
        const expectedState = req.session?.oauthState?.value;
        const stateAgeMs = Date.now() - Number(req.session?.oauthState?.createdAt || 0);
        if (!parsedState || !expectedState || !safeStringEquals(parsedState.raw, expectedState) || stateAgeMs > (15 * 60 * 1000)) {
            return res.status(400).send('State OAuth inválido ou expirado. Tente novamente.');
        }
        delete req.session.oauthState;

        const wantFabric = parsedState.flow === 'fabric';
        const scopes = wantFabric
            ? ['openid', 'profile', 'email', 'User.Read', 'https://analysis.windows.net/powerbi/api/Dataset.Read.All', 'https://analysis.windows.net/powerbi/api/Workspace.Read.All']
            : ['openid', 'profile', 'email', 'User.Read'];

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

        if (!userEmailAllowed(email)) {
            return res.status(403).send('Acesso negado. Usuário fora da lista permitida para o painel.');
        }

        let userGroupIds = Array.isArray(claims.groups) ? claims.groups : [];
        if (ENTRA_ALLOWED_GROUP_IDS.length && userGroupIds.length === 0) {
            try {
                userGroupIds = await fetchUserGroupIds(tokenResponse.accessToken);
            } catch (groupErr) {
                console.error('Erro ao consultar grupos do usuário:', groupErr.message);
                return res.status(403).send('Não foi possível validar grupos de acesso no Entra ID.');
            }
        }

        if (!userInAllowedGroups(userGroupIds)) {
            return res.status(403).send('Acesso negado. Usuário fora dos grupos permitidos para o painel.');
        }

        const userRow = await dbGet('SELECT email, nome, role, ativo, criado_em FROM usuarios WHERE LOWER(email) = LOWER(?)', [email]);
        if (!userRow) {
            return res.status(403).send(`Usuário não cadastrado (${email}). Peça ao superadmin para adicionar seu e-mail.`);
        }
        if (!userRow.ativo) return res.status(403).send('Usuário inativo');

        if ((!userRow.nome || !userRow.nome.trim()) && nome) {
            await dbRun('UPDATE usuarios SET nome = ? WHERE LOWER(email) = LOWER(?)', [nome, email]);
        }

        req.session.user = {
            email: userRow.email,
            nome: userRow.nome || nome || '',
            role: userRow.role,
            ativo: !!userRow.ativo,
            groups: userGroupIds
        };

        try {
            await dbRun(
                'INSERT INTO audit_log (usuario, acao, detalhes) VALUES (?, ?, ?)',
                [email, 'LOGIN', `Role: ${userRow.role}, IP: ${req.ip}`]
            );
        } catch (_) { /* não bloqueia login se audit falhar */ }

        if (tokenResponse.accessToken) {
            req.session.fabricToken = tokenResponse.accessToken;
            req.session.graphToken = tokenResponse.accessToken;
        }

        if (userRow.role === 'superadmin') return res.redirect('/superadmin');
        return res.redirect('/admin');
    } catch (err) {
        console.error('Erro no /auth/callback:', err);
        res.status(500).send('Erro ao autenticar');
    }
});

function finishLogout(req, res) {
    const userEmail = req.session?.user?.email || 'unknown';

    dbRun(
        'INSERT INTO audit_log (usuario, acao, detalhes) VALUES (?, ?, ?)',
        [userEmail, 'LOGOUT', `IP: ${req.ip}`]
    ).catch(() => { /* não bloqueia logout */ });

    req.session.destroy(() => {
        res.clearCookie('bp.sid');
        res.json({ success: true });
    });
}

router.post('/auth/logout', (req, res) => {
    finishLogout(req, res);
});

router.get('/auth/logout', (req, res) => {
    res.status(405).json({ error: 'Use POST /auth/logout' });
});

router.get('/auth/me', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ user: null });
    res.json({ user: req.session.user });
});

module.exports = router;
