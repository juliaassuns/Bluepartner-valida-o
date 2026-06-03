const crypto = require('crypto');

function safeStringEquals(a, b) {
    const left = Buffer.from(String(a ?? ''));
    const right = Buffer.from(String(b ?? ''));

    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

module.exports = { safeStringEquals };
