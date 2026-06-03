function requireAuth(req, res, next) {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

function requireRole(roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    return function requireRoleHandler(req, res, next) {
        const user = req.session?.user;
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const role = user.role;
        if (!allowed.includes(role)) return res.status(403).json({ error: 'Forbidden' });

        next();
    };
}

module.exports = { requireAuth, requireRole };
