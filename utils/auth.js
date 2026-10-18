function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Belum login" });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: "Belum login" });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: "Akses ditolak" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
