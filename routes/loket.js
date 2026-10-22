// Import: Express untuk router
const express = require("express");
// Import: bcryptjs untuk hash password akun loket
const bcrypt = require("bcryptjs");
// Import: koneksi database
const { db } = require("../utils/db");
// Import: middleware login & pengecekan role
const { requireAuth, requireRole } = require("../utils/auth");
// Import: modul antrian (untuk getQueueBundle)
const antrian = require("./antrian");

// router: objek router khusus rute manajemen loket
const router = express.Router();

// POST / - Tambah loket: buat loket baru + akun petugas otomatis (loketN / loket123)
router.post("/", requireAuth, requireRole("admin"), (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Nama loket wajib" });
  const row = db.prepare("SELECT MAX(number) AS maxn FROM lokets").get();
  const number = (row?.maxn || 0) + 1;
  db.prepare("INSERT INTO lokets (number, name, active) VALUES (?, ?, 1)").run(number, name);

  const username = `loket${number}`;
  const defaultPassword = "loket123";
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare(
    "INSERT INTO users (username, password, display_name, role, loket_number) VALUES (?, ?, ?, 'loket', ?)"
  ).run(username, hash, `Petugas Loket ${number}`, number);

  req.app.get("io").emit("queue:update", antrian.getQueueBundle());
  res.json({ ok: true, number, username, defaultPassword });
});

// PUT /:number/password - Ganti password: reset password akun petugas loket tertentu
router.put("/:number/password", requireAuth, requireRole("admin"), (req, res) => {
  const number = Number(req.params.number);
  const password = String(req.body.password || "");
  if (password.length < 4) return res.status(400).json({ error: "Password minimal 4 karakter" });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare("UPDATE users SET password = ? WHERE role = 'loket' AND loket_number = ?").run(hash, number);
  if (result.changes === 0) return res.status(404).json({ error: "Akun loket tidak ditemukan" });
  res.json({ ok: true });
});

// GET / - Daftar loket: semua loket beserta tiket yang sedang dilayani
router.get("/", requireAuth, (req, res) => {
  const lokets = db.prepare("SELECT number, name, active FROM lokets ORDER BY number").all();
  const state = antrian.getQueueBundle();
  const servingByLoket = {};
  for (const ticket of state.serving) {
    servingByLoket[ticket.loketNumber] = ticket;
  }
  res.json({
    lokets: lokets.map((loket) => ({
      ...loket,
      current: servingByLoket[loket.number] || null
    }))
  });
});

// PUT /:number - Edit loket: ubah nama dan status aktif loket
router.put("/:number", requireAuth, requireRole("admin"), (req, res) => {
  const number = Number(req.params.number);
  const name = String(req.body.name || "").trim();
  const active = req.body.active == null ? 1 : req.body.active ? 1 : 0;
  if (!name) return res.status(400).json({ error: "Nama loket wajib" });
  db.prepare("UPDATE lokets SET name = ?, active = ? WHERE number = ?").run(name, active, number);
  req.app.get("io").emit("queue:update", antrian.getQueueBundle());
  res.json({ ok: true });
});



// DELETE /:number - Hapus loket: hapus loket + akunnya (min. 1 loket tersisa & tidak sedang melayani)
router.delete("/:number", requireAuth, requireRole("admin"), (req, res) => {
  const number = Number(req.params.number);
  const total = db.prepare("SELECT COUNT(*) AS c FROM lokets").get().c;
  if (total <= 1) {
    return res.status(400).json({ error: "Tidak bisa menghapus, minimal harus ada 1 loket" });
  }
  const day = require("../utils/db").todayKey();
  const aktifSedangDipakai = db
    .prepare("SELECT COUNT(*) AS c FROM tickets WHERE day_key = ? AND loket_number = ? AND status IN ('called','serving')")
    .get(day, number).c;
  if (aktifSedangDipakai > 0) {
    return res.status(400).json({ error: "Loket ini sedang melayani tiket, tidak bisa dihapus sekarang" });
  }
  db.prepare("DELETE FROM lokets WHERE number = ?").run(number);
  db.prepare("DELETE FROM users WHERE role = 'loket' AND loket_number = ?").run(number);
  req.app.get("io").emit("queue:update", antrian.getQueueBundle());
  res.json({ ok: true });
});

// Export: router dipakai di server utama
module.exports = router;