// Variabel global: siapa yang login, halaman pagination berapa, dan data antrian terkini
let user = null;
let page = 1;
let state = { stats: {}, serving: [] };

// Tampilkan section sesuai hash URL, sembunyikan yang lain (History & Riwayat memakai satu halaman arsip)
function showView() {
  const hash = (location.hash || "#dashboard").replace("#", "");
  const view = hash === "history" || hash === "riwayat" ? "arsip" : hash;
  ["dashboard", "list", "arsip", "settings"].forEach((name) => {
    document.getElementById(`view-${name}`).classList.toggle("hidden", name !== view);
  });
  if (hash === "list") loadList();
  if (hash === "riwayat") bukaArsip("harian");
  if (hash === "history") bukaArsip("bulanan");
  if (hash === "settings" && user.role === "admin") { loadSettings(); loadPrefixSettings(); }
}

// Render 5 kartu statistik di Dashboard (Total, Menunggu, Dilayani, Selesai, Dilewati)
function renderStats(s) {
  const stats = s.stats || {};
  const cards = [
    ["Total Antrian", stats.total || 0, "group", "bg-primary"],
    ["Menunggu", stats.waiting || 0, "schedule", "bg-[#F59E0B]"],
    ["Sedang Dilayani", stats.serving || 0, "monitoring", "bg-[#10B981]"],
    ["Selesai", stats.done || 0, "check_circle", "bg-[#3B82F6]"],
    ["Dilewati", stats.skipped || 0, "warning", "bg-error"]
  ];
  document.getElementById("stats-grid").innerHTML = cards
    .map(
      ([label, value, icon, bar]) => `
      <div class="bg-white border border-outline-variant rounded-xl p-6 sleek-shadow hover-lift relative overflow-hidden">
        <div class="accent-bar ${bar}"></div>
        <div class="flex justify-between items-start mb-3">
          <h3 class="text-sm font-semibold text-on-surface-variant">${label}</h3>
          <span class="material-symbols-outlined text-primary">${icon}</span>
        </div>
        <div class="text-5xl font-extrabold">${value}</div>
      </div>`
    )
    .join("");
  document.getElementById("active-loket").textContent = (s.serving || []).length;
}

// Ambil & tampilkan daftar tiket di halaman "Queue Management", sesuai halaman & filter jalur aktif
async function loadList() {
  const prefix = document.getElementById("list-filter-prefix")?.value || "";
  const query = prefix ? `&prefix=${encodeURIComponent(prefix)}` : "";
  const data = await api(`/api/antrian/list?page=${page}&limit=12${query}`);
  document.getElementById("list-body").innerHTML = data.rows
    .map(
      (row) => `<tr class="hover:bg-surface-container-low">
        <td class="py-4 px-6 font-bold">${row.code}</td>
        <td class="py-4 px-6">${row.prefix}</td>
        <td class="py-4 px-6">${statusChip(row.status)}${row.isPriority ? " " + '<span class="chip chip-priority">P</span>' : ""}</td>
        <td class="py-4 px-6 font-tech text-xs">${formatTime(row.createdAt)}</td>
      </tr>`
    )
    .join("");
  document.getElementById("list-meta").textContent = `Showing ${data.rows.length} of ${data.total} entries`;
}

// Isi dropdown filter jalur di halaman List, otomatis mengikuti jalur yang terdaftar di Settings
function renderListFilter() {
  const select = document.getElementById("list-filter-prefix");
  if (!select) return;
  const current = select.value;
  const prefixes = state.prefixes || [];
  select.innerHTML =
    `<option value="">Semua Jalur</option>` +
    prefixes.map((p) => `<option value="${p.code}">Jalur ${p.code} - ${p.label}</option>`).join("");
  select.value = current;
}

// Ambil & tampilkan riwayat tiket yang sudah selesai/dilewati hari ini
async function loadHistory() {
  const data = await api("/api/antrian/history");
  document.getElementById("history-body").innerHTML = data.rows
    .map(
      (row) => `<tr>
        <td class="py-4 px-6 font-bold">${row.code}</td>
        <td class="py-4 px-6">${statusChip(row.status)}</td>
        <td class="py-4 px-6">${row.loketNumber || "-"}</td>
        <td class="py-4 px-6 font-tech text-xs">${formatTime(row.finishedAt)}</td>
      </tr>`
    )
    .join("") || `<tr><td class="py-8 px-6 text-on-surface-variant" colspan="4">Belum ada riwayat hari ini</td></tr>`;
}

// Mode tampilan halaman History yang sedang aktif: "harian" atau "bulanan"
let arsipMode = "harian";

// Tanggal hari ini dalam format YYYY-MM-DD (pakai jam komputer ini)
function hariIniISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Ubah "2026-10-06" jadi tulisan Indonesia, misal "Sel, 6 Okt 2026"
function formatTanggalIndo(dayKey) {
  return new Date(`${dayKey}T00:00:00`).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

// Dipanggil saat halaman History/Riwayat dibuka: isi nilai awal pemilih tanggal/bulan, lalu tampilkan mode yang diminta
function bukaArsip(mode) {
  const dateEl = document.getElementById("arsip-date");
  const monthEl = document.getElementById("arsip-month");
  dateEl.max = hariIniISO();
  monthEl.max = hariIniISO().slice(0, 7);
  if (!dateEl.value) dateEl.value = hariIniISO();
  if (!monthEl.value) monthEl.value = hariIniISO().slice(0, 7);
  setArsipMode(mode);
}

// Tampilkan bagian sesuai mode (harian atau bulanan), atur judul halaman, lalu muat datanya
function setArsipMode(mode) {
  arsipMode = mode;
  document.getElementById("arsip-harian").classList.toggle("hidden", mode !== "harian");
  document.getElementById("arsip-bulanan").classList.toggle("hidden", mode !== "bulanan");
  document.getElementById("arsip-title").textContent = mode === "harian" ? "Riwayat Harian" : "History Bulanan";
  loadArsip();
}

// Ambil & tampilkan data arsip sesuai mode (harian: daftar tiket, bulanan: ringkasan per hari)
async function loadArsip() {
  if (arsipMode === "harian") {
    const day = document.getElementById("arsip-date").value || hariIniISO();
    const data = await api(`/api/antrian/history?day=${encodeURIComponent(day)}`);
    const selesai = data.rows.filter((r) => r.status === "done").length;
    const dilewati = data.rows.filter((r) => r.status === "skipped").length;
    document.getElementById("arsip-harian-ringkas").textContent =
      `${formatTanggalIndo(day)} · Selesai ${selesai} · Dilewati ${dilewati}`;
    document.getElementById("arsip-harian-body").innerHTML =
      data.rows
        .map(
          (row) => `<tr>
            <td class="py-4 px-6 font-bold">${row.code}</td>
            <td class="py-4 px-6">${row.prefix}</td>
            <td class="py-4 px-6">${statusChip(row.status)}</td>
            <td class="py-4 px-6">${row.loketNumber || "-"}</td>
            <td class="py-4 px-6 font-tech text-xs">${formatTime(row.finishedAt)}</td>
          </tr>`
        )
        .join("") ||
      `<tr><td class="py-8 px-6 text-on-surface-variant" colspan="5">Belum ada riwayat pada tanggal ini</td></tr>`;
  } else {
    const month = document.getElementById("arsip-month").value || hariIniISO().slice(0, 7);
    const data = await api(`/api/antrian/arsip/bulan?month=${encodeURIComponent(month)}`);
    const jumlah = (key) => data.rows.reduce((total, r) => total + (r[key] || 0), 0);
    document.getElementById("arsip-bulanan-ringkas").textContent =
      `${data.rows.length} hari ada layanan · Total ${jumlah("total")} · Selesai ${jumlah("done")} · Dilewati ${jumlah("skipped")}`;
    document.getElementById("arsip-bulanan-body").innerHTML =
      data.rows
        .map(
          (r) => `<tr class="hover:bg-surface-container-low">
            <td class="py-4 px-6 font-semibold">${formatTanggalIndo(r.day_key)}</td>
            <td class="py-4 px-6">${r.total}</td>
            <td class="py-4 px-6">${r.done || 0}</td>
            <td class="py-4 px-6">${r.skipped || 0}</td>
            <td class="py-4 px-6">${r.pending || 0}</td>
            <td class="py-4 px-6"><button data-arsip-hari="${r.day_key}" type="button" class="px-3 py-1 border rounded text-sm">Lihat</button></td>
          </tr>`
        )
        .join("") ||
      `<tr><td class="py-8 px-6 text-on-surface-variant" colspan="6">Belum ada data pada bulan ini</td></tr>`;

    // Tombol "Lihat": pindah ke mode Harian untuk tanggal yang dipilih
    document.querySelectorAll("[data-arsip-hari]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("arsip-date").value = btn.dataset.arsipHari;
        location.href = `/riwayat.html?tanggal=${btn.dataset.arsipHari}`;
      });
    });
  }
}

// Ambil semua pengaturan dari server & isi ke form Settings (instansi, logo, suara, loket, dll)
async function loadSettings() {
  const { settings } = await api("/api/admin/settings");
  document.getElementById("set-instansi").value = settings.instansi || "";
  document.getElementById("set-tagline").value = settings.tagline || "";
  document.getElementById("set-footer").value = settings.ticket_footer || "";
  document.getElementById("set-voice").checked = settings.voice_enabled === "1";
  document.getElementById("set-voice-source").value = settings.voice_source || "display";

  // Isi pilihan status pelayanan & nilai yang sedang aktif
  const svcSelect = document.getElementById("svc-status");
  svcSelect.innerHTML = STATUS_PELAYANAN.map((s) => `<option value="${s.kode}">${s.label}</option>`).join("");
  svcSelect.value = settings.service_status || "melayani";
  document.getElementById("svc-note").value = settings.service_note || "";

  // Tampilkan preview logo kalau sudah pernah diunggah sebelumnya
  if (settings.logo) {
    const preview = document.getElementById("logo-preview");
    preview.src = settings.logo;
    preview.classList.remove("hidden");
  }

  // Isi dropdown pilihan suara TTS, nunggu daftar suara browser siap dulu kalau belum
    // Simpan daftar suara lengkap (tidak difilter) supaya bisa dipakai ulang saat pencarian diketik
  let semuaSuara = [];

  const renderOpsiSuara = (kataKunci = "") => {
    const select = document.getElementById("set-voice-name");
    const query = kataKunci.trim().toLowerCase();
    const tersaring = query
      ? semuaSuara.filter(
          (v) => v.name.toLowerCase().includes(query) || v.lang.toLowerCase().includes(query)
        )
      : semuaSuara;

    select.innerHTML = tersaring.length
      ? tersaring.map((v) => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join("")
      : `<option value="">Tidak ada suara yang cocok</option>`;

    // Kalau suara yang sudah tersimpan masih ada di hasil filter, tetap pilih itu
    if (settings.tts_voice && tersaring.some((v) => v.name === settings.tts_voice)) {
      select.value = settings.tts_voice;
    }
  };

  const isiDaftarSuara = () => {
    semuaSuara = window.speechSynthesis.getVoices() || [];
    renderOpsiSuara();
  };
  if (window.speechSynthesis.getVoices().length) {
    isiDaftarSuara();
  } else {
    window.speechSynthesis.addEventListener("voiceschanged", isiDaftarSuara, { once: true });
  }

  // Setiap kali kotak pencarian diketik, langsung saring ulang daftar dropdown-nya
  document.getElementById("voice-search")?.addEventListener("input", (e) => {
    renderOpsiSuara(e.target.value);
  });

  // Isi slider kecepatan bicara & sambungkan label angkanya biar update live saat digeser
  const rateInput = document.getElementById("set-voice-rate");
  const rateLabel = document.getElementById("voice-rate-label");
  rateInput.value = settings.tts_rate || "0.88";
  rateLabel.textContent = rateInput.value;
  rateInput.oninput = () => {
    rateLabel.textContent = rateInput.value;
  };

  // Ambil daftar loket, render tiap baris dengan tombol Simpan & Hapus
  const lokets = await api("/api/loket");
  document.getElementById("loket-names").innerHTML = lokets.lokets
    .map(
      (l) => `<div class="flex gap-2">
        <span class="w-20 py-2">Loket ${l.number}</span>
        <input data-loket="${l.number}" value="${l.name}" class="flex-1 rounded-lg bg-[#edf2f7] border px-3 py-2" />
        <button data-save-loket="${l.number}" class="px-3 rounded-lg bg-primary text-white text-sm">Simpan</button>
        <button data-delete-loket="${l.number}" class="px-3 rounded-lg border border-error text-error text-sm">Hapus</button>
      </div>`
    )
    .join("");
  // Handler tombol "Simpan" per baris loket
  document.querySelectorAll("[data-save-loket]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const number = btn.dataset.saveLoket;
      const name = document.querySelector(`[data-loket="${number}"]`).value;
      await api(`/api/loket/${number}`, { method: "PUT", body: { name, active: true } });
      toast("Nama loket disimpan");
    });
  });
  // Handler tombol "Hapus" per baris loket
  document.querySelectorAll("[data-delete-loket]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const number = btn.dataset.deleteLoket;
      if (!confirm(`Hapus Loket ${number}? Tindakan ini tidak bisa dibatalkan.`)) return;
      try {
        await api(`/api/loket/${number}`, { method: "DELETE" });
        toast("Loket dihapus");
        loadSettings();
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

// Data sementara (draft) daftar jalur antrian yang sedang diedit di form Settings
let prefixDraft = [];

// Render baris-baris form jalur antrian (kode, nama, deskripsi, aktif/nonaktif, tombol hapus)
function renderPrefixRows() {
  document.getElementById("prefix-rows").innerHTML = prefixDraft
    .map(
      (p, i) => `
      <div class="flex flex-wrap gap-2 items-center border border-outline-variant rounded-lg p-3">
        <input data-p="code" data-i="${i}" value="${p.code || ""}" maxlength="2" placeholder="Kode" class="w-16 rounded-lg bg-[#edf2f7] border px-3 py-2 text-center font-tech font-bold uppercase" />
        <input data-p="label" data-i="${i}" value="${p.label || ""}" placeholder="Nama jalur" class="flex-1 min-w-[160px] rounded-lg bg-[#edf2f7] border px-3 py-2" />
        <input data-p="description" data-i="${i}" value="${p.description || ""}" placeholder="Deskripsi" class="flex-[2] min-w-[220px] rounded-lg bg-[#edf2f7] border px-3 py-2" />
        <label class="flex items-center gap-1 text-sm whitespace-nowrap">
          <input type="checkbox" data-p="active" data-i="${i}" ${p.active !== false ? "checked" : ""} /> Aktif
        </label>
        <button data-remove-prefix="${i}" type="button" class="text-error text-sm font-semibold px-2">Hapus</button>
      </div>`
    )
    .join("");

  // Setiap kali input diketik, update data draft-nya secara langsung
  document.querySelectorAll("[data-p]").forEach((el) => {
    el.addEventListener("input", () => {
      const i = Number(el.dataset.i);
      const field = el.dataset.p;
      prefixDraft[i][field] = field === "active" ? el.checked : field === "code" ? el.value.toUpperCase() : el.value;
    });
  });
  // Tombol hapus 1 baris jalur dari draft, lalu render ulang
  document.querySelectorAll("[data-remove-prefix]").forEach((btn) => {
    btn.addEventListener("click", () => {
      prefixDraft.splice(Number(btn.dataset.removePrefix), 1);
      renderPrefixRows();
    });
  });
}

// Ambil daftar jalur dari server, isi ke draft, lalu render form-nya
async function loadPrefixSettings() {
  const { settings } = await api("/api/admin/settings");
  const raw = settings.prefixes;
  prefixDraft = (typeof raw === "string" ? JSON.parse(raw || "[]") : raw || []).map((p) => ({
    code: p.code || "",
    label: p.label || "",
    description: p.description || "",
    active: p.active !== false
  }));
  renderPrefixRows();
}

// Titik mulai halaman: cek login, isi info user, pasang semua event listener tombol
(async () => {
  user = await requireUser(["admin", "loket"]);
  if (!user) return;
  document.getElementById("welcome-name").textContent = user.displayName;
  document.getElementById("welcome-role").textContent = user.role;
  startClock("live-clock");
  document.getElementById("role-label").textContent = user.role === "admin" ? "ADMIN" : `LOKET ${user.loketNumber}`;
  document.getElementById("operator-id").textContent = `ID: ${user.username}`;

  // Kalau bukan admin, sembunyikan menu-menu khusus admin
  if (user.role !== "admin") {
    document.querySelectorAll(".admin-only").forEach((el) => el.classList.add("hidden"));
    document.getElementById("emergency-btn").classList.add("hidden");
    document.getElementById("settings-link").classList.add("hidden");
  }

  // Dipanggil tiap kali ada data antrian terbaru (saat load awal & tiap update real-time)
  const paint = (next) => {
    state = next;
    const instansiEl = document.getElementById("instansi-title");
    if (instansiEl && next.instansi) instansiEl.textContent = next.instansi;
    const logoImg = document.getElementById("instansi-logo");
    const logoFallback = document.getElementById("instansi-logo-fallback");
    if (logoImg && next.logo) {
      logoImg.src = next.logo;
      logoImg.classList.remove("hidden");
      if (logoFallback) logoFallback.classList.add("hidden");
    }
    renderStats(next);
    renderListFilter();
  };
  paint(await api("/api/antrian/state"));
  connectSocket(paint);
  showView();
  window.addEventListener("hashchange", showView);

  // Tombol pilih mode History (Harian/Bulanan) dan pemilih tanggal/bulan
  document.getElementById("arsip-date")?.addEventListener("change", loadArsip);
  document.getElementById("arsip-month")?.addEventListener("change", loadArsip);

  // Handler ganti filter jalur di halaman List: balik ke halaman 1, muat ulang
  document.getElementById("list-filter-prefix")?.addEventListener("change", () => {
    page = 1;
    loadList();
  });
  // Tombol pindah halaman (pagination) di halaman List
  document.getElementById("prev-page").onclick = () => {
    page = Math.max(1, page - 1);
    loadList();
  };
  document.getElementById("next-page").onclick = () => {
    page += 1;
    loadList();
  };

  // Tombol Emergency Stop: nyalakan/matikan penerimaan nomor antrian baru
  document.getElementById("emergency-btn")?.addEventListener("click", async () => {
    const stop = state.takingEnabled !== false;
    await api("/api/admin/emergency", { method: "POST", body: { stop } });
    toast(stop ? "Emergency stop aktif" : "Sistem dilanjutkan");
  });

  // Tombol Simpan di Pengaturan Lanjutan: kirim semua field settingan sekaligus
  document.getElementById("save-settings")?.addEventListener("click", async () => {
    await api("/api/admin/settings", {
      method: "PUT",
      body: {
        instansi: document.getElementById("set-instansi").value,
        tagline: document.getElementById("set-tagline").value,
        ticket_footer: document.getElementById("set-footer").value,
        voice_enabled: document.getElementById("set-voice").checked ? "1" : "0",
        voice_source: document.getElementById("set-voice-source").value,
        tts_voice: document.getElementById("set-voice-name").value,
        tts_rate: document.getElementById("set-voice-rate").value
      }
    });
    toast("Pengaturan disimpan");
  });

  // Tombol Unggah logo: kirim file ke server lewat form-data
  document.getElementById("upload-logo")?.addEventListener("click", async () => {
    const fileInput = document.getElementById("logo-file");
    const file = fileInput.files[0];
    if (!file) {
      toast("Pilih file logo dulu");
      return;
    }
    const formData = new FormData();
    formData.append("logo", file);
    try {
      const res = await fetch("/api/admin/logo", { method: "POST", credentials: "include", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal unggah logo");
      toast("Logo berhasil diunggah");
      fileInput.value = "";
      loadSettings();
    } catch (err) {
      toast(err.message);
    }
  });

    // Tombol "Terapkan" status pelayanan: langsung tampil di layar TV
  document.getElementById("svc-apply")?.addEventListener("click", async () => {
    await api("/api/admin/settings", {
      method: "PUT",
      body: {
        service_status: document.getElementById("svc-status").value,
        service_note: document.getElementById("svc-note").value
      }
    });
    toast("Status pelayanan diterapkan");
  });
  
  // Tombol "Coba": langsung ucapkan contoh kalimat pakai suara & kecepatan yang sedang dipilih
  document.getElementById("test-voice")?.addEventListener("click", () => {
    const name = document.getElementById("set-voice-name").value;
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === name);
    const utter = new SpeechSynthesisUtterance("Nomor antrian A satu dua tiga, silakan menuju loket satu.");
    if (voice) utter.voice = voice;
    utter.lang = "id-ID";
    utter.rate = window.__ttsRate || 0.88;
    window.speechSynthesis.speak(utter);
  });

  // Tombol "+ Tambah Loket": bikin loket & akun login baru, tampilkan username/password-nya
  document.getElementById("add-loket")?.addEventListener("click", async () => {
    const input = document.getElementById("new-loket-name");
    const name = input.value.trim();
    if (!name) {
      toast("Nama loket wajib diisi");
      return;
    }
    const result = await api("/api/loket", { method: "POST", body: { name } });
    input.value = "";
    alert(`Loket baru dibuat!\n\nLogin untuk loket ini:\nUsername: ${result.username}\nPassword: ${result.defaultPassword}\n\nSampaikan ke petugas loket, dan sarankan segera ganti password lewat menu Ganti Password.`);
    loadSettings();
  });

  // Tombol "+ Tambah Jalur": tambah 1 baris kosong baru ke draft jalur
  document.getElementById("add-prefix")?.addEventListener("click", () => {
    prefixDraft.push({ code: "", label: "", description: "", active: true });
    renderPrefixRows();
  });

  // (duplikat dari listener di atas — efeknya nambah 2 baris sekaligus tiap diklik)
  document.getElementById("add-prefix")?.addEventListener("click", () => {
    prefixDraft.push({ code: "", label: "", description: "", active: true });
    renderPrefixRows();
  });

  // Tombol "Simpan Jalur": validasi kode tidak kosong/duplikat, lalu kirim ke server
  document.getElementById("save-prefixes")?.addEventListener("click", async () => {
    const codes = prefixDraft.map((p) => p.code.trim()).filter(Boolean);
    if (codes.length !== prefixDraft.length) {
      toast("Kode jalur tidak boleh kosong");
      return;
    }
    if (new Set(codes).size !== codes.length) {
      toast("Kode jalur tidak boleh sama/duplikat");
      return;
    }
    await api("/api/admin/settings", { method: "PUT", body: { prefixes: prefixDraft } });
    toast("Jalur antrian disimpan");
  });

  // Tombol "Reset Antrian": hapus seluruh tiket hari ini setelah konfirmasi
  document.getElementById("reset-btn")?.addEventListener("click", async () => {
    if (!confirm("Reset seluruh antrian hari ini?")) return;
    await api("/api/admin/reset", { method: "POST", body: {} });
    toast("Antrian direset");
    showView();
  });
})();