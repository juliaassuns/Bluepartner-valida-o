const crypto = require('crypto');

const TOKEN_HASH_PEPPER = process.env.TOKEN_HASH_PEPPER;

function safeStringEquals(a, b) {
    const left = Buffer.from(String(a ?? ''));
    const right = Buffer.from(String(b ?? ''));

    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function hashPublicToken(token) {
    return crypto
        .createHash('sha256')
        .update(`${TOKEN_HASH_PEPPER}:${String(token || '')}`)
        .digest('hex');
}

function tokenMatches(storedToken, rawToken) {
    if (!storedToken || !rawToken) return false;
    const stored = String(storedToken);
    const provided = String(rawToken);

    // Compatibilidade: registros antigos podem estar em texto puro.
    if (/^[a-f0-9]{64}$/i.test(stored)) {
        return safeStringEquals(stored.toLowerCase(), hashPublicToken(provided));
    }
    return safeStringEquals(stored, provided);
}

module.exports = { 
    safeStringEquals,
    hashPublicToken,
    tokenMatches,
};
