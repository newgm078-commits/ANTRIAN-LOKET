// Import modul bawaan Node.js & library pihak ketiga
const path = require("path");
const express = require("express");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

// Import semua route (pembagi urusan per fitur: auth, antrian, loket, admin)
const authRoutes = require("./routes/auth");
const antrianRoutes = require("./routes/antrian");
const loketRoutes = require("./routes/loket");
const adminRoutes = require("./routes/admin");

// Buat aplikasi Express & bungkus dengan server HTTP biasa (supaya bisa dipasangi Socket.io)
const app = express();
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
    secret: process.env.SESSION_SECRET || "magetan-go-digital-loket",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
  })
);

// Daftarkan semua endpoint API, dikelompokkan per fitur
app.use("/api/auth", authRoutes);
app.use("/api/antrian", antrianRoutes);
app.use("/api/loket", loketRoutes);
app.use("/api/admin", adminRoutes);

// Layani semua file statis (html, css, js, gambar, dll) dari folder public/
app.use(express.static(path.join(__dirname, "public")));

// Kalau orang buka alamat utama ("/"), langsung lempar ke halaman login
app.get("/", (req, res) => {
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
