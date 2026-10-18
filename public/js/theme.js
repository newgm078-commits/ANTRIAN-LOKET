// tailwind.config - Tema warna & ukuran: konfigurasi kustom Tailwind (palet warna, radius sudut, spacing)
tailwind.config = {
  theme: {
    extend: {
      // colors: palet warna gaya Material (primary biru, secondary cyan, tertiary hijau, error merah, surface abu muda)
      colors: {
        background: "#f6f9fe",
        surface: "#f6f9fe",
        primary: "#00355f",
        "primary-container": "#0f4c81",
        "on-primary": "#ffffff",
        "on-primary-container": "#8ebdf9",
        secondary: "#00658e",
        "secondary-container": "#41beff",
        "on-secondary": "#ffffff",
        "on-secondary-container": "#004a6a",
        tertiary: "#003c27",
        "tertiary-container": "#13543b",
        "on-tertiary": "#ffffff",
        "on-tertiary-container": "#88c7a6",
        error: "#ba1a1a",
        "on-error": "#ffffff",
        "error-container": "#ffdad6",
        "on-error-container": "#93000a",
        "on-surface": "#181c20",
        "on-surface-variant": "#42474f",
        "on-background": "#181c20",
        outline: "#727780",
        "outline-variant": "#c2c7d1",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f1f4f9",
        "surface-container": "#ebeef3",
        "surface-container-high": "#e5e8ed",
        "surface-container-highest": "#dfe3e8",
        "primary-fixed": "#d2e4ff",
        "secondary-fixed": "#c7e7ff",
        "tertiary-fixed": "#b1f0ce",
        "inverse-primary": "#a0c9ff"
      },
      // borderRadius: ukuran lengkung sudut (kecil, lg, xl, full)
      borderRadius: { DEFAULT: "0.25rem", lg: "0.5rem", xl: "0.75rem", full: "9999px" },
      // spacing: jarak kustom untuk container, gutter, dan jarak antar kartu
      spacing: {
        "container-desktop": "40px",
        "container-mobile": "16px",
        gutter: "24px",
        "card-gap": "20px"
      }
    }
  }
};