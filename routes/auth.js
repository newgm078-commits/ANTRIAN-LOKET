// Import: framework Express untuk membuat router
const express = require("express");
// Import: bcryptjs untuk membandingkan password ter-hash
const bcrypt = require("bcryptjs");
// Import: koneksi database
const { db } = require("../utils/db");
// Import: middleware pengecekan login
const { requireAuth } = require("../utils/auth");

// router: objek router khusus rute autentikasi
const router = express.Router();

// POST /login - Login: validasi username & password, lalu simpan user ke session
router.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!username || !password) {
    return res.status(400).json({ error: "Username dan password wajib diisi" });
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Username atau password salah" });
  }

  const safeUser = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    loketNumber: user.loket_number
  };
  req.session.user = safeUser;
  res.json({ user: safeUser });
});

// POST /logout - Logout: hapus session user
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// GET /me - Cek user: mengembalikan data user yang sedang login
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// Export: router dipakai di server utama
module.exports = router;