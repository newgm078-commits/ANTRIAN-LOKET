// Wrapper fetch() ke API backend: otomatis kirim JSON, sertakan cookie login, dan lempar error kalau gagal
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Permintaan gagal");
  }
  return data;
}

// Tampilkan notifikasi kecil (toast) di pojok layar selama beberapa detik
function toast(message) {
  let el = document.getElementById("app-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "app-toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.style.display = "none";
  }, 2800);
}

// Ubah kode status tiket ("waiting", "done", dll) jadi badge HTML berwarna
function statusChip(status) {
  const map = {
    waiting: ["WAITING", "chip-waiting"],
    called: ["CALLED", "chip-called"],
    serving: ["SERVING", "chip-serving"],
    done: ["SELESAI", "chip-done"],
    skipped: ["SKIP", "chip-skipped"]
  };
  const [label, cls] = map[status] || [status, "chip-waiting"];
  return `<span class="chip ${cls}">${label}</span>`;
}

// Format tanggal/jam ISO jadi format waktu Indonesia yang gampang dibaca
function formatTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("id-ID");
}

// Daftar nama angka 0-9 dalam Bahasa Indonesia, dipakai buat eja suara panggilan
const ANGKA_ID = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"];

// Ubah kode tiket (misal "A012") jadi ejaan per karakter ("A nol satu dua") untuk diucapkan
function ejaKode(code) {
  return String(code || "")
    .split("")
    .map((ch) => {
      if (/\d/.test(ch)) return ANGKA_ID[Number(ch)];
      if (/[A-Za-z]/.test(ch)) return ch.toUpperCase();
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

// Ubah angka biasa (misal nomor loket) jadi ejaan per digit untuk diucapkan
function ejaAngka(n) {
  return String(n)
    .split("")
    .map((ch) => (/\d/.test(ch) ? ANGKA_ID[Number(ch)] : ch))
    .join(" ");
}

// Cari suara text-to-speech Bahasa Indonesia dari daftar suara yang tersedia di browser/OS
function suaraIndonesia() {
  const voices = window.speechSynthesis.getVoices() || [];
  return (
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("id")) ||
    voices.find((v) => /indonesia/i.test(v.name)) ||
    null
  );
}

// Ucapkan panggilan nomor antrian lewat text-to-speech, menunggu suara siap dimuat dulu
function speakTicket(ticket, loketNumber) {
  if (!ticket || !window.speechSynthesis) return;
  const prioritas = ticket.isPriority ? "prioritas " : "";
  const text = `Nomor antrian ${prioritas}${ejaKode(ticket.code)}. Silakan menuju loket ${ejaAngka(loketNumber)}.`;

  // Fungsi internal: benar-benar mengucapkan teksnya pakai voice yang dipilih
  const ucapkan = (voice) => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "id-ID";
    utter.rate = window.__ttsRate || 0.88;
    utter.pitch = 1;
    if (voice) utter.voice = voice;
    window.speechSynthesis.speak(utter);
  };

  // Fungsi internal: coba berulang kali sampai daftar suara browser siap, baru bicara
  const cobaBicara = (percobaanTersisa) => {
   const voices = window.speechSynthesis.getVoices() || [];
   if (voices.length > 0) {
     const preferredName = window.__ttsVoiceName;
     const pilihan = (preferredName && voices.find((v) => v.name === preferredName)) || suaraIndonesia();
     ucapkan(pilihan);
     return;
   }
   if (percobaanTersisa <= 0) { ucapkan(null); return; }
   setTimeout(() => cobaBicara(percobaanTersisa - 1), 150);
  };
  cobaBicara(10); // tunggu sampai 1.5 detik suara siap
}

// Sambungkan ke server lewat Socket.io, terima update antrian real-time, dan bicara kalau halaman ini ditunjuk sebagai sumber suara
function connectSocket(onUpdate, { page = null } = {}) {
  const socket = io();
  let currentVoiceSource = null;
  socket.on("queue:update", (state) => {
    if (state.voiceSource) currentVoiceSource = state.voiceSource;
    onUpdate(state);
  });
  socket.on("ticket:called", (payload) => {
    if (page && page === currentVoiceSource && payload.voiceEnabled) {
      speakTicket(payload.ticket, payload.loketNumber);
    }
    if (typeof window.onTicketCalled === "function") window.onTicketCalled(payload);
  });
  return socket;
}

// Pastikan ada user yang login dan rolenya sesuai, kalau tidak lempar ke halaman login
async function requireUser(roles) {
  try {
    const { user } = await api("/api/auth/me");
    if (roles && !roles.includes(user.role)) {
      window.location.href = "/login.html";
      return null;
    }
    return user;
  } catch {
    window.location.href = "/login.html";
    return null;
  }
}

// Logout: hapus sesi login di server, lalu lempar ke halaman login
async function logout() {
  await api("/api/auth/logout", { method: "POST", body: {} });
  window.location.href = "/login.html";
}

// Tampilkan jam digital yang update tiap detik di elemen dengan id tertentu
function startClock(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString("id-ID", { hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}

// Daftar pilihan status pelayanan (dipakai Admin untuk memilih & Display untuk menampilkan)
// Mau tambah status baru? Cukup tambah 1 baris di sini. "warna": hijau, kuning, biru, merah, atau abu
const STATUS_PELAYANAN = [
  { kode: "melayani", label: "MELAYANI", warna: "hijau" },
  { kode: "istirahat", label: "ISTIRAHAT", warna: "kuning" },
  { kode: "rapat", label: "RAPAT", warna: "biru" },
  { kode: "tutup", label: "TUTUP SEMENTARA", warna: "abu" },
  { kode: "gangguan", label: "GANGGUAN SISTEM", warna: "merah" }
];
