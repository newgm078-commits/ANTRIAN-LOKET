const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const dbDir = path.join(__dirname, "..", "database");
const dbPath = path.join(dbDir, "antrian.db");

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'loket', 'queue_taker')),
    loket_number INTEGER
  );

  CREATE TABLE IF NOT EXISTS lokets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER UNIQUE NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prefix TEXT NOT NULL,
    number INTEGER NOT NULL,
    code TEXT NOT NULL,
    is_priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'waiting'
      CHECK (status IN ('waiting', 'called', 'serving', 'done', 'skipped')),
    loket_number INTEGER,
    created_at TEXT NOT NULL,
    called_at TEXT,
    started_at TEXT,
    finished_at TEXT,
    day_key TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_day_status ON tickets (day_key, status);
  CREATE INDEX IF NOT EXISTS idx_tickets_prefix ON tickets (day_key, prefix, number);
`);

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nowIso() {
  return new Date().toISOString();
}

function seed() {
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password, display_name, role, loket_number)
      VALUES (?, ?, ?, ?, ?)
    `);
    const password = bcrypt.hashSync("admin123", 10);
    const loketPass = bcrypt.hashSync("loket123", 10);
    const kiosPass = bcrypt.hashSync("kios123", 10);

    insertUser.run("admin", password, "Administrator", "admin", null);
    insertUser.run("kios", kiosPass, "Queue Taker", "queue_taker", null);
    for (let i = 1; i <= 11; i += 1) {
      insertUser.run(`loket${i}`, loketPass, `Petugas Loket ${i}`, "loket", i);
    }
  }

  const loketCount = db.prepare("SELECT COUNT(*) AS n FROM lokets").get().n;
  if (loketCount === 0) {
    const insertLoket = db.prepare("INSERT INTO lokets (number, name, active) VALUES (?, ?, 1)");
    for (let i = 1; i <= 11; i += 1) {
      insertLoket.run(i, `Loket ${i}`);
    }
  }

  const defaults = {
    instansi: "SISTEM LOKET ANTRIAN",
    tagline: "Sistem antrian terpadu untuk pelayanan loket.",
    ticket_footer: "Harap menunggu hingga nomor Anda dipanggil",
    voice_enabled: "1",
    taking_enabled: "1",
    prefixes: JSON.stringify([
      { code: "A", label: "KTP / Identitas", description: "e-KTP, KIA, dan identitas" },
      { code: "B", label: "Kartu Keluarga", description: "Penerbitan dan perubahan KK" },
      { code: "C", label: "Akta & Pindah", description: "Akta kelahiran dan pindah datang" },
      { code: "D", label: "Pengambilan", description: "Pengambilan dokumen jadi" }
    ])
  };

  const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaults)) {
    insertSetting.run(key, value);
  }
}

seed();

function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    String(value)
  );
}

function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

function getPrefixes() {
  try {
    return JSON.parse(getSetting("prefixes") || "[]");
  } catch {
    return [];
  }
}

module.exports = {
  db,
  todayKey,
  nowIso,
  getSetting,
  setSetting,
  getSettings,
  getPrefixes
};
