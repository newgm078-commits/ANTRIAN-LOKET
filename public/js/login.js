// Muat info halaman login: ambil data instansi dari server (judul, tagline, logo, badge jalur & loket)
api("/api/antrian/state").then((state) => {
  // Judul instansi
  const titleEl = document.getElementById("instansi-title");
  if (titleEl && state.instansi) titleEl.textContent = state.instansi;
  // Tagline instansi
  const taglineEl = document.getElementById("instansi-tagline");
  if (taglineEl && state.tagline) taglineEl.textContent = state.tagline;
  // Logo instansi
  const logoEl = document.getElementById("instansi-logo");
  if (logoEl && state.logo) {
    logoEl.src = state.logo;
    logoEl.classList.remove("hidden");
  }

  // Badge jalur: tampilkan kode jalur aktif, mis. "A · B · C"
  const jalurEl = document.getElementById("badge-jalur");
  if (jalurEl) {
    const codes = (state.prefixes || []).filter((p) => p.active !== false).map((p) => p.code);
    jalurEl.textContent = codes.length ? codes.join(" · ") : "-";
  }

  // Badge loket: tampilkan rentang nomor loket, mis. "1–4"
  const loketEl = document.getElementById("badge-loket");
  if (loketEl) {
    const numbers = (state.lokets || []).map((l) => l.number).sort((a, b) => a - b);
    if (numbers.length === 0) {
      loketEl.textContent = "-";
    } else if (numbers.length === 1) {
      loketEl.textContent = String(numbers[0]);
    } else {
      loketEl.textContent = `${numbers[0]}–${numbers[numbers.length - 1]}`;
    }
  }
}).catch(() => {});

// Submit form login: kirim username & password, lalu arahkan sesuai role (admin / loket / pengambil nomor)
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  // error: elemen pesan error, disembunyikan dulu sebelum request
  const error = document.getElementById("login-error");
  error.classList.add("hidden");
  try {
    const { user } = await api("/api/auth/login", {
      method: "POST",
      body: {
        username: form.username.value,
        password: form.password.value
      }
    });
    if (user.role === "admin") window.location.href = "/admin.html";
    else if (user.role === "loket") window.location.href = "/loket.html";
    else window.location.href = "/queue-taker.html";
  } catch (err) {
    // Login gagal: tampilkan pesan error dari server
    error.textContent = err.message;
    error.classList.remove("hidden");
  }
});