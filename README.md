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
