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

// Cek apakah sebuah suara berbahasa Indonesia (dari kode bahasa atau namanya)
function suaraIndo(v) {
  return (v.lang && v.lang.toLowerCase().replace("_", "-").startsWith("id")) || /indonesia/i.test(v.name);
}

// Cari suara Bahasa Indonesia yang terpasang di komputer ini (offline). Suara online (localService = false) tidak dipakai
function suaraIndonesia() {
  const voices = window.speechSynthesis.getVoices() || [];
  return voices.find((v) => v.localService && suaraIndo(v)) || null;
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
      // Hanya suara offline yang dipakai: pilihan Admin kalau ada di komputer ini, kalau tidak suara Indonesia offline apa pun
      const preferredName = window.__ttsVoiceName;
      const pilihan = (preferredName && voices.find((v) => v.name === preferredName && v.localService)) || suaraIndonesia();
      if (!pilihan) {
        toast("Suara Indonesia offline belum terpasang di komputer ini");
        return;
      }
      ucapkan(pilihan);
      return;
    }
    if (percobaanTersisa <= 0) {
      toast("Daftar suara tidak tersedia di komputer ini");
      return;
    }
    setTimeout(() => cobaBicara(percobaanTersisa - 1), 150);
  };
  cobaBicara(10);
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

// =========================================================================
// MODAL GANTI PASSWORD MANDIRI (BISA DIPAKAI DI ADMIN MAUPUN LOKET)
// =========================================================================
function bukaModalGantiPassword() {
  let modal = document.getElementById("modal-ganti-password");
  
  // Jika elemen modal belum ada di halaman, buat otomatis
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-ganti-password";
    modal.className = "fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4";
    modal.innerHTML = `
      <div class="bg-white rounded-xl max-w-md w-full p-6 sleek-shadow text-on-surface">
        <div class="flex justify-between items-center mb-4 border-b pb-2">
          <h3 class="text-lg font-bold text-primary flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">lock_reset</span> Ganti Password Akun
          </h3>
          <button id="btn-tutup-modal-pwd" class="text-on-surface-variant hover:text-error text-xl font-bold">&times;</button>
        </div>
        <form id="form-ganti-password" class="space-y-3">
          <div>
            <label class="block text-xs font-semibold mb-1">Password Saat Ini</label>
            <input type="password" id="pwd-current" class="w-full rounded-lg bg-[#edf2f7] border px-3 py-2 text-sm outline-none focus:border-[#00A4E4]" placeholder="Masukkan password lama" required autocomplete="current-password" />
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1">Password Baru (Min. 6 Karakter)</label>
            <input type="password" id="pwd-new" minlength="6" class="w-full rounded-lg bg-[#edf2f7] border px-3 py-2 text-sm outline-none focus:border-[#00A4E4]" placeholder="Minimal 6 karakter" required autocomplete="new-password" />
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1">Konfirmasi Password Baru</label>
            <input type="password" id="pwd-confirm" minlength="6" class="w-full rounded-lg bg-[#edf2f7] border px-3 py-2 text-sm outline-none focus:border-[#00A4E4]" placeholder="Ulangi password baru" required autocomplete="new-password" />
          </div>
          <p id="pwd-error" class="hidden text-error text-xs font-semibold"></p>
          <div class="flex gap-2 pt-2">
            <button type="button" id="btn-batal-modal-pwd" class="flex-1 border border-outline-variant py-2 rounded-lg text-sm font-semibold hover:bg-surface-container">Batal</button>
            <button type="submit" id="btn-simpan-modal-pwd" class="flex-1 bg-primary text-white py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition">Simpan</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    // Event listener untuk tombol tutup / batal
    const tutup = () => modal.classList.add("hidden");
    document.getElementById("btn-tutup-modal-pwd").onclick = tutup;
    document.getElementById("btn-batal-modal-pwd").onclick = tutup;

    // Event listener kirim form ganti password
    document.getElementById("form-ganti-password").onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("pwd-error");
      const btnSimpan = document.getElementById("btn-simpan-modal-pwd");
      errEl.classList.add("hidden");

      const currentPassword = document.getElementById("pwd-current").value;
      const newPassword = document.getElementById("pwd-new").value;
      const confirmPassword = document.getElementById("pwd-confirm").value;

      if (newPassword !== confirmPassword) {
        errEl.textContent = "Konfirmasi password baru tidak cocok!";
        errEl.classList.remove("hidden");
        return;
      }

      btnSimpan.disabled = true;
      btnSimpan.textContent = "Menyimpan...";

      try {
        await api("/api/auth/password", {
          method: "PUT",
          body: { currentPassword, newPassword, confirmPassword }
        });
        toast("Password berhasil diubah!");
        document.getElementById("form-ganti-password").reset();
        tutup();
      } catch (err) {
        errEl.textContent = err.message || "Gagal mengubah password";
        errEl.classList.remove("hidden");
      } finally {
        btnSimpan.disabled = false;
        btnSimpan.textContent = "Simpan";
      }
    };
  }

  // Tampilkan modal dan reset form
  document.getElementById("form-ganti-password").reset();
  document.getElementById("pwd-error").classList.add("hidden");
  modal.classList.remove("hidden");
}
