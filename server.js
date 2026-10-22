// Import modul bawaan Node.js & library pihak ketiga
const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

// Membaca file .env mengunakan node.js modern
if (fs.existsSync(".env")) {
  process.loadEnvFile();
}

// VALIDASI KETAT: Server MENOLAK MENYALA jika SESSION_SECRET belum disetel di .env
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.trim() === "") {
  console.error("\x1b[31m%s\x1b[0m", "=================================================================");
  console.error("\x1b[31m%s\x1b[0m", " [FATAL ERROR] Variabel SESSION_SECRET belum disetel di file .env!");
  console.error(" Demi keamanan, sistem menolak berjalan menggunakan kunci default.");
  console.error(" Silakan buat file .env dan tentukan SESSION_SECRET yang aman.");
  console.error("\x1b[31m%s\x1b[0m", "=================================================================");
  process.exit(1); // Hentikan server seketika
}

// Import semua route (pembagi urusan per fitur: auth, antrian, loket, admin)
const authRoutes = require("./routes/auth");
const antrianRoutes = require("./routes/antrian");
const loketRoutes = require("./routes/loket");
const adminRoutes = require("./routes/admin");

// Buat aplikasi Express & bungkus dengan server HTTP biasa (supaya bisa dipasangi Socket.io)
const app = express();

// =========================================================================
// PENGUATAN KEAMANAN HEADER HTTP (SECURITY HEADERS)
// =========================================================================

// 1. NONAKTIFKAN IDENTITAS SERVER (Mencegah scanner mendeteksi Express/Node.js)
app.disable("x-powered-by");

// 2. PASANG HEADER KEAMANAN STANDAR PADA SETIAP RESPONS
app.use((req, res, next) => {
  // Cegah Clickjacking: melarang halaman antrian/login disematkan ke dalam <iframe> di situs lain
  res.setHeader("X-Frame-Options", "DENY");

  // Cegah MIME Sniffing: memaksa browser mengikuti Content-Type asli file (mencegah eksekusi script tersembunyi)
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Lindungi privasi URL saat navigasi keluar
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  next();
});

// Buat server HTTP dan pasang Socket.io ke server yang sama
const server = http.createServer(app);
// Pasang Socket.io ke server yang sama, supaya bisa kirim update real-time ke browser
const io = new Server(server);
// Simpan "io" supaya bisa diakses dari file route lain lewat req.app.get("io")
app.set("io", io);

// Supaya Express bisa baca body request berformat JSON
app.use(express.json());
// Setup session login (siapa yang sedang login, disimpan di cookie)
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

// Daftarkan semua endpoint API, dikelompokkan per fitur
app.use("/api/auth", authRoutes);
app.use("/api/antrian", antrianRoutes);
app.use("/api/loket", loketRoutes);
app.use("/api/admin", adminRoutes);

// Helper: tentukan halaman tujuan utama berdasarkan role akun
function getHomeUrl(role) {
  if (role === "admin") return "/admin.html";
  if (role === "loket") return "/loket.html";
  if (role === "queue_taker") return "/queue-taker.html";
  return "/login.html";
}

// Middleware proteksi halaman web (.html):
// Cegah akses via URL jika belum login atau role tidak sesuai
function requirePageAuth(allowedRoles = []) {
  return (req, res, next) => {
    // 1. Cek apakah sesi login aktif
    if (!req.session || !req.session.user) {
      return res.redirect("/login.html");
    }
    // 2. Cek apakah role akun diizinkan
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.session.user.role)) {
      // Alihkan ke halaman sesuai hak aksesnya
      return res.redirect(getHomeUrl(req.session.user.role));
    }
    next();
  };
}

// --- RUTE HALAMAN WEB (DIPROTEKSI DI SERVER) ---

// Halaman utama & login: jika sudah login, langsung lempar ke dashboard masing-masing
app.get(["/", "/login.html", "/login"], (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect(getHomeUrl(req.session.user.role));
  }
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Halaman Admin: hanya role 'admin'
app.get(["/admin.html", "/admin"], requirePageAuth(["admin"]), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Halaman Kontrol Loket: role 'loket' dan 'admin'
app.get(["/loket.html", "/loket"], requirePageAuth(["loket", "admin"]), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "loket.html"));
});

// Halaman Ambil Nomor / Kios: role 'queue_taker' dan 'admin'
app.get(["/queue-taker.html", "/queue-taker", "/kios"], requirePageAuth(["queue_taker", "admin"]), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "queue-taker.html"));
});

// Halaman Riwayat: role 'admin' dan 'loket'
app.get(["/riwayat.html", "/riwayat"], requirePageAuth(["admin", "loket"]), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "riwayat.html"));
});

// Halaman Display TV: untuk layar monitor ruang tunggu (publik)
app.get(["/display.html", "/display"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "display.html"));
});

// Blokir semua akses langsung ke file .html lain yang tidak terdaftar
app.use((req, res, next) => {
  if (req.path.endsWith(".html")) {
    return res.redirect("/login.html");
  }
  next();
});

// Layani semua file statis lainnya (css, js, gambar, font, uploads) dari folder public/
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// Fallback untuk URL lain yang tidak terdaftar
app.use((req, res) => {
  if (req.session && req.session.user) {
    return res.redirect(getHomeUrl(req.session.user.role));
  }
  res.redirect("/login.html");
});

// Begitu ada browser baru yang konek lewat Socket.io, langsung kirim data antrian terkini
io.on("connection", (socket) => {
  socket.emit("queue:update", antrianRoutes.getQueueBundle());
});

// Tentukan port server (ambil dari env PORT kalau ada, kalau tidak pakai 3000), lalu nyalakan server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sistem loket berjalan di http://localhost:${PORT}`);
});
