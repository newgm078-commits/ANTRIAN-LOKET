// prefixes: daftar jalur layanan terbaru dari server
let prefixes = [];

// renderLanes() - Tampilkan tombol jalur: kartu tiap jalur layanan (nonaktif jika jalur ditutup) + pasang klik ambil nomor
function renderLanes(state) {
  // Judul & logo instansi
  const instansiEl = document.getElementById("instansi-title");
  if (instansiEl && state.instansi) instansiEl.textContent = state.instansi;
  const logoEl = document.getElementById("instansi-logo");
  if (logoEl && state.logo) {
    logoEl.src = state.logo;
    logoEl.classList.remove("hidden");
  }
  prefixes = state.prefixes || [];
  // root: wadah semua tombol jalur
  const root = document.getElementById("lanes");
  root.innerHTML = prefixes
    .map((p) => {
      const nonaktif = p.active === false;
      return `
      <button data-prefix="${p.code}" ${nonaktif ? "disabled" : ""} class="text-left rounded-xl p-8 sleek-shadow relative overflow-hidden ${
        nonaktif
          ? "bg-surface-container border border-outline-variant opacity-50 cursor-not-allowed"
          : "bg-surface-container-lowest border border-outline-variant hover-lift"
      }">
        <div class="accent-bar ${nonaktif ? "bg-outline-variant" : "bg-primary"}"></div>
        <p class="font-tech text-sm ${nonaktif ? "text-outline" : "text-secondary"}">JALUR ${p.code}</p>
        <h3 class="text-4xl font-extrabold mt-2 ${nonaktif ? "text-outline" : "text-primary"}">${p.label}</h3>
        <p class="text-on-surface-variant mt-2">${nonaktif ? "Sedang tidak melayani" : p.description || ""}</p>
        <span class="material-symbols-outlined mt-6 ${nonaktif ? "text-outline" : "text-primary"}">${nonaktif ? "block" : "confirmation_number"}</span>
      </button>`;
    })
    .join("");

  // Pasang event klik: tombol jalur yang aktif memanggil ambil()
  root.querySelectorAll("button:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => ambil(btn.dataset.prefix));
  });
}

// ambil() - Ambil nomor antrian: minta tiket baru ke server, isi tampilan tiket & struk cetak, lalu buka modal
async function ambil(prefix) {
  try {
    // priority: true jika kotak "prioritas" dicentang
    const priority = document.getElementById("priority").checked;
    const data = await api("/api/antrian/ambil", { method: "POST", body: { prefix, priority } });
    document.getElementById("ticket-code").textContent = data.ticket.code;
    document.getElementById("ticket-meta").textContent = `${priority ? "PRIORITAS · " : ""}Jalur ${data.ticket.prefix}`;
    document.getElementById("print-code").textContent = data.ticket.code;
    document.getElementById("print-meta").textContent = `${priority ? "PRIORITAS · " : ""}Jalur ${data.ticket.prefix}`;
    document.getElementById("print-footer").textContent = data.footer || "";
    document.getElementById("print-instansi").textContent = data.instansi || "";
    if (data.logo) {
      const logoEl = document.getElementById("print-logo");
      logoEl.src = data.logo;
      logoEl.classList.remove("hidden");
    }
    document.getElementById("ticket-modal").classList.remove("hidden");
  } catch (err) {
    toast(err.message);
  }
}

// Inisialisasi: cek login (pengambil nomor/admin), jalankan jam, muat jalur, sambungkan socket
(async () => {
  const user = await requireUser(["queue_taker", "admin"]);
  if (!user) return;
  startClock("live-clock");
  const state = await api("/api/antrian/state");
  renderLanes(state);
  connectSocket((next) => renderLanes(next));
})();