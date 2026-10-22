// Import: Express untuk router
const express = require("express");
// Import: path untuk menyusun lokasi folder/file
const path = require("path");
// Import: fs untuk cek/buat folder
const fs = require("fs");
// Import: multer untuk upload file
const multer = require("multer");
// Import: database + helper pengaturan & tanggal hari ini
const { db, getSettings, setSetting, todayKey, nowIso, oneYearAgoKey } = require("../utils/db");
// Import: middleware login & pengecekan role
const { requireAuth, requireRole } = require("../utils/auth");
// Import: modul antrian (untuk getQueueBundle)
const antrian = require("./antrian");

// router: objek router khusus rute admin
const router = express.Router();

// uploadDir: folder tujuan penyimpanan logo; dibuat otomatis kalau belum ada
const uploadDir = path.join(__dirname, "..", "public", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Batasan format file
const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"];

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

// Hapus file logo lama jika ada (kecuali file baru diunggah)
function removePreviousLogo(oldLogo, newFilename) {
  const prefix = "/uploads/";
  if (!oldLogo || !oldLogo.startsWith(prefix)) return;

  const filename = oldLogo.slice(prefix.length);
  if (
    filename === newFilename ||
    path.basename(filename) !== filename ||
    !/^logo-[\w-]+\.(png|jpe?g|webp)$/i.test(filename)
  ) {
    return;
  }

  const oldPath = path.join(uploadDir, filename);
  try {
    fs.unlinkSync(oldPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

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

    const oldLogo = getSetting("logo");
    const url = `/uploads/${req.file.filename}`;
    try {
      setSetting("logo", url);
    } catch (error) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          console.error("Gagal membersihkan file logo baru setelah penyimpanan setting gagal:", cleanupError);
        }
      }
      console.error("Gagal menyimpan setting logo baru:", error);
      return res.status(500).json({ error: "Gagal menyimpan setting logo baru" });
    }

    try {
      removePreviousLogo(oldLogo, req.file.filename);
    } catch (error) {
      console.error("Logo baru tersimpan, tetapi file logo lama gagal dihapus:", error);
      return res.status(500).json({ error: "Logo baru tersimpan, tetapi file logo lama gagal dihapus" });
    }

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

// POST /archive/expired
const archiveExpiredTickets = db.transaction((cutoff, archivedAt) => {
  const copied = db
    .prepare(
      `INSERT OR IGNORE INTO tickets_archive (
         ticket_id, prefix, number, code, is_priority, status, loket_number,
         created_at, called_at, started_at, finished_at, day_key, archived_at
       )
       SELECT id, prefix, number, code, is_priority, status, loket_number,
              created_at, called_at, started_at, finished_at, day_key, ?
       FROM tickets
       WHERE day_key < ?`
    )
    .run(archivedAt, cutoff);

  const removed = db
    .prepare(
      `DELETE FROM tickets
       WHERE day_key < ?
         AND id IN (SELECT ticket_id FROM tickets_archive)`
    )
    .run(cutoff);

  return { archived: removed.changes, newlyArchived: copied.changes };
});

// GET /archive - Daftar tiket arsip lama (hanya admin)
router.get("/archive", requireAuth, requireRole("admin"), (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const total = db.prepare("SELECT COUNT(*) AS n FROM tickets_archive").get().n;
  const rows = db
    .prepare(
      `SELECT ticket_id AS id, prefix, number, code, is_priority, status,
              loket_number, created_at, called_at, started_at, finished_at,
              day_key, archived_at
       FROM tickets_archive
       ORDER BY day_key DESC, ticket_id DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset)
    .map((row) => ({
      id: row.id,
      prefix: row.prefix,
      number: row.number,
      code: row.code,
      isPriority: Boolean(row.is_priority),
      status: row.status,
      loketNumber: row.loket_number,
      createdAt: row.created_at,
      calledAt: row.called_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      day: row.day_key,
      archivedAt: row.archived_at
    }));

  res.json({ total, page, limit, rows });
});

// POST /archive/expired - Pindahkan tiket berumur lebih dari satu tahun ke arsip (hanya admin)
router.post("/archive/expired", requireAuth, requireRole("admin"), (req, res) => {
  const cutoff = oneYearAgoKey();
  const result = archiveExpiredTickets(cutoff, nowIso());
  res.json({ ok: true, cutoff, ...result });
});

// GET /stats - Statistik: jumlah antrian hari ini per status
router.get("/stats", requireAuth, (req, res) => {
  res.json(antrian.getQueueBundle().stats);
});

// Export: router dipakai di server utama
module.exports = router;