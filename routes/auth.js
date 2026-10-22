// Import: framework Express untuk membuat router
const express = require("express");
// Import: bcryptjs untuk membandingkan password ter-hash
const bcrypt = require("bcryptjs");
// Import: koneksi database
const { db } = require("../utils/db");
// Import: middleware pengecekan login
const { requireAuth } = require("../utils/auth");
// Import: pembatas laju request
const rateLimit = require("express-rate-limit")

// router: objek router khusus rute autentikasi
const router = express.Router();

// Membuat rate limiter : membuat pembatas laju request login
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  skipSuccessFulRequest: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Terlalu banyak percobaan login. Akses diblokir buat sementara, silahkan coba kembali setelah 5 menit"
  }
})

// POST /login - Login: validasi username & password, lalu simpan user ke session
router.post("/login", loginLimiter, (req, res) => {
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

// PUT /password - Ganti password mandiri (bisa dipakai oleh Admin, Loket, atau Kios)
router.put("/password", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const confirmPassword = String(req.body.confirmPassword || "");

  // 1. Validasi input tidak boleh kosong
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: "Semua kolom password wajib diisi" });
  }

  // 2. Validasi panjang minimal 6 karakter
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Password baru minimal 6 karakter" });
  }

  // 3. Validasi kesamaan konfirmasi password
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "Konfirmasi password baru tidak cocok" });
  }

  // 4. Ambil data user dari database dan cek password saat ini
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: "Password saat ini salah" });
  }

  // 5. Hash password baru dan simpan ke database SQLite
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, userId);

  res.json({ ok: true, message: "Password berhasil diperbarui" });
});

// Export: router dipakai di server utama
module.exports = router;