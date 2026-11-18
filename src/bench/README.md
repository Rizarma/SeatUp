# Benchmark performa section editor & preview (10.000+ seat)

Pengukuran pada **production build** (`npm run build` + `vite preview`) di browser
nyata (bukan happy-dom). Fixture dan prosedur yang sama dipakai untuk
sebelum/sesudah. Klaim di bawah HANYA sebatas bukti yang tercatat; target yang
belum diukur ulang setelah perbaikan metodologi dinyatakan BELUM TERBUKTI.

## Perangkat & metode acuan (revisi temuan P2 #1–#4)

- Mesin acuan terakhir: Mac arm64 (Apple M3), Chromium Headless (chromium-1248)
  via Playwright, GPU terdeteksi (`ANGLE Metal Renderer: Apple M3`) — bukan
  software-only. Viewport 1440×900 (landscape) + 390×844 (portrait), DPR 1
  dan 2 (`deviceScaleFactor`). Catat perangkat/browser/viewport/build/revisi/
  metode setiap run.
- Server: `npx vite preview` untuk `dist/` hasil `npm run build`.
- Halaman bench: `http://localhost:PORT/?bench&scenario=<nama>&mode=<editor|preview>`
  me-mount **App asli** dan memakai pointer event pada handler yang sama
  (`dispatchEvent` + `elementFromPoint` ketat untuk klik terukur).
- `buildRev` disuntik dari git HEAD (`prod-<sha>`) via `addInitScript` dan
  tercatat di setiap JSON (bukan `dev`).
- Pan diukur sebagai distribusi delta rAF selama 40 gesture (5 frame pemanasan
  dibuang): rata-rata, **p95**, fps. Hover 150 sapuan DIDISTRIBUSIKAN ke
  banyak frame (setiap 10 event `await rAF`), bukan satu loop sinkron.
- Klik: N>=100 sampel (editor DAN preview) pada seat yang benar-benar
  terlihat; dilaporkan n, median, p95, maksimum, dan kegagalan. Timer dimulai
  SEBELUM pointerdown (mencakup handler seleksi) hingga paint 2xRAF.
  Editor memverifikasi IDENTITAS baris via `window.__seatupBenchSelected`
  (jumlah + set ID tepat baris target, bukan sekadar >0). Preview memverifikasi
  ID + jumlah + subtotal via `window.__seatupBenchPicks/Subtotal` sesuai harga
  seat target; taken/book/invalid diverifikasi TIDAK terpilih. Bench GAGAL bila
  target di luar layar / tertutup / tak ditemukan / pilihan salah, atau p95 >100ms.
  Tanpa fallback dispatch ke root untuk klik offscreen.
- Klik/marquee/bulk/undo/redo/drag/resize = `performance.now()` di sekitar
  dispatch + 2 frame (`requestAnimationFrame` ganda, mencakup paint + metode tercatat).
- **Konversi koordinat tunggal (temuan #3):** seluruh konversi world→client
  bench memakai `worldToClientPx` — skala seragam dari LEBAR, definisi yang
  sama dengan renderer/hit-test (`worldScale`). Rumus lama sumbu-Y
  `(target.y - viewBox.y) / viewBox.w * rect.height` yang mencampur sumbu
  sudah dihapus; tak ada rumus duplikat per skenario. Titik drop drag adaptif:
  bila offset (+96,+60) jatuh di bawah toolbar dock, arah dibalik agar target
  tetap terlihat/tak tertutup; offset tercatat (`drag_*_drop_dx/dy`).
  Error ketat membawa koordinat + fase (`[S4-click]`, `[S9-drag-…]`).
- Drag menguji BARIS kecil + BLOK besar dalam section fokus (tool Select,
  hit-test baris Canvas), bukan shape section di venue; diverifikasi tepat
  1 commit/undo untuk drag normal, 0 commit untuk cancel (Esc). Biaya preview
  per frame (median/p95/maks, 12 sampel) dipisahkan dari commit saat pointerup.
  Skenario `20k-12kblock` memakai SATU objek 12.000 seat (60×200) dalam total
  20.000 untuk mengukur scaling aktual + alokasi/GC bila menjadi bottleneck.
- **Penghitungan commit via spy (temuan #4):** `window.__seatupBenchCommits` /
  `__seatupBenchResetCommits` / `__seatupBenchDoc` (aktif hanya saat `?bench`;
  produksi tak berubah). Spy menghitung commit dokumen NYATA — selisih label
  Urungkan SALAH saat history penuh (60 entri) karena commit baru tak menambah
  panjang history. Batas history produksi tetap 60 (tak dinaikkan). Skenario 60
  commit membuktikan spy +60 pada semua kondisi history sekaligus panjang history
  mengikuti batas; undo/redo diverifikasi via ISI dokumen (label baris /
  koordinat live), bukan label tombol. Cancel drag = 0 commit + koordinat tetap.
  Pan/zoom/hover/seleksi/tool = 0 commit. Kontrol negatif: aksi dimatikan →
  assertion gagal; commit diduplikasi → gagal.
- **Kepemilikan renderer (temuan #2):** `seatBaseOwner` (>1500 → Canvas) +
  `ghostOwner` (>500 → Canvas); ghost-only Canvas memakai base KOSONG + overlay
  HANYA ghost (seleksi/hover tetap SVG) agar seat tak digambar dua kali;
  `baseMode` masuk kunci cache sehingga transisi SVG↔Canvas menginvalidasi
  citra lama.
- **Scheduler StrictMode (temuan #1):** cleanup mengembalikan `rafRef` ke 0
  sehingga replay effect menjadwal ulang; coalescing 1 frame + baca revisi
  terbaru dipertahankan; callback batal tak menggambar setelah unmount.
- Memori: siklus keluar/masuk 3× DAN 10× plus 60 COMMIT dokumen nyata
  (edit massal baris, bukan navigasi) + undo5/redo5; verifikasi isi + spy.
  Bedakan retained growth dari variasi GC/transien (dua delta + tren antar run
  + `gc()` bila tersedia; `performance.memory` presisi via
  `--enable-precise-memory-info`). Jangan simpulkan leak dari satu delta heap.
- Pelanggaran target latency/frame time = GAGAL (bukan angka): pan p95 >20ms
  pada 10k/20k, klik p95 >100ms melempar. Run GAGAL tetap menyimpan metrik
  parsial (`partial`) + raw sebagai bukti.
- Bench berhenti GAGAL bila assertion perilaku tak terpenuhi. Self-test
  (`benchGuards.test.tsx`) memakai **store + spy produksi**: gagal pada klik
  offscreen/tertutup/null; spy +60 dari history awal 0/1/59/60; drag-penuh 1
  commit vs cancel 0; undo/redo via isi; kontrol negatif (aksi dimatikan /
  commit diduplikasi → assertion gagal). Tes `expect(true)` dan counter lokal
  sudah dihapus.
- Hasil mentah tiap run: [`results/prod-2026-11-17/`](results/prod-2026-11-17/)
  (JSON per sel: `payload` bila lolos, `partial` + `raw` bila gagal).
  Setiap JSON memuat revisi build, perangkat, browser, viewport, DPR, dan metode.
  Hasil lama (metodologi lama) diarsipkan di [`results/archive-metodologi-lama/`](results/archive-metodologi-lama/)
  dan TIDAK dipakai untuk acceptance terbaru. Orkestrasi: skrip Playwright
  (`chromium.launch`, `addInitScript` buildRev, tunggu
  `document.title === 'BENCH_DONE'`, simpan mentah termasuk yang gagal).

## Fixture deterministik

`fixtures.ts` (PRNG `mulberry32`, seed tetap):

| Skenario | Section | Baris × kursi | Total | Bentuk |
|---|---|---|---|---|
| `1k-rect` | 1 | 20 × 50 | 1.000 | polygon rect |
| `10k-rect` | 1 | 200 × 50 | 10.000 | polygon rect |
| `20k-rect` | 1 | 400 × 50 | 20.000 | polygon rect |
| `50k-rect` | 1 | 500 × 100 | 50.000 | polygon rect |
| `10k-complex` | 1 | 200 × 50 | 10.000 | section **vector berkurva** (stadion, flatten ±0,5) |
| `20k-elongated` | 1 | 20 × 1.000 | 20.000 | layout memanjang horizontal |
| `20k-12kblock` | 1 | 1×12.000 + 160×50 | 20.000 | blok raksasa 60×200 dalam 1 objek + rect |

Status campuran deterministik (8% taken, 8% book), semua footprint valid di
dalam section. Skenario editor mencakup seluruh section terlihat (fit) dan zoom
dekat (tombol zoom ±). Skenario: pan (40 gesture, p95), zoom, hover 150
terdistribusi, klik N>=100 identitas baris, marquee + akurasi vs oracle,
edit massal + undo + redo, keluar/masuk 3×/10× + 60 COMMIT nyata + undo5/redo5,
drag kecil + blok besar (preview/frame vs commit terpisah) + cancel 0 commit,
ghost besar jumlah-tetap, resize landscape/portrait + ganti section.
DPR 1 dan 2, beberapa run per skenario untuk variasi. Interaksi berat
(pan/hover berkelanjutan, seleksi massal, edit massal, ghost, cancel) wajib
masuk matriks produksi.

Jalankan ulang (production, browser nyata) — orkestrasi tersimpan di repo:

```sh
npm run build
# Matriks penuh headed (Chrome asli + trace + probe interaksi berkelanjutan):
node scripts/bench-run.mjs --headed \
  --cells "10k-rect:editor:dpr1:1440x900,20k-rect:editor:dpr1:1440x900" \
  --runs 2 --trace --probe-long --out src/bench/results/prod-<tanggal>/headed
# Headless (cached Chromium, perbandingan regresi):
node scripts/bench-run.mjs --headless \
  --cells "10k-rect:editor:dpr1:1440x900" \
  --runs 2 --out src/bench/results/prod-<tanggal>/headless
# Diagnostik memori 300 commit (label vs geometri, cached-vs-evict undo):
node scripts/bench-run.mjs --headed \
  --cells "10k-rect:editor:dpr1:1440x900,20k-rect:editor:dpr1:1440x900,50k-rect:editor:dpr1:1440x900" \
  --runs 1 --mem-full --out src/bench/results/prod-<tanggal>/mem
```

Format sel: `skenario:mode:dpr:viewport` (`10k-rect:editor:dpr2:390x844`);
`--matrix acceptance` = sel penerimaan 1k/10k/20k editor+preview.
Identitas build disuntik otomatis via `scripts/build-rev.mjs`
(`prod-<sha>[-dirty-<hash>]` — SHA HEAD + hash working-tree, karena SHA saja
tak cukup saat perbaikan belum di-commit) dan tercatat di tiap JSON +
`environment.json` (display/CPU/RAM/OS + refresh-rate catatan manual +
idle-vs-busy probe). Trace Chromium (`*.trace.json`, buka di
`chrome://tracing`/Perfetto) + ringkasan main-thread (`*.trace-summary.json`).

Manual bila perlu (tanpa skrip): `npx vite preview --port 4173` atas `dist/`,
lalu buka `http://localhost:4173/?bench&scenario=10k-rect&mode=editor`
(DPR 2 / portrait via konteks Playwright `deviceScaleFactor` + viewport);
hasil JSON di `<pre id="bench-result">`, selesai saat title = `BENCH_DONE`;
simpan sebagai `results/prod-<tanggal>/<scenario>.<mode>.dpr<dpr>.<WxH>.run<n>.json`.
```

## Hasil production terbaru (2026-11-17, build `prod-c3b1db5`)

Lingkungan: Mac arm64 (Apple M3), Chromium Headless (chromium-1248) via
Playwright, GPU `ANGLE Metal Renderer: Apple M3`, viewport 1440×900 + 390×844,
DPR 1 dan 2, `vite preview` dari `dist/` (`npm run build`). 23 run + 1 run
portrait final. Mentah: [`results/prod-2026-11-17/`](results/prod-2026-11-17/)
(`payload` bila lolos, `partial` + `raw` bila gagal — kegagalan tetap bukti).

Catatan baca: `pan p95` diukur dari delta rAF selama 40 gesture (5 pemanasan
dibuang); `klik p95` mencakup handler + paint 2xRAF; `marquee a/b` = dapat/harap
vs oracle; `spy` = delta spy commit 60-operasi; `drag s/b/c` = commit
kecil/besar/cancel; `heap 3×/10×/+60` = delta MB siklus 3×, 10× + gc, dan
retensi setelah 60 commit (history 60 entri, TERBATAS — bukan leak).

### Editor (satu section, fit-all + zoom dekat, status campuran)

| Skenario | Run | Pan p95 (fps) | Klik p95 (n=100, gagal) | Marquee | Spy 60 (len) | Drag s/b/c | Heap 3×/10×/+60 (MB) | Status |
|---|---|---|---|---|---|---|---|---|
| 1k-rect dpr1 | ×2 | 33,4 (30) | 66–67 (0) | 145/145 | 60 (60) | 1/1/0 | −0,1/−9,5/+4,5 · −0,4/−4,9/+4,0 | lolos |
| 10k-rect dpr1 | ×3 | 33,4 (30) | 67,3 (0) | 1323/1323 | 60 (60) | 1/1/0 | −8/+−19/+112–118 | gagal pan |
| 10k-rect dpr2 | ×2 | 33,4 (30) | 67–68 (0) | 1323/1323 | 60 (60) | 1/1/0 | −4/−5/+116 | gagal pan |
| 10k-rect dpr2 portrait 390×844 | ×1 | **16,8 (60)** | **34,1 (0)** | 918/918 | 60 (60) | 1/1/0 | −8,1/−22,8/+117,8 | **lolos** |
| 20k-rect dpr1 | ×2 | 33,4 (30) | 67–68 (0) | 2650/2650 | 60 (60) | 1/1/0 | −8,6/−5,5…−22,9/+217–220 | gagal pan |
| 20k-rect dpr2 | ×1 | 116,7 (8,6) | 33,5 (0) | 2650/2650 | 60 (60) | 1/1/0 | −10,9/−4,9/+216,9 | gagal pan |
| 50k-rect dpr1 (stress) | ×2 | 33,4 (30) | 67 (0) | 6600/6600 | 60 (60) | 1/1/0 | −3,5/−46…−53/+417–439 | lolos* |
| 10k-complex dpr1 | ×2 | 33,4 (30) | 67 (0) | 1500/1500 | 60 (60) | 1/1/0 | −7/−14/+117,9 | gagal pan |
| 20k-elongated dpr1 | ×2 | 33,4 (30) | 67 (0) | 5660/5660 | 60 (60) | 1/1/0 | −6/+−17…−8,+−12/+128–131 | gagal pan |
| 20k-12kblock dpr1 | ×2 | 33,4 (30) | 67–68 (0) | 1450/1450 | 60 (60) | 1/1/0 (blok 12.000: commit 77ms, preview p95 39,7) | −0,4…−8,6/−12,9…−22,6/+308–354 | gagal pan |

`*` 50k dikecualikan dari gerbang pan otomatis (stress test): angka dicatat,
bukan diloloskan.

### Preview pembeli

| Skenario | Run | Pan p95 (fps) | Klik p95 (n=100, gagal) | Taken | Status |
|---|---|---|---|---|---|
| 10k-rect dpr1 | ×2 | 33,4 (30) | 67–68 (0) | ok (tak ikut terpilih) | lolos |
| 10k-rect dpr2 | ×1 | 16,7 (60) | 34,3 (0) | ok | lolos |
| 20k-rect dpr1 | ×1 | 33,4 (30) | 68,3 (0) | ok | lolos |

Variasi 16,7 vs 33,4 antar run pada mesin/aplikasi yang sama = kadensi
kompositor headless, bukan biaya kerja (lihat profiling di bawah).

### Profiling bottleneck pan (hipotesis, BUKAN kesimpulan — butuh trace headed)

Pengamatan headless (Nov 17, build `prod-c3b1db5`, Chromium headless on-demand-frame):

1. Nilai pan avg/p95/fps IDENTIK (33,33/33,4/30) di 1k SVG, 10k/20k/50k Canvas,
   complex, elongated, DPR 1/2 — biaya per-frame tak mungkin sama untuk 1k
   node SVG vs blit 50k bila itulah yang diukur.
2. Properti run: tiap gesture `await` 1 frame → steady-state 2 vsync per gesture
   pada penjadwalan frame on-demand headless (BeginFrame: frame hanya dipompa
   bila ada invalidasi; halaman idle memompa ~1Hz).
3. Probe bingkai-tak-terbatas (`--disable-frame-rate-limit --disable-gpu-vsync`,
   120 gesture burst, fixture 1k vs 10k asli): idle p50/p95 17,7/17,8 —
   burst 17,7/17,8 — dispatch 120 gesture 11–12ms; IDENTIK idle-vs-beban dan
   1k-vs-10k. Kerja main-thread+paint per gesture ≪ 1 vsync 60Hz.

Status klaim: butir 1–3 adalah PENGAMATAN yang konsisten dengan hipotesis
"angka 33,4 = artefak kadensi harness headless", TETAPI kesamaan interval rAF
saja belum membuktikan biaya aplikasi kecil/bebas bottleneck (burst event yang
digabung jadi sedikit frame tak setara banyak frame interaksi nyata), dan opsi
disable-vsync BUKAN bukti tunggal kemampuan 60fps. Pembuktian mensyaratkan:

- ukur ulang pan/zoom pada browser berjendela (headed) + display 60Hz+,
  catat refresh rate/perangkat/browser/viewport/DPR/build/kondisi;
- bandingkan idle vs interaksi berkelanjutan dgn metode SAMA (probe
  `*.probe-long.json`: idle 3s vs pan kontinu 6s, puluhan–ratusan gesture,
  verifikasi kamera benar-benar berubah via viewBox + scene digambar);
- ambil performance trace Chromium per run pan (`*.trace.json` +
  `*.trace-summary.json`: ringkasan main-thread per nama slice —
  EventDispatch, render/commit React, build indeks, Canvas drawing,
  style/layout, paint/compositing, GC, scheduler idle) dan periksa khusus
  outlier 20k DPR2 116,7ms;
- JANGAN simpulkan "bukan bottleneck aplikasi" hanya dari rAF konstan.

Hasil headed + trace + probe ada di `results/prod-2026-11-17-p1/` (lihat tabel
penerimaan). Ambang/assertion pan (p95 ≤ 20ms, editor DAN preview 10k/20k,
evaluator `src/bench/acceptance.ts`) TIDAK diubah untuk menghijaukan hasil.

### Retensi memori 60 commit (bounded history, bukan leak)

`heap +60` tumbuh sebanding seat (1k ≈4–5MB, 10k ≈108–118MB, 20k ≈217MB,
blok-12k ≈308–354MB, 50k ≈417–439MB): 60 entri history × doc (structural
sharing; baris berubah + indeks per revisi diduplikasi, kursi tak berubah
dipakai bersama). Dibatasi 60 entri — tidak tumbuh dengan commit ke-61+.
`heap 10×` selalu negatif (hingga −53MB): siklus keluar/masuk tak menambah
retensi. Satu outlier wall-time (20k preview 913s — stall harness, payload
tetap valid) dan satu `harness_timeout` (20k dpr2, diulang manual hingga
dapat) dicatat apa adanya di `_summary.json`.

## Hasil: status bukti

ARSIP metodologi lama (JANGAN klaim target tercapai — dipindah ke
`results/archive-metodologi-lama/`): tabel di bawah memakai metodologi LAMA
yang belum valid (klik 1 sampel diklaim p95; hover 150 event sinkron; preview
20k `click_cover: null` tetap dianggap lulus; drag menguji shape section bukan
baris; memori hanya 3× in/out; timer klik setelah pointerdown; assertion hanya
jumlah, bukan identitas). Disimpan sebagai arsip sebelum/sesudah optimasi awal,
BUKAN bukti penerimaan target. Setelah perbaikan metodologi (klik N>=100
identitas + timer sebelum pointerdown, hover terdistribusi, drag baris kecil +
blok 12k + cancel, memori 60 commit nyata, target sebagai gagal), matriks
HARUS diukur ulang pada production build di browser nyata. Hasil baru
(metodologi baru) BELUM TERSEDIA di lingkungan ini — jalankan matriks di
bawah pada perangkat acuan dan simpan JSON mentah per sel.

| Skenario | Pan p95 (fps) | Hover 150× | Klik baris | Marquee (akurasi) | Bulk edit | Undo / Redo | In/out 3× | Drag (commit) |
|---|---|---|---|---|---|---|---|---|
| 1k sebelum | 16,8 (60) | 33 | 15 | 33 | 33 | 50 / 50 | 190 | — |
| 1k sesudah | 16,8 (60) | 32 | 15 | 33 (116=116 ok) | 33 | 50 / 50 | 191 | 67 (1) |
| 10k sebelum | 33–100 (23–38) | 36–177 | 36–65 | 72–78 (1350 ok) | 62–134 | 67–116 / 67–107 | 526–871 | 67 (1) |
| 10k sesudah | 16,8 (60) | 33 | 29–31 | 34 (1350 ok) | 34 | 50 / 50 | 188 | — (1 di 1k/50k) |
| 20k sebelum | 150 (14) | 92 | 3–65 | 131 (2650 ok) | 140 | 150 / 133 | 1072 | — |
| 20k sesudah | 16,7 (60) | 33 | 29 | 33 (2650 ok) | 59 | 50 / 49 | 188 | — (1 di 1k/50k) |
| 50k sebelum | 417 (5,6) | 776 | 180 | 354 (6600 ok) | 430 | 266 / 316 | 3297 | 134 (1) |
| 50k sesudah | 16,8 (58) | 34 | 26 | 67 (6600 ok) | 98 | 44 / 50 | 188 | 75 (1) |
| 10k-complex sebelum | 50 (35) | 59 | 38 | 76 (1500 ok) | 242 | 201 / 183 | 911 | — |
| 10k-complex sesudah | 16,7 (60) | 33 | 30 | 50 (1500 ok) | 33 | 49 / 51 | 492 | 83 (1) |

## Hasil: preview pembeli (arsip metodologi lama)

| Skenario | Pan p95 (fps) | Hover 150× | Klik pilih | Simulasi |
|---|---|---|---|---|
| 1k sebelum / sesudah | 33 (47–50) | 27–33 | 33–34 | 33 |
| 10k sebelum | 200 (5,4) | 51 | 217 | 216 |
| 10k sesudah | 16,8 (60) | 33 | 33 | 33 |
| 20k sebelum | 450 (2,6) | 98 | 435 | 419 |
| 20k sesudah | 16,8 (60) | 33 | 33 | 33 |
| 50k sesudah | 16,8 (60) | 33 | 34 | 33 |

Catatan validitas: hasil preview 20k mencatat `click_cover: null` tetapi
dianggap lulus — cacat metodologi yang kini diperbaiki (bench gagal bila
cover null/tertutup). Angka di atas tidak dipakai untuk klaim penerimaan.

## Memori (arsip 3× in/out, `performance.memory`)

| Skenario | Sebelum Δ heap | Sesudah Δ heap |
|---|---|---|
| 10k rect | +0,3 MB | −4,4 MB |
| 20k rect | +29,8 MB | +1,8 MB |
| 50k rect | **+165,9 MB** | −2,6 MB |
| 10k complex | +27,2 MB | +10,8 MB (satu sampel; tanpa tren naik antar run) |

Arsip di atas hanya 3× in/out dan belum menguji 60 operasi history.
Metodologi baru menambah 10× siklus + 60 operasi history dan membedakan
retained vs transien/GC. Ulangi sebelum menyatakan stabil.

## Bottleneck yang terbukti & perbaikannya

1. **Render ulang 50k node SVG tiap frame kamera/seleksi.** Pan/zoom lama
   memicu `setVb` → render ulang seluruh daftar seat (dan hover/seleksi
   me-render ulang semuanya lagi). → Lapisan seat Canvas 2D (`SeatCanvas` +
   `seatCanvas.ts`) di atas SVG shape; React hanya me-render shape (puluhan
   node). Aktif di atas 1.500 seat/section; di bawahnya SVG memo
   (`RowSeatsGroup` + overlay seleksi/hover terpisah) agar perilaku & test lama
   utuh.
2. **Tanpa culling/LOD.** Fit-to-section berarti seluruh seat di viewport. →
   Culling viewport + margin (`cullMargin`), LOD dot/simple/full (`viewTransform.lodFor`),
   batch per warna, pooling array (nol alokasi per frame), jalur persegi cepat
   saat zoom jauh. Diukur juga pada skenario fit-all.
3. **Event pan/zoom/hover tanpa coalescing + `getBoundingClientRect` per move.**
   → Kamera rAF (maks 1 `setVb`/frame, flush posisi terbaru saat pointerup),
   hover via indeks + redraw kanvas langsung (tanpa `setState`), rect di-cache
   saat gesture mulai. Pointercancel/capture/mode/unmount membatalkan frame.
4. **Hit-test & query O(dokumen).** Marquee, hover, klik, warna, hitungan panel
   memakai `flatMap`/`find` per event/render (preview: `find` per seat). →
   `docIndex` (WeakMap per revisi doc): `seatById`, `seatsBySection`,
   warna/harga section, uniform grid untuk query titik/box. Kamera/seleksi tak
   membangun ulang indeks.
5. **Commit mahal + history boros.** `structuredClone` seluruh dokumen per commit
   (60 snapshot × 50k seat), `revalidateSeats` penuh + `find` per seat di
   `syncCategoryPrices`, kapasitas dihitung ulang penuh per commit. →
   Revalidasi inkremental (hanya seat bergerak / section berubah / koordinat
   berubah; referensi dipertahankan), sync kategori via peta, history
   structural-sharing (bukan clone), cache total kapasitas per revisi geom.
   Drag tetap 1 commit/undo (preview sementara → commit saat lepas).
6. **Store tunggal me-render ulang semua konsumen saat seleksi berubah.** →
   Konteks dokumen vs seleksi dipisah (`useDocStore`/`useSelectionStore`,
   `useStore` tetap kompatibel).

## Penerimaan vs target (status jujur pasca-temuan P2 #1–#5)

Bukti baru: `results/prod-2026-11-17/` (23 run + portrait final, build
`prod-c3b1db5`) + regresi vitest 228/228.

- 10k & 20k pan/zoom ≈ 60 fps, p95 ≤ 20 ms. **GAGAL di lingkungan uji
  (BELUM TERBUKTI)**: landscape mengukur 33,4 konstan (gagal gerbang);
  portrait 10k mengukur 16,8 = LOLOS. Profiling bingkai-tak-terbatas
  (idle ≡ burst ≡ 1k ≡ 10k di 17,7/17,8) menunjukkan angka landscape adalah
  artefak kadensi headless on-demand-frame, bukan bottleneck aplikasi —
  tetapi pembuktian 60fps butuh pengukuran vsync headed. Ambang tak diubah.
- Klik → highlight p95 < 100 ms. **TERBUKTI di lingkungan uji**: editor +
  preview 66–68 (landscape) / 34 (portrait & preview-dpr2), n=100, 0 gagal,
  identitas baris + ID/subtotal terverifikasi, taken/book tak terpilih.
- Hover tanpa render React seluruh seat. **TERBUKTI arsitektur + regresi +
  angka**: hover 150× ≈566ms terdistribusi (~3,8ms/event) di semua skala;
  `seatCanvasSplit`, `seatCanvasStale`, `seatCanvasStrict` (StrictMode replay).
- Pan/zoom tanpa commit; drag baris = 1 commit/undo, cancel = 0 commit.
  **TERBUKTI production**: spy tepat 1 / 0 di semua run termasuk blok 12.000
  (commit 77ms, preview p95 39,7); undo/redo via koordinat live; cancel tak
  mengubah koordinat. Regresi `dragCancel` + `benchGuards` (spy, negatif).
- Seleksi massal akurat. **TERBUKTI**: marquee 145/145 … 6600/6600 vs oracle
  di semua run; `dragBlock` oracle 12k.
- Ghost overlay jumlah-tetap redraw benar, base dipakai ulang, satu renderer
  per seat. **TERBUKTI**: `seatBaseOwner`/`ghostOwner` + `baseMode` di kunci
  cache; regresi mount nyata (`editorRendererOwnership`: 0/1k/1,5k/1501/10k ×
  500/501/ribuan, transisi, status invalid/taken/book); hash koordinat+
  validitas; base Canvas ghost-only NOL seat.
- Scheduler StrictMode. **TERBUKTI**: regresi `seatCanvasStrict` (replay +
  flush menggambar base; overlay tanpa rebuild; revisi terbaru menang;
  unmount membatalkan; mount ulang) + `seatCanvasStale` tanpa replay.
- Koordinat benchmark. **TERBUKTI**: `worldToClientPx` + `benchCoordinate`
  (7 ekspektasi independen incl. contoh spesifikasi); seluruh konversi bench
  memakai helper tunggal; DPR-invarian.
- Penghitungan commit. **TERBUKTI**: spy `__seatupBenchCommits` (hanya
  `?bench`); 60 commit teramati dari history awal 0/1/59/60; panjang history
  mengikuti batas 60; undo/redo/cancel/seleksi/tool diverifikasi via isi;
  kontrol negatif (aksi dimatikan / commit diduplikasi → gagal).
- Memori stabil. **TERBUKTI terbatas**: siklus 3×/10× delta ≤0 (tak ada
  pertumbuhan lanjutan); retensi +60 commit proporsional & terbatas 60 entri
  (1k ~4MB … 50k ~439MB — observasi stress, bukan leak).
- 50k stress. **Fungsional lolos, TIDAK dinyatakan siap**: semua assertion
  perilaku lolos (klik/marquee/spy/drag/undo), tetapi angka pan mengikuti
  artefak harness yang sama; retensi absolut ~439MB dicatat sebagai batas
  aktual yang perlu ditinjau sebelum klaim kesiapan.

## Batas, tradeoff & pekerjaan tersisa

- Bukti 60fps pan butuh run headed/vsync (display 60Hz+, bukan headless
  on-demand-frame). Ulangi S1 di perangkat acuan produksi bila ada.
- Bench memakai Chromium headless; Safari/Firefox dan GPU lemah belum diukur.
- Ambang SVG→Canvas 1.500 seat/section: di bawahnya perilaku DOM lama
  dipertahankan (termasuk 1.000 lingkaran + `<title>` untuk test/a11y).
  Menaikkan ambang butuh validasi ulang tabel ini.
- Estimasi kapasitas section kompleks: kunjungan pertama per (skala, geom)
  tetap memindai grid eksak (~50–150 ms di 10k-complex), lalu di-cache.
  Belum debounce/async saat slider skala digeser cepat.
- Angka hover adalah synthetic move (tak memicu enter/leave per-lingkaran
  seperti pointer nyata); keunggulan kanvas pada hover nyata lebih besar.
- `localStorage` tak muat menampung fixture 50k (>kuota 5 MB): bench memakai
  kait injeksi `window.__seatupLoadDoc` (aktif hanya saat `?bench`); format
  dokumen produksi tak berubah.
- Pemeriksaan visual browser (opacity tak ganda saat ghost besar muncul)
  dilakukan via assertion DOM/kunci cache + regresi mount; inspeksi piksel
  manual tercatat sebagai opsional, bukan bukti penerimaan.
