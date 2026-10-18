// Import: Express untuk router
const express = require("express");
// Import: database + helper tanggal, waktu, setting, dan prefix layanan
const { db, todayKey, nowIso, getSetting, getPrefixes } = require("../utils/db");
// Import: middleware login & pengecekan role
const { requireAuth, requireRole } = require("../utils/auth");

// router: objek router khusus rute antrian
const router = express.Router();

// padNumber() - Format nomor: ubah angka jadi 3 digit (1 -> "001")
function padNumber(n) {
  return String(n).padStart(3, "0");
}

// takingEnabled() - Cek pengambilan nomor: true jika belum di-emergency stop
function takingEnabled() {
  return getSetting("taking_enabled") !== "0";
}

// nextNumber() - Nomor berikutnya: hitung nomor antrian selanjutnya per prefix per hari
function nextNumber(prefix, day) {
  const row = db
    .prepare("SELECT MAX(number) AS maxn FROM tickets WHERE prefix = ? AND day_key = ?")
    .get(prefix, day);
  return (row?.maxn || 0) + 1;
}

// ticketPublic() - Format tiket: ubah baris database jadi objek aman untuk dikirim ke client
function ticketPublic(row) {
  if (!row) return null;
  return {
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
    finishedAt: row.finished_at
  };
}

// getStats() - Statistik: hitung jumlah tiket per status pada hari tertentu
function getStats(day) {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS n FROM tickets WHERE day_key = ? GROUP BY status")
    .all(day);
  const counts = { waiting: 0, called: 0, serving: 0, done: 0, skipped: 0 };
  let total = 0;
  for (const row of rows) {
    counts[row.status] = row.n;
    total += row.n;
  }
  return { total, ...counts };
}

// getQueueBundle() - Paket data antrian: gabungan tiket, loket, statistik, setting, dan panggilan terakhir
function getQueueBundle() {
  const day = todayKey();
  const tickets = db
    .prepare(
      `SELECT * FROM tickets WHERE day_key = ? AND status IN ('waiting', 'called', 'serving', 'skipped')
       ORDER BY is_priority DESC, created_at ASC`
    )
    .all(day)
    .map(ticketPublic);

  const lokets = db.prepare("SELECT number, name, active FROM lokets ORDER BY number").all();
  const serving = db
    .prepare(
      `SELECT * FROM tickets WHERE day_key = ? AND status IN ('called', 'serving') ORDER BY loket_number`
    )
    .all(day)
    .map(ticketPublic);

  return {
    day,
    instansi: getSetting("instansi") || "Sistem Loket Web",
    voiceSource: getSetting("voice_source") || "display",
    serviceStatus: getSetting("service_status") || "melayani",
    serviceNote: getSetting("service_note") || "",
    logo: getSetting("logo") || "",
    ttsVoice: getSetting("tts_voice") || "",
    ttsRate: Number(getSetting("tts_rate")) || 0.88,
    tagline: getSetting("tagline") || "Sistem antrian terpadu untuk pelayanan loket.",
    stats: getStats(day),
    prefixes: getPrefixes(),
    tickets,
    lokets,
    serving,
    takingEnabled: takingEnabled(),
    lastCalled: ticketPublic(
      db
        .prepare(
          `SELECT * FROM tickets WHERE day_key = ? AND called_at IS NOT NULL
           ORDER BY called_at DESC LIMIT 1`
        )
        .get(day)
    )
  };
}

// emitUpdate() - Broadcast update: kirim data antrian terbaru ke semua client via socket
function emitUpdate(req) {
  req.app.get("io").emit("queue:update", getQueueBundle());
}

// GET /state - Status antrian: data antrian lengkap (publik, untuk layar display)
router.get("/state", (req, res) => {
  res.json(getQueueBundle());
});

// GET /list - Daftar tiket: tiket hari ini dengan filter status/prefix dan pagination
router.get("/list", requireAuth, (req, res) => {
  const day = todayKey();
  const status = req.query.status;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(10, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  let where = "day_key = ?";
  const params = [day];
  if (status) {
    where += " AND status = ?";
    params.push(status);
  }
  const prefix = req.query.prefix;
  if (prefix) {
    where += " AND prefix = ?";
    params.push(prefix);
  }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM tickets WHERE ${where}`).get(...params).n;
  const rows = db
    .prepare(`SELECT * FROM tickets WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map(ticketPublic);

  res.json({ total, page, limit, rows });
});

// GET /history - Riwayat: tiket selesai/dilewati pada hari tertentu
router.get("/history", requireAuth, (req, res) => {
  const day = req.query.day || todayKey();
  const rows = db
    .prepare(
      `SELECT * FROM tickets WHERE day_key = ? AND status IN ('done', 'skipped')
       ORDER BY finished_at DESC, created_at DESC`
    )
    .all(day)
    .map(ticketPublic);
  res.json({ day, rows });
});

// Ringkasan per hari dalam 1 bulan (untuk halaman History > Bulanan)
router.get("/arsip/bulan", requireAuth, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : todayKey().slice(0, 7);
  const rows = db
    .prepare(
      `SELECT day_key,
              COUNT(*) AS total,
              SUM(status = 'done') AS done,
              SUM(status = 'skipped') AS skipped,
              SUM(status IN ('waiting', 'called', 'serving')) AS pending
       FROM tickets
       WHERE day_key LIKE ?
       GROUP BY day_key
       ORDER BY day_key DESC`
    )
    .all(`${month}-%`);
  res.json({ month, rows });
});

// POST /ambil - Ambil nomor: buat tiket antrian baru sesuai jalur layanan (prioritas opsional)
router.post("/ambil", requireAuth, requireRole("queue_taker", "admin"), (req, res) => {
  if (!takingEnabled()) {
    return res.status(423).json({ error: "Pengambilan nomor sedang dihentikan" });
  }

  const prefix = String(req.body.prefix || "").toUpperCase();
  const isPriority = Boolean(req.body.priority);
  const prefixes = getPrefixes()
   .filter((p) => p.active !== false)
   .map((p) => p.code);
  if (!prefixes.includes(prefix)) {
    return res.status(400).json({ error: "Jalur layanan tidak valid" });
  }

  const day = todayKey();
  const number = nextNumber(prefix, day);
  const code = `${prefix}${padNumber(number)}`;
  const info = db
    .prepare(
      `INSERT INTO tickets (prefix, number, code, is_priority, status, created_at, day_key)
       VALUES (?, ?, ?, ?, 'waiting', ?, ?)`
    )
    .run(prefix, number, code, isPriority ? 1 : 0, nowIso(), day);

  const ticket = ticketPublic(db.prepare("SELECT * FROM tickets WHERE id = ?").get(info.lastInsertRowid));
  emitUpdate(req);
  res.json({ ticket, instansi: getSetting("instansi"), footer: getSetting("ticket_footer"), logo: getSetting("logo") });
});

// requireLoket() - Tentukan loket: ambil nomor loket dari petugas (admin boleh pilih loket sendiri)
function requireLoket(req, res) {
  const user = req.session.user;
  if (user.role === "admin") {
    return Number(req.body.loketNumber || req.query.loketNumber) || 1;
  }
  if (user.role !== "loket" || !user.loketNumber) {
    res.status(403).json({ error: "Hanya petugas loket" });
    return null;
  }
  return user.loketNumber;
}

// pickNext() - Pilih tiket berikutnya: tiket waiting terdepan di jalur tertentu (prioritas dulu)
function pickNext(prefix, day) {
  return db
    .prepare(
      `SELECT * FROM tickets
       WHERE day_key = ? AND prefix = ? AND status = 'waiting'
       ORDER BY is_priority DESC, created_at ASC
       LIMIT 1`
    )
    .get(day, prefix);
}

// POST /panggil - Panggil antrian: panggil tiket berikutnya (atau tiket tertentu) ke loket
router.post("/panggil", requireAuth, requireRole("loket", "admin"), (req, res) => {
  const loketNumber = requireLoket(req, res);
  if (!loketNumber) return;
  if (!takingEnabled() && !req.body.ticketId) {
    return res.status(423).json({ error: "Sistem sedang emergency stop" });
  }

  const day = todayKey();
  let ticket;
  if (req.body.ticketId) {
    ticket = db.prepare("SELECT * FROM tickets WHERE id = ? AND day_key = ?").get(req.body.ticketId, day);
  } else {
    const prefix = String(req.body.prefix || "").toUpperCase();
    ticket = pickNext(prefix, day);
  }

  if (!ticket || !["waiting", "called", "skipped"].includes(ticket.status)) {
    return res.status(404).json({ error: "Tidak ada antrian yang bisa dipanggil" });
  }

  const existing = currentLoketTicket(loketNumber, ticket.prefix);
  if (existing && existing.id !== ticket.id) {
    return res.status(409).json({ error: "Selesaikan tiket aktif di jalur ini terlebih dahulu" });
  }

  db.prepare(
    `UPDATE tickets SET status = 'called', loket_number = ?, called_at = ? WHERE id = ?`
  ).run(loketNumber, nowIso(), ticket.id);

  const updated = ticketPublic(db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id));
  emitUpdate(req);
  req.app.get("io").emit("ticket:called", {
    ticket: updated,
    loketNumber,
    voiceEnabled: getSetting("voice_enabled") === "1"
  });
  res.json({ ticket: updated });
});

// POST /ulang - Panggil ulang: umumkan lagi tiket yang sedang aktif di loket
router.post("/ulang", requireAuth, requireRole("loket", "admin"), (req, res) => {
  const loketNumber = requireLoket(req, res);
  if (!loketNumber) return;
  const ticket = currentLoketTicket(loketNumber, req.body.prefix);
  if (!ticket) return res.status(404).json({ error: "Belum ada nomor untuk dipanggil ulang" });

  const updated = ticketPublic(ticket);
  req.app.get("io").emit("ticket:called", {
    ticket: updated,
    loketNumber,
    voiceEnabled: getSetting("voice_enabled") === "1"
  });
  emitUpdate(req);
  res.json({ ticket: updated });
});

// POST /skip - Lewati antrian: tandai tiket aktif sebagai skipped (tidak hadir)
router.post("/skip", requireAuth, requireRole("loket", "admin"), (req, res) => {
  const loketNumber = requireLoket(req, res);
  if (!loketNumber) return;
  const ticket = currentLoketTicket(loketNumber, req.body.prefix);
  if (!ticket) return res.status(404).json({ error: "Tidak ada tiket aktif" });

  db.prepare(
    `UPDATE tickets SET status = 'skipped', finished_at = ? WHERE id = ?`
  ).run(nowIso(), ticket.id);
  emitUpdate(req);
  res.json({ ticket: ticketPublic(db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id)) });
});

// POST /mulai - Mulai layanan: ubah status tiket dari called ke serving
router.post("/mulai", requireAuth, requireRole("loket", "admin"), (req, res) => {
  const loketNumber = requireLoket(req, res);
  if (!loketNumber) return;
  const ticket = currentLoketTicket(loketNumber, req.body.prefix);
  if (!ticket) return res.status(404).json({ error: "Panggil nomor terlebih dahulu" });

  db.prepare(
    `UPDATE tickets SET status = 'serving', started_at = COALESCE(started_at, ?) WHERE id = ?`
  ).run(nowIso(), ticket.id);
  emitUpdate(req);
  res.json({ ticket: ticketPublic(db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id)) });
});

// POST /selesai - Selesaikan layanan: tandai tiket aktif sebagai done
router.post("/selesai", requireAuth, requireRole("loket", "admin"), (req, res) => {
  const loketNumber = requireLoket(req, res);
  if (!loketNumber) return;
  const ticket = currentLoketTicket(loketNumber, req.body.prefix);
  if (!ticket) return res.status(404).json({ error: "Tidak ada tiket aktif" });

  db.prepare(
    `UPDATE tickets SET status = 'done', finished_at = ? WHERE id = ?`
  ).run(nowIso(), ticket.id);
  emitUpdate(req);
  res.json({ ticket: ticketPublic(db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id)) });
});

// currentLoketTicket() - Tiket aktif loket: cari tiket called/serving milik loket (opsional per jalur)
function currentLoketTicket(loketNumber, prefix) {
  if (prefix) {
    return db
      .prepare(
        `SELECT * FROM tickets WHERE loket_number = ? AND prefix = ? AND day_key = ? AND status IN ('called', 'serving')
         ORDER BY called_at DESC LIMIT 1`
      )
      .get(loketNumber, String(prefix).toUpperCase(), todayKey());
  }
  return db
    .prepare(
      `SELECT * FROM tickets WHERE loket_number = ? AND day_key = ? AND status IN ('called', 'serving')
       ORDER BY called_at DESC LIMIT 1`
    )
    .get(loketNumber, todayKey());
}

// Export getQueueBundle: supaya bisa dipakai file route lain (admin.js, loket.js)
router.getQueueBundle = getQueueBundle;
// Export: router dipakai di server utama
module.exports = router;