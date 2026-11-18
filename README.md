# Seatup

Prototype editor denah venue dan simulasi pemilihan kursi.

## Menjalankan

```sh
npm ci
npm run dev
```

## Verifikasi

```sh
npm test
npm run build
```

## Benchmark performa (10.000+ seat)

Fixture deterministik + benchmark browser production yang dapat dijalankan
ulang, beserta tabel sebelum/sesudah, ada di [`src/bench/`](src/bench/).

```sh
npm run build
npx vite preview --port 4173
# http://localhost:4173/?bench&scenario=20k-rect&mode=editor&auto=1
```

Status bukti (revisi temuan P2 #1–#5, 2026-11-17): `npm run check` 228/228 hijau
(197 sebelumnya + 31 regresi baru); `npm run build` sukses. Matriks production
terbaru di [`src/bench/results/prod-2026-11-17/`](src/bench/results/prod-2026-11-17/)
(Chromium headless, GPU Metal, 1k/10k/20k/50k × rect/complex/elongated/blok-12k
× DPR 1/2 × landscape/portrait, beberapa run): klik editor+preview p95 <100ms
(0 gagal, identitas terverifikasi), marquee akurat 100%, 60 commit spy tepat 60
pada semua kondisi history, drag 1 commit / cancel 0 commit dengan verifikasi
isi, siklus memori tanpa pertumbuhan lanjutan. Pan p95 mengukur 33,4ms di
lingkungan headless on-demand-frame (gagal vs target 20ms); profiling bingkai
tak-terbatas menunjukkan biaya kerja tak berubah idle-vs-beban dan 1k-vs-10k,
yakni artefak kadensi harness, bukan bottleneck aplikasi — target 60fps
dinyatakan BELUM TERBUKTI dan butuh pengukuran vsync headed. 50k = stress test,
lolos fungsional. Lihat [`src/bench/`](src/bench/) untuk prosedur, tabel, dan
status jujur per target/skala.

## Fitur

- Gambar polygon, kotak, lingkaran, panggung, dan lorong.
- Jadikan bentuk sebagai section; edit isi section dengan klik dua kali.
- Buat baris kursi lurus atau melengkung, atur manual atau sesuaikan dengan bentuk.
- Impor SVG dan draf dari raster; simpan lokal atau ekspor/impor JSON.
- Preview pembeli dengan simulasi status dan pemilihan kursi.

Semua pemesanan dan status kursi adalah simulasi lokal. Tidak ada backend reservasi, pembayaran, atau integrasi produksi.

## Deploy ke Cloudflare Pages

- Root directory: `/` (atau kosong)
- Build command: `npm run build`
- Build output directory: `dist`
- Environment: `NODE_VERSION=24`

Fixture tes dibuat secara sintetis. Catatan internal, screenshot, eksperimen terpisah, dan denah asli tidak disertakan.
