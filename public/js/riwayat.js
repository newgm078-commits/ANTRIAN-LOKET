// Halaman Riwayat Harian: daftar tiket selesai/dilewati pada satu tanggal.
// Memakai fungsi bersama dari app.js: api, toast, statusChip, formatTime, requireUser, startClock, logout.

// Tanggal hari ini dalam format YYYY-MM-DD (pakai jam komputer ini)
function hariIniISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Geser tanggal YYYY-MM-DD sejumlah hari (positif = maju, negatif = mundur)
function geserHari(dayKey, delta) {
  const d = new Date(`${dayKey}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Ubah "2026-10-06" jadi tulisan Indonesia, misal "Selasa, 6 Oktober 2026"
function formatTanggalLengkap(dayKey) {
  return new Date(`${dayKey}T00:00:00`).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

// Ambil loket pilihan admin yang tersimpan dari halaman Kontrol Loket (0 kalau belum ada)
function bacaLoketAdmin() {
  try { return Number(localStorage.getItem("adminLoketNumber")) || 0; } catch (e) { return 0; }
}

// Ubah indikator koneksi di header: hijau "Connected" kalau terhubung ke server, merah "Terputus" kalau putus
function setKoneksi(terhubung) {
  document.getElementById("koneksi-dot").className = `w-2 h-2 rounded-full ${terhubung ? "bg-tertiary-fixed" : "bg-error"}`;
  document.getElementById("koneksi-teks").textContent = terhubung ? "Connected" : "Terputus";
}

// Ambil riwayat untuk tanggal yang dipilih, lalu tampilkan ringkasan dan tabelnya
async function muatRiwayat() {
  const dateEl = document.getElementById("riwayat-date");
  const hariIni = hariIniISO();

  // Kalau kolom tanggal kosong atau berisi tanggal yang belum terjadi, kembali ke hari ini
  if (!dateEl.value || dateEl.value > hariIni) dateEl.value = hariIni;
  const day = dateEl.value;

  // Tombol "Hari berikutnya" dimatikan saat sudah di hari ini (tidak ada riwayat dari masa depan)
  const tombolSesudah = document.getElementById("hari-sesudah");
  const sudahHariIni = day >= hariIni;
  tombolSesudah.disabled = sudahHariIni;
  tombolSesudah.style.opacity = sudahHariIni ? "0.4" : "";
  tombolSesudah.style.cursor = sudahHariIni ? "not-allowed" : "";

  try {
    const data = await api(`/api/antrian/history?day=${encodeURIComponent(day)}`);
    const selesai = data.rows.filter((r) => r.status === "done").length;
    const dilewati = data.rows.filter((r) => r.status === "skipped").length;

    document.getElementById("riwayat-ringkas").textContent =
      `${formatTanggalLengkap(day)} · ${selesai} selesai · ${dilewati} dilewati`;

    document.getElementById("riwayat-body").innerHTML =
      data.rows
        .map(
          (row) => `<tr class="hover:bg-surface-container-low">
            <td class="py-4 px-6 font-bold">${row.code}</td>
            <td class="py-4 px-6">${row.prefix}</td>
            <td class="py-4 px-6">${statusChip(row.status)}${row.isPriority ? ' <span class="chip chip-priority">P</span>' : ""}</td>
            <td class="py-4 px-6">${row.loketNumber || "-"}</td>
            <td class="py-4 px-6 font-tech text-xs">${formatTime(row.finishedAt)}</td>
          </tr>`
        )
        .join("") ||
      `<tr><td class="py-8 px-6 text-on-surface-variant" colspan="5">Belum ada tiket selesai atau dilewati pada tanggal ini. Pilih tanggal lain untuk melihat riwayatnya.</td></tr>`;
  } catch (err) {
    toast(err.message);
  }
}

// Titik mulai halaman: cek login, isi nama & logo instansi, pasang tombol, lalu muat riwayat
(async () => {
  const user = await requireUser(["admin", "loket"]);
  if (!user) return;
  startClock("live-clock");
  
  // Badge loket: sama seperti di halaman Kontrol Loket (admin dianggap Loket 1)
  if (user.role === "admin") { if (!user.loketNumber) user.loketNumber = bacaLoketAdmin() || 1; document.getElementById("nav-admin-dashboard")?.classList.remove("hidden"); }
  document.getElementById("loket-badge").textContent = `LOKET ${user.loketNumber}`;

  // Indikator koneksi: tampil "Connected" seperti di Kontrol Loket, baru berubah merah kalau koneksi benar-benar putus
  const socket = connectSocket(() => {});
  socket.on("connect", () => setKoneksi(true));
  socket.on("disconnect", () => setKoneksi(false));

  // Nama & logo instansi di header (diambil dari Settings, sama seperti halaman lain)
  api("/api/antrian/state")
    .then((state) => {
      const titleEl = document.getElementById("instansi-title");
      if (titleEl && state.instansi) titleEl.textContent = state.instansi;
      const logoEl = document.getElementById("instansi-logo");
      if (logoEl && state.logo) {
        logoEl.src = state.logo;
        logoEl.classList.remove("hidden");
      }
    })
    .catch(() => {});

  // Tanggal awal: dari alamat ?tanggal=YYYY-MM-DD (dipakai tombol "Lihat" di History bulanan), kalau tidak ada pakai hari ini
  const dateEl = document.getElementById("riwayat-date");
  const param = new URLSearchParams(location.search).get("tanggal") || "";
  dateEl.max = hariIniISO();
  dateEl.value = /^\d{4}-\d{2}-\d{2}$/.test(param) && param <= hariIniISO() ? param : hariIniISO();

  // Tombol-tombol navigasi tanggal
  dateEl.addEventListener("change", muatRiwayat);
  document.getElementById("hari-sebelum").addEventListener("click", () => {
    dateEl.value = geserHari(dateEl.value || hariIniISO(), -1);
    muatRiwayat();
  });
  document.getElementById("hari-sesudah").addEventListener("click", () => {
    dateEl.value = geserHari(dateEl.value || hariIniISO(), 1);
    muatRiwayat();
  });
  document.getElementById("hari-ini").addEventListener("click", () => {
    dateEl.value = hariIniISO();
    muatRiwayat();
  });
  document.getElementById("riwayat-reload").addEventListener("click", muatRiwayat);

  muatRiwayat();
})();
