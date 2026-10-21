// user: data petugas yang sedang login
let user = null;
// state: data antrian terbaru dari server
let state = { tickets: [], prefixes: [], serving: [] };

// myTickets() - Tiket loket saya: tiket yang sedang dipanggil/dilayani di loket ini
function myTickets() {
  return (state.serving || []).filter((t) => t.loketNumber === user.loketNumber);
}

// activeForPrefix() - Tiket aktif per jalur: tiket loket ini yang sedang aktif di jalur tertentu
function activeForPrefix(prefix) {
  return myTickets().find((t) => t.prefix === prefix) || null;
}

// waitingForPrefix() - Antrian menunggu per jalur: tiket waiting/skipped di jalur tertentu
function waitingForPrefix(prefix) {
  return (state.tickets || []).filter(
    (t) => t.prefix === prefix && (t.status === "waiting" || t.status === "skipped")
  );
}

// renderQueueFilter() - Dropdown filter jalur: isi pilihan "Semua" + tiap jalur, pertahankan pilihan sebelumnya
function renderQueueFilter() {
  const select = document.getElementById("queue-filter-prefix");
  if (!select) return;
  const current = select.value;
  const prefixes = state.prefixes || [];
  select.innerHTML =
    `<option value="">Semua</option>` +
    prefixes.map((p) => `<option value="${p.code}">Jalur ${p.code}</option>`).join("");
  select.value = current;
}

// renderQueue() - Daftar antrian: tampilkan tiket (sesuai filter) beserta ikon & status, dan jumlah yang antri
function renderQueue() {
  const filterPrefix = document.getElementById("queue-filter-prefix")?.value || "";
  const list = (state.tickets || [])
    .filter((t) => ["waiting", "called", "serving", "skipped"].includes(t.status))
    .filter((t) => !filterPrefix || t.prefix === filterPrefix);
  document.getElementById("queue-count").textContent = `${list.filter((t) => t.status === "waiting").length} antri`;
  document.getElementById("queue-list").innerHTML = list
    .map((t) => {
      const serving = t.status === "called" || t.status === "serving";
      const icon = t.status === "skipped" ? "redo" : serving ? "person" : "pending";
      const label =
        t.status === "serving" ? "Sedang Dilayani" :
        t.status === "called" ? "Dipanggil" :
        t.status === "skipped" ? "(S)" : "Menunggu";
      return `<div class="flex justify-between items-center p-2.5 rounded-md border ${
        t.status === "skipped" ? "bg-error-container/10 border-error/20" :
        serving ? "bg-tertiary/10 border-tertiary-container/30" : "bg-white border-outline-variant"
      }">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-sm">${icon}</span>
          <span class="font-tech font-bold text-primary">${t.code}${t.isPriority ? " ★" : ""}</span>
        </div>
        <span class="text-xs">${label}</span>
      </div>`;
    })
    .join("");
}

// renderLanes() - Panel kontrol jalur: kartu tiap jalur berisi status tiket aktif, pilih nomor, dan tombol aksi
function renderLanes() {
  const prefixes = state.prefixes || [];
  document.getElementById("lane-grid").innerHTML = prefixes
    .map((p) => {
      const current = activeForPrefix(p.code);
      const waiting = waitingForPrefix(p.code);
      const empty = !current && waiting.length === 0;
      // statusBlock: blok status (tiket aktif / tidak ada antrian / belum aktif)
      const statusBlock = current
        ? `<div class="lane-status is-active" title="Tiket sedang dilayani">
             <span class="code">${current.code}</span>
             ${statusChip(current.status)}
           </div>`
        : empty
          ? `<div class="lane-status"><span class="hint">Tidak ada antrian</span></div>`
          : `<div class="lane-status"><span class="hint">Belum aktif</span></div>`;
      return `
        <article class="lane-card bg-surface-container-lowest rounded-xl border border-outline-variant p-3 md:p-4 relative flex flex-col ${empty ? "opacity-85" : ""}">
          <div class="accent-bar ${current ? "bg-tertiary" : empty ? "bg-outline-variant" : "bg-secondary-container"}"></div>
          <div class="lane-head">
            <div class="min-w-0">
              <h2 class="font-bold text-primary leading-tight">Kontrol Loket ${p.code}</h2>
              <p class="text-xs text-on-surface-variant">${p.label}</p>
            </div>
            ${statusBlock}
          </div>
          <select data-pick="${p.code}" class="mb-3 bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm min-w-0 w-full shrink-0">
            <option value="">Pilih nomor — atau panggil berikutnya</option>
            ${waiting.map((t) => `<option value="${t.id}">${t.code}${t.isPriority ? " (P)" : ""}${t.status === "skipped" ? " (S)" : ""}</option>`).join("")}
          </select>
          <div class="lane-actions grid grid-cols-3 gap-2 ${empty && !current ? "opacity-50 pointer-events-none" : ""}">
            <button data-act="panggil" data-prefix="${p.code}" class="bg-secondary-container text-on-secondary-container font-bold rounded-lg">Panggil</button>
            <button data-act="ulang" data-prefix="${p.code}" class="border border-secondary-container text-secondary font-bold rounded-lg">Panggil Ulang</button>
            <button data-act="skip" data-prefix="${p.code}" class="bg-surface-container-highest rounded-lg">Skip</button>
            <button data-act="mulai" data-prefix="${p.code}" class="col-span-2 bg-tertiary text-on-tertiary font-bold rounded-lg">Mulai Layanan</button>
            <button data-act="selesai" data-prefix="${p.code}" class="bg-error text-on-error font-bold rounded-lg">Selesai</button>
          </div>
        </article>`;
    })
    .join("");

  // Pasang event klik: tiap tombol aksi memanggil action() sesuai jenis aksi & jalurnya
  document.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => action(btn.dataset.act, btn.dataset.prefix));
  });
}

// action() - Kirim aksi ke server: panggil / ulang / skip / mulai / selesai untuk jalur tertentu
async function action(act, prefix) {
  try {
    const pick = document.querySelector(`[data-pick="${prefix}"]`);
    const body = { prefix, loketNumber: user.loketNumber };
    if (act === "panggil" && pick && pick.value) body.ticketId = Number(pick.value);
    await api(`/api/antrian/${act}`, { method: "POST", body });
  } catch (err) {
    toast(err.message);
  }
}

// loketSwitchSig: penanda daftar loket yang terakhir dipasang di pilihan "Ganti loket"
let loketSwitchSig = "";

// simpanLoketAdmin() - Ingat loket pilihan admin di browser ini, supaya setelah refresh tidak kembali ke Loket 1
function simpanLoketAdmin() {
  try { localStorage.setItem("adminLoketNumber", String(user.loketNumber)); } catch (e) {}
}

// bacaLoketAdmin() - Ambil loket pilihan admin yang tersimpan (0 kalau belum ada)
function bacaLoketAdmin() {
  try { return Number(localStorage.getItem("adminLoketNumber")) || 0; } catch (e) { return 0; }
}

// renderLoketSwitch() - Khusus admin: isi pilihan loket di samping badge supaya admin bisa bekerja sebagai loket mana pun
function renderLoketSwitch() {
  const select = document.getElementById("loket-switch");
  if (!select || user.role !== "admin") return;
  const lokets = state.lokets || [];
  if (lokets.length === 0) return;

  // Kalau loket yang dipilih sudah tidak ada (misal dihapus), pindah ke loket pertama
  if (!lokets.some((l) => l.number === user.loketNumber)) {
    user.loketNumber = lokets[0].number;
    simpanLoketAdmin();
  }

  // Bangun ulang pilihan hanya kalau daftar loketnya berubah, supaya dropdown yang sedang dibuka tidak tertutup sendiri
  const sig = lokets.map((l) => `${l.number}:${l.name}`).join("|");
  if (sig !== loketSwitchSig) {
    loketSwitchSig = sig;
    select.innerHTML = lokets
      .map((l) => `<option value="${l.number}">${`Loket ${l.number}${l.name && l.name !== `Loket ${l.number}` ? " · " + l.name : ""}`.toUpperCase()}</option>`)
      .join("");
  }
  select.value = String(user.loketNumber);
  select.classList.remove("hidden");
  // Untuk admin, pilihan loket ini menggantikan badge, jadi badge disembunyikan
  document.getElementById("loket-badge").classList.add("hidden");
}

// paint() - Gambar ulang halaman: simpan state baru, update judul & logo, lalu render filter, antrian, dan jalur
function paint(next) {
  state = next;
  const instansiEl = document.getElementById("instansi-title");
  if (instansiEl && state.instansi) instansiEl.textContent = state.instansi;
  const logoEl = document.getElementById("instansi-logo");
  if (logoEl && state.logo) {
    logoEl.src = state.logo;
    logoEl.classList.remove("hidden");
  }
  renderLoketSwitch();
  renderQueueFilter();
  renderQueue();
  renderLanes();
}

// Inisialisasi: cek login (loket/admin), tampilkan badge loket, jam, muat data awal, sambungkan socket
(async () => {
  user = await requireUser(["loket", "admin"]);
  if (!user) return;
  if (user.role === "admin" && !user.loketNumber) user.loketNumber = bacaLoketAdmin() || 1;
  document.getElementById("loket-badge").textContent = `LOKET ${user.loketNumber}`;
  // Admin memakai pilihan loket (bukan badge), jadi badge disembunyikan sejak awal
  if (user.role === "admin") { document.getElementById("loket-badge").classList.add("hidden"); document.getElementById("nav-admin-dashboard")?.classList.remove("hidden"); }
  startClock("live-clock");
  document.getElementById("queue-filter-prefix")?.addEventListener("change", renderQueue);
  // Admin memilih loket lain: pindah posisi, ubah badge, lalu gambar ulang kontrol jalur
  document.getElementById("loket-switch")?.addEventListener("change", (e) => {
    user.loketNumber = Number(e.target.value);
    simpanLoketAdmin();
    renderLanes();
  });
  paint(await api("/api/antrian/state"));
  connectSocket(paint, { page: "loket" });
})();