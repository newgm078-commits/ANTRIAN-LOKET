// Import: Express untuk router
const express = require("express");
// Import: path untuk menyusun lokasi folder/file
const path = require("path");
// Import: fs untuk cek/buat folder
const fs = require("fs");
// Import: multer untuk upload file
const multer = require("multer");
// Import: database + helper pengaturan & tanggal hari ini
const { db, getSettings, setSetting, todayKey } = require("../utils/db");
// Import: middleware login & pengecekan role
const { requireAuth, requireRole } = require("../utils/auth");
// Import: modul antrian (untuk getQueueBundle)
const antrian = require("./antrian");

// router: objek router khusus rute admin
const router = express.Router();

// uploadDir: folder tujuan penyimpanan logo; dibuat otomatis kalau belum ada
const uploadDir = path.join(__dirname, "..", "public", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Konfigurasi upload multer: simpan ke disk, batas 2MB, whitelist ekstensi ketat
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, `logo-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // Maksimal 2MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();
    // 1. TOLAK SECARA EKSPLISIT JIKA FORMAT SVG (Pencegahan XSS)
    if (ext === ".svg" || mime.includes("svg")) {
      return cb(new Error("Format SVG dilarang demi keamanan sistem (XSS Prevention)"));
    }
    // 2. HANYA IZINKAN FORMAT RASTER STANDAR (.png, .jpg, .jpeg, .webp)
    if (!ALLOWED_EXT.includes(ext) || !ALLOWED_MIME.includes(mime)) {
      return cb(new Error("Hanya file gambar format .png, .jpg, .jpeg, dan .webp yang diizinkan"));
    }
    cb(null, true);
  }
});

// POST /logo - Upload logo baru dengan penanganan error JSON & pembersihan file lama
router.post("/logo", requireAuth, requireRole("admin"), (req, res) => {
  upload.single("logo")(req, res, (err) => {
    // Tangani error multer (ukuran melebihi batas atau format file ditolak)
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Ukuran file logo maksimal 2MB" });
      }
      return res.status(400).json({ error: `Gagal upload: ${err.message}` });
    } else if (err) {
      // Error dari fileFilter (menolak SVG atau format tidak dikenal)
      return res.status(400).json({ error: err.message });
    }
    // Pastikan ada file yang diunggah
    if (!req.file) {
      return res.status(400).json({ error: "File logo wajib dipilih" });
    }
    // PENGHAPUSAN FILE LAMA: Hapus logo lama agar tidak menumpuk di disk
    const oldLogo = getSetting("logo");
    if (oldLogo && oldLogo.startsWith("/uploads/")) {
      const oldPath = path.join(__dirname, "..", "public", oldLogo);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (e) {}
      }
    }
    const url = `/uploads/${req.file.filename}`;
    setSetting("logo", url);
    req.app.get("io").emit("queue:update", antrian.getQueueBundle());
    res.json({ ok: true, url });
  });
});

// GET /settings - Ambil pengaturan: menampilkan semua setting sistem (admin)
router.get("/settings", requireAuth, requireRole("admin"), (req, res) => {
  res.json({ settings: getSettings() });
});

// PUT /settings - Simpan pengaturan: update setting yang diizinkan lalu broadcast ke semua layar
router.put("/settings", requireAuth, requireRole("admin"), (req, res) => {
  const allowed = ["instansi", "tagline", "ticket_footer", "voice_enabled", "taking_enabled", "prefixes", "tts_voice", "tts_rate", "voice_source", "service_status", "service_note"];
  for (const key of allowed) {
    if (req.body[key] != null) {
      const value = typeof req.body[key] === "string" ? req.body[key] : JSON.stringify(req.body[key]);
      setSetting(key, value);
    }
  }
  req.app.get("io").emit("queue:update", antrian.getQueueBundle());
  res.json({ settings: getSettings() });
});

// POST /emergency - Emergency stop: hentikan/aktifkan kembali pengambilan nomor antrian
router.post("/emergency", requireAuth, requireRole("admin"), (req, res) => {
  const stop = req.body.stop !== false;
  setSetting("taking_enabled", stop ? "0" : "1");
  req.app.get("io").emit("queue:update", antrian.getQueueBundle());
  req.app.get("io").emit("system:emergency", { stop });
  res.json({ takingEnabled: !stop });
});

// POST /reset - Reset antrian: hapus semua tiket hari ini
router.post("/reset", requireAuth, requireRole("admin"), (req, res) => {
  const day = todayKey();
  db.prepare("DELETE FROM tickets WHERE day_key = ?").run(day);
  req.app.get("io").emit("queue:update", antrian.getQueueBundle());
  res.json({ ok: true, day });
});

// GET /stats - Statistik: jumlah antrian hari ini per status
router.get("/stats", requireAuth, (req, res) => {
  res.json(antrian.getQueueBundle().stats);
});

// POST /logo - Upload logo: simpan file logo dan catat URL-nya di setting
router.post("/logo", requireAuth, requireRole("admin"), upload.single("logo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File logo wajib diunggah" });
  const url = `/uploads/${req.file.filename}`;
  setSetting("logo", url);
  req.app.get("io").emit("queue:update", antrian.getQueueBundle());
  res.json({ ok: true, url });
});

// Export: router dipakai di server utama
module.exports = router;