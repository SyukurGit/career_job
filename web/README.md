# `career -job` Web UI (`web/`)

Antarmuka web lokal berbasis Next.js App Router (**Mode Malam sebagai default**) untuk mengelola katalog lowongan kerja, pelacakan lamaran, pemindaian multi-portal, penyuntingan CV & profil, serta evaluasi AI melalui OMP CLI (`omp`).

Server membaca dan menulis langsung ke berkas lokal di direktori induk (`cv.md`, `config/profile.yml`, `portals.yml`, `data/`, `reports/`, `output/`).

## Menjalankan Aplikasi Web

Memerlukan Node.js `^22.13.0 || >=23.4.0`.

```bash
cd web
npm ci
npm run build
npm start -- -p 3000
```

Atau jalankan mode development saat mengubah kode antarmuka:

```bash
npm run dev
```

Secara bawaan server hanya mendengarkan di IPv4 loopback (`http://127.0.0.1:3000` / `http://localhost:3000`).

## Rute & Halaman Utama

- `/loker` — Katalog lowongan aktif, filter fokus wilayah (`Banda Aceh & Aceh Besar`, `Remote Indonesia`, `Remote Global`), chip timestamp `Diposting:` / `Di-scan:` (WIB), dan triase multi-select.
- `/loker/[id]` — Detail lowongan, analisis AI OMP, catatan & draf surat lamaran persisten, **Outreach Pack** (`Email`, `WhatsApp`, `LinkedIn DM`), serta generator Cover PDF & CV PDF.
- `/loker/tersimpan` — Pelacak lamaran tersimpan (`saved-jobs.json` & tracker) beserta penanda `Perlu follow-up`.
- `/scanner` — Menjalankan `scan.mjs` dari browser, melihat log streaming, receipt scan, dan pengaturan jadwal Windows Task Scheduler (`scripts/register-scan-task.ps1`).
- `/portals` — Mengelola daftar perusahaan/portal di `portals.yml` (aktifkan/nonaktifkan, tambah perusahaan baru, cek kesehatan).
- `/ai-tester` — Uji diagnostik konektivitas & model aktif OMP (`omp`).
- `/cv` — Editor live `cv.md` beserta impor/konversi PDF, TeX, atau Markdown.
- `/config` — Editor `config/profile.yml`, ringkasan kebijakan lokasi, preferensi UI, dan galeri template.

## Keamanan Lokal

- **Loopback-only by default**: Server bind ke `127.0.0.1` dan seluruh rute dijaga oleh `src/lib/origin-guard.mjs`.
- **Variabel lingkungan opsional**:
  - `CAREER_OPS_ROOT` — Arahkan ke direktori data lain (berguna saat pengujian terisolasi).
  - `CAREER_OPS_WEB_ALLOWED_HOSTS` — Izinkan host non-loopback secara eksplisit bila dijalankan di LAN tepercaya.
  - `CAREER_OPS_ALLOWED_ORIGINS` — Allowlist origin tambahan bila dibutuhkan klien lokal tepercaya.

## Pengembangan & Pengujian

```bash
npm run typecheck       # Cek tipe TypeScript (tsc --noEmit)
npm run test:quick      # Uji cepat unit test inti
npm test                # Seluruh unit test di web/tests/**/*.test.mjs
npm run build           # Production build Next.js
npm run test:browser    # End-to-end Playwright browser suites (wajib setelah build)
```

### Konvensi Test (`web/tests/`)

- Logika yang dapat diuji dipisahkan ke modul `.mjs` murni agar bisa dijalankan langsung oleh `node --test` tanpa bundler.
- Suite browser (`tests/lib/*.browser.test.mjs`) membutuhkan server produksi hasil `npm run build`; gunakan `npm run test:browser` (`tests/browser-suites.mjs`) yang secara otomatis menyalakan server terisolasi dengan data uji sementara.
