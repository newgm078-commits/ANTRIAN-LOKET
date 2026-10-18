// Simpan data terakhir supaya tampilan bisa digambar ulang saat ukuran layar berubah
let lastState = null;

// Isi kalender di header (bulan, tanggal, nama hari) sesuai tanggal komputer ini
function renderKalender() {
  const now = new Date();
  document.getElementById("cal-month").textContent = now
    .toLocaleDateString("id-ID", { month: "short" })
    .toUpperCase();
  document.getElementById("cal-day").textContent = now.getDate();
  document.getElementById("cal-weekday").textContent = now.toLocaleDateString("id-ID", { weekday: "long" });
  document.getElementById("cal-full").textContent = now.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

// Atur jumlah kolom & tinggi baris daftar loket supaya semuanya muat tanpa scroll
function ukurDaftarLoket(jumlah) {
  const kolom = jumlah <= 6 ? 1 : jumlah <= 16 ? 2 : 3;
  const baris = Math.max(1, Math.ceil(jumlah / kolom));
  const gap = 8;
  const area = document.getElementById("disp-main");
  const listEl = document.getElementById("loket-list");
  // Tinggi area isi = tinggi main dikurangi padding (48px) dan jarak antar baris grid (16px)
  const tinggiArea = area.clientHeight - 48 - 16;
  // Baris atas maksimal ±62% tinggi area, dikurangi ruang judul & padding panel (±64px)
  const tinggiMaks = tinggiArea * 0.62 - 64;
  const tinggiBaris = Math.max(44, Math.min(96, Math.floor((tinggiMaks - gap * (baris - 1)) / baris)));
  listEl.style.gridTemplateColumns = `repeat(${kolom}, minmax(0, 1fr))`;
  listEl.style.gridTemplateRows = `repeat(${baris}, ${tinggiBaris}px)`;
  listEl.style.setProperty("--row-h", `${tinggiBaris}px`);
}

// Gambar ulang seluruh tampilan display dari data antrian terbaru
function render(state) {
  lastState = state;

  const instansiEl = document.getElementById("instansi-title");
  if (instansiEl && state.instansi) instansiEl.textContent = state.instansi;
  window.__ttsVoiceName = state.ttsVoice;
  window.__ttsRate = state.ttsRate;

  const logoEl = document.getElementById("instansi-logo");
  if (logoEl && state.logo) {
    logoEl.src = state.logo;
    logoEl.classList.remove("hidden");
  }

  // Nomor besar: nomor yang terakhir dipanggil
  const last = state.lastCalled;
  document.getElementById("now-code").textContent = last ? last.code : "—";
  document.getElementById("now-loket").textContent = last
    ? `${state.lokets.find((l) => l.number === last.loketNumber)?.name || "Loket " + last.loketNumber}`
    : "Menunggu panggilan";

  // Petakan tiket yang sedang dipanggil/dilayani berdasarkan nomor loketnya
  const serving = {};
  for (const t of state.serving || []) serving[t.loketNumber] = t;

  // Daftar loket (list ringkas, 1 baris per loket)
  const lokets = state.lokets || [];
  ukurDaftarLoket(lokets.length);
  document.getElementById("loket-list").innerHTML = lokets
    .map((loket) => {
      const ticket = serving[loket.number];
      return `
        <div class="disp-row ${ticket ? "is-active" : ""}">
          <span class="disp-row-name">${loket.name}</span>
          <span class="disp-row-right">
            <span class="disp-row-code ${ticket ? "" : "is-empty"}">${ticket ? ticket.code : "—"}</span>
            <span class="disp-row-status">${ticket ? (ticket.status === "serving" ? "Dilayani" : "Dipanggil") : "Siaga"}</span>
          </span>
        </div>`;
    })
    .join("");

  // Status pelayanan (diatur admin): label berwarna + keterangan
  const status = STATUS_PELAYANAN.find((s) => s.kode === state.serviceStatus) || STATUS_PELAYANAN[0];
  const badgeEl = document.getElementById("service-status");
  badgeEl.textContent = status.label;
  badgeEl.className = `disp-status-badge is-${status.warna}`;
  document.getElementById("service-note").textContent = state.serviceNote || "";

  // Panel ringkasan: jumlah menunggu & nomor berikutnya per jalur
  const menunggu = (state.tickets || []).filter((t) => t.status === "waiting");
  const jalur = (state.prefixes || []).filter(
    (p) => p.active !== false || menunggu.some((t) => t.prefix === p.code)
  );
  document.getElementById("waiting-summary").innerHTML = jalur.length
    ? jalur
        .map((p) => {
          const antri = menunggu.filter((t) => t.prefix === p.code);
          const berikutnya = antri[0];
          return `
            <div class="disp-wait-card">
              <div class="disp-wait-head">
                <span class="disp-wait-code">${p.code}</span>
                <span class="disp-wait-label">${p.label}</span>
              </div>
              <div class="disp-wait-count">${antri.length}<small>menunggu</small></div>
              <div class="disp-wait-next">Berikutnya: <b>${berikutnya ? berikutnya.code : "—"}</b></div>
            </div>`;
        })
        .join("")
    : `<p class="disp-wait-next">Belum ada jalur aktif</p>`;
}

// Saat ada panggilan baru, langsung perbarui nomor besar
window.onTicketCalled = (payload) => {
  document.getElementById("now-code").textContent = payload.ticket.code;
  document.getElementById("now-loket").textContent = `Loket ${payload.loketNumber}`;
};

// Gambar ulang kalau ukuran jendela berubah (misal masuk/keluar fullscreen)
window.addEventListener("resize", () => {
  if (lastState) render(lastState);
});

// Titik mulai: jalankan jam & kalender, ambil data awal, lalu dengarkan update real-time
(async () => {
  startClock("live-clock");
  renderKalender();
  setInterval(renderKalender, 60000);
  render(await api("/api/antrian/state"));
  connectSocket(render, { page: "display" });
})();