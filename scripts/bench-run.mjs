#!/usr/bin/env node
// Orkestrasi benchmark production (temuan #3): dapat diulang, tersimpan di repo.
// - Menjalankan `vite preview` atas dist/ hasil `npm run build`.
// - Meluncurkan Chromium headed (Chrome asli, display nyata + vsync) atau
//   headless (cached Chromium), viewport/DPR sesuai matriks.
// - Menyuntik buildRev (scripts/build-rev.mjs: HEAD + hash working-tree)
//   via addInitScript; tercatat di tiap JSON.
// - Menunggu document.title === 'BENCH_DONE', menyimpan mentah (payload bila
//   lolos/stress, partial+raw bila gagal) — kegagalan tetap bukti.
// - Opsional: tracing Chromium (browser.startTracing) + probe pan/zoom
//   berkelanjutan (input pointer kontinu beberapa detik, verifikasi kamera
//   benar-benar berubah) + info display/sistem.
// - Opsional: --disable-vsync HANYA sebagai probe pendukung, bukan bukti 60fps.
//
// Contoh:
//   node scripts/bench-run.mjs --headed --cells 10k-rect:editor:dpr1:1440x900 --runs 2
//   node scripts/bench-run.mjs --headed --matrix acceptance --trace --probe-long
//   node scripts/bench-run.mjs --headless --cells 20k-rect:editor:dpr2:1440x900 --mem-full --runs 1
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const PW_PATHS = [
  'playwright-core',
  '/tmp/benchrun/node_modules/playwright-core',
  join(process.env.HOME ?? '', 'Library/Caches/ms-playwright'),
];
let pw = null;
let pwFrom = '';
for (const p of PW_PATHS) {
  try { pw = require(p); pwFrom = p; break; } catch { /* lanjut */ }
}
if (!pw) {
  console.error(`playwright-core tak ditemukan. Coba: ${PW_PATHS.join(', ')}`);
  process.exit(2);
}
const { chromium } = pw;

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);
const HEADED = flag('--headed');
const WITH_TRACE = flag('--trace');
const PROBE_LONG = flag('--probe-long');
const MEM_FULL = flag('--mem-full');
const RUNS = Number(opt('--runs', '1')) || 1;
const PORT = Number(opt('--port', '4173')) || 4173;
const OUT = resolve(ROOT, opt('--out', 'src/bench/results/manual'));
const NO_VSYNC = flag('--no-vsync-probe');
const TRACE_SKIP = opt('--trace-skip', '12kblock,50k').split(',').map((s) => s.trim()).filter(Boolean);
const CHROME_EXE = opt('--chrome-exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const HEADLESS_EXE = opt('--headless-exe', `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`);

function launchOpts() {
  return {
    headless: !HEADED,
    args: ['--enable-precise-memory-info', '--js-flags=--expose-gc', `--window-size=1440,900`].concat(NO_VSYNC ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
  };
}
function exeFor() {
  const exe = HEADED ? CHROME_EXE : HEADLESS_EXE;
  const o = launchOpts();
  if (exe && existsSync(exe)) o.executablePath = exe;
  return o;
}

const ACCEPTANCE_CELLS = [
  '1k-rect:editor:dpr1:1440x900',
  '10k-rect:editor:dpr1:1440x900',
  '20k-rect:editor:dpr1:1440x900',
  '10k-rect:preview:dpr1:1440x900',
  '20k-rect:preview:dpr1:1440x900',
];
function parseCells() {
  if (args.includes('--matrix')) {
    const which = opt('--matrix', 'acceptance');
    if (which === 'acceptance') return ACCEPTANCE_CELLS;
    throw new Error(`matriks tak dikenal: ${which}`);
  }
  const raw = opt('--cells', '10k-rect:editor:dpr1:1440x900');
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
function parseCell(cell) {
  const [scenario, mode = 'editor', dpr = 'dpr1', vp = '1440x900'] = cell.split(':');
  const [w, h] = vp.split('x').map(Number);
  return { scenario, mode, dpr: Number(dpr.replace('dpr', '')) || 1, w, h, vp };
}

function sysInfo() {
  const info = {};
  try { info.displays = execSync('system_profiler SPDisplaysDataType 2>/dev/null', { encoding: 'utf8' }).slice(0, 3000); } catch { info.displays = 'n/a'; }
  try { info.cpu = execSync('sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m', { encoding: 'utf8' }).trim(); } catch { info.cpu = 'n/a'; }
  try { info.mem = execSync('sysctl -n hw.memsize 2>/dev/null', { encoding: 'utf8' }).trim(); } catch { info.mem = 'n/a'; }
  try { info.os = execSync('sw_vers -productVersion 2>/dev/null || uname -r', { encoding: 'utf8' }).trim(); } catch { info.os = 'n/a'; }
  return info;
}

async function waitPreview(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      execSync(`curl -sf http://localhost:${port}/ >/dev/null`);
      return;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error(`vite preview tak merespons di :${port}`);
}

// Probe mandiri: idle vs interaksi berkelanjutan dgn metode SAMA + bukti
// kamera berubah. Dijalankan di halaman App BIASA (tanpa runner bench) pada
// konteks yang sama dengan bench run selnya — fixture sudah di localStorage
// oleh run bench (skala yang muat kuota; 50k via hook dilewati explisit).
async function probeLongPan(page, expectedMinBytes) {
  const res = await page.evaluate(async (minBytes) => {
    const raw = localStorage.getItem('seat-poc-venue-v1') ?? '';
    if (raw.length < minBytes) return { error: `fixture tak tersedia di konteks (${raw.length} < ${minBytes})` };
    const stats = (a) => {
      const s = [...a].sort((x, y) => x - y);
      const n = s.length;
      const qq = (p) => (n ? s[Math.min(n - 1, Math.floor(n * p))] : 0);
      return { n, avg: n ? Math.round((s.reduce((x, y) => x + y, 0) / n) * 100) / 100 : 0, p50: Math.round(qq(0.5) * 100) / 100, p95: Math.round(qq(0.95) * 100) / 100, max: Math.round((n ? s[n - 1] : 0) * 100) / 100, long50: s.filter((v) => v > 50).length };
    };
    const sample = (ms) => new Promise((res2) => {
      const ts = [];
      let run = true;
      const tick = (t) => { if (run) { ts.push(t); requestAnimationFrame(tick); } };
      requestAnimationFrame(tick);
      setTimeout(() => { run = false; res2(ts); }, ms);
    });
    const deltas = (ts) => { const d = []; for (let i = 6; i < ts.length; i++) d.push(ts[i] - ts[i - 1]); return d; };
    const svg = () => document.querySelector('svg.canvas');
    if (!svg()) return { error: 'svg tak ada (App belum load?)' };
    // Muat fixture dari localStorage lewat jalur pengguna yang sama (runner
    // bench memakai tombol ini; konteks = run sel yang baru selesai).
    const loadBtn = document.querySelector('[aria-label="Muat simpanan lokal"]');
    if (loadBtn) {
      loadBtn.click();
      const t0 = performance.now();
      while (performance.now() - t0 < 15000) {
        await new Promise((r) => setTimeout(r, 200));
        const found = [...svg().querySelectorAll('polygon, path')].filter((el) => !el.closest('defs'));
        if (found.length > 0) break;
      }
    }
    // Masuk section pertama via dblclick shape terbesar (jalur pengguna asli).
    const shapes = [...svg().querySelectorAll('polygon, path')].filter((el) => !el.closest('defs'));
    let entry = null;
    let best = -1;
    for (const el of shapes) {
      try { const b = el.getBBox(); const a = b.width * b.height; if (a > best) { best = a; entry = el; } } catch { /* abaikan */ }
    }
    if (!entry) return { error: 'tak ada shape section' };
    entry.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    if (svg().getAttribute('aria-label') !== 'Editor isi section') return { error: 'gagal masuk fokus section' };
    await new Promise((r) => setTimeout(r, 1500));
    const idleRaw = await sample(3000);
    const vbOf = () => svg().getAttribute('viewBox').split(' ').map(Number);
    const r = svg().getBoundingClientRect();
    const frames = [];
    let run = true;
    const tick = (t) => { if (run) { frames.push(t); requestAnimationFrame(tick); } };
    requestAnimationFrame(tick);
    const vb0 = vbOf().join(',');
    const ptr = (type, x, y) => svg().dispatchEvent(new PointerEvent(type, { bubbles: true, button: 1, pointerId: 1, clientX: x, clientY: y }));
    const x0 = r.left + r.width / 2;
    const y0 = r.top + r.height / 2;
    const t0 = performance.now();
    let gestures = 0;
    while (performance.now() - t0 < 6000) {
      ptr('pointerdown', x0, y0);
      for (let k = 1; k <= 6; k++) ptr('pointermove', x0 + k * 8, y0 + k * 4);
      ptr('pointerup', x0 + 48, y0 + 24);
      gestures++;
      await new Promise((rr) => requestAnimationFrame(() => rr()));
    }
    run = false;
    const vb1 = vbOf().join(',');
    await new Promise((rr2) => requestAnimationFrame(() => requestAnimationFrame(() => rr2())));
    return { idle: stats(deltas(idleRaw)), busy: stats(deltas(frames)), gestures, vbChanged: vb0 !== vb1, vb0, vb1 };
  }, expectedMinBytes);
  return res;
}

function summarizeTrace(traceJson) {
  // Ringkasan main-thread renderer: total per nama slice (memisahkan event
  // handling, render/commit, paint/compositing, GC, scheduler).
  let events = [];
  try {
    const j = JSON.parse(traceJson);
    events = Array.isArray(j) ? j : j.traceEvents ?? [];
  } catch { return { error: 'trace bukan JSON' }; }
  const byName = new Map();
  let mainTid = null;
  let mainPid = null;
  for (const e of events) {
    if (e.name === 'thread_name' && e.args?.name === 'CrRendererMain') { mainTid = e.tid; mainPid = e.pid; }
  }
  for (const e of events) {
    if (e.ph !== 'X' || e.tid !== mainTid || (mainPid !== null && e.pid !== mainPid)) continue;
    const d = (e.dur ?? 0) / 1000;
    byName.set(e.name, (byName.get(e.name) ?? 0) + d);
  }
  return [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, ms]) => ({ name, ms: Math.round(ms * 100) / 100 }));
}

async function main() {
  const cells = parseCells();
  const buildRev = execSync('node scripts/build-rev.mjs', { cwd: ROOT, encoding: 'utf8' }).trim();
  mkdirSync(OUT, { recursive: true });
  const sys = sysInfo();
  writeFileSync(join(OUT, 'environment.json'), JSON.stringify({ buildRev, headed: HEADED, pwFrom, sys, date: new Date().toISOString() }, null, 2));
  console.log(`buildRev=${buildRev} headed=${HEADED} trace=${WITH_TRACE} probeLong=${PROBE_LONG} memFull=${MEM_FULL}`);

  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const kill = () => { try { server.kill(); } catch { /* abaikan */ } };
  process.on('exit', kill);
  await waitPreview(PORT);

  const browser0 = await chromium.launch(exeFor());
  const state = { browser: browser0 };
  const ensureBrowser = async () => {
    if (state.browser.isConnected()) return state.browser;
    console.log('  browser mati — relaunch');
    try { await state.browser.close().catch(() => {}); } catch { /* abaikan */ }
    state.browser = await chromium.launch(exeFor());
    return state.browser;
  };
  const summary = { rev: buildRev, base: `http://localhost:${PORT}/`, finishedAt: '', runs: [] };
  try {
    for (const cell of cells) {
      const { scenario, mode, dpr, w, h, vp } = parseCell(cell);
      const wantTrace = WITH_TRACE && !TRACE_SKIP.some((s) => cell.includes(s));
      for (let run = 1; run <= RUNS; run++) {
        const tag = `${scenario}.${mode}.dpr${dpr}.${w}x${h}.run${run}${MEM_FULL ? '.memfull' : ''}`;
        const t0 = Date.now();
        let status = 'done';
        let text = '';
        const browser = await ensureBrowser();
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
        await ctx.addInitScript((rev) => { window.__seatupBuildRev = rev; }, buildRev);
        const page = await ctx.newPage();
        let traceSummary = null;
        try {
          if (wantTrace) await browser.startTracing({ screenshots: false, categories: ['blink', 'cc', 'gpu', 'renderer.scheduler', 'v8'] }).catch(() => {});
          const params = new URLSearchParams({ bench: '', scenario, mode });
          if (MEM_FULL) params.set('mem', 'full');
          if (scenario === '1k-rect') params.set('clicks', '100');
          await page.goto(`http://localhost:${PORT}/?${params.toString()}`, { waitUntil: 'load', timeout: 120000 });
          await page.waitForFunction(() => document.title === 'BENCH_DONE', { timeout: 600000 });
          // Hentikan tracing DULU (bebaskan buffer browser) sebelum membaca hasil.
          if (wantTrace) {
            try {
              const buf = await browser.stopTracing().catch(() => null);
              if (buf) {
                writeFileSync(join(OUT, `${tag}.trace.json`), buf.toString());
                traceSummary = summarizeTrace(buf.toString());
                writeFileSync(join(OUT, `${tag}.trace-summary.json`), JSON.stringify(traceSummary, null, 2));
              }
            } catch { /* abaikan */ }
          }
          text = await page.textContent('#bench-result');
          if (text.startsWith('BENCH_ERROR')) status = 'bench_error';
        } catch (e) {
          status = 'harness_timeout';
          text = `HARNESS_TIMEOUT: ${e.message}`;
          try { if (wantTrace) await state.browser.stopTracing().catch(() => null); } catch { /* abaikan */ }
        }
        let record = null;
        let perfVerdict = null;
        if (status === 'done') {
          try {
            record = JSON.parse(text);
            perfVerdict = record?.acceptance?.perf ?? null;
            if (perfVerdict === 'fail') status = 'bench_error';
          } catch {
            status = 'bench_error';
            record = null;
          }
        }
        const out = { tag, status, wallMs: Date.now() - t0, perf: perfVerdict, trace: traceSummary ? 'saved' : undefined };
        if (record) out.payload = record;
        else out.raw = (text ?? '').slice(0, 6000);
        writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(out, null, 2));
        console.log(`${tag}: ${status}${perfVerdict ? ` perf=${perfVerdict}` : ''} (${out.wallMs}ms)`);
        summary.runs.push({ tag, status, wallMs: out.wallMs, perf: perfVerdict ?? undefined });
        // Probe interaksi berkelanjutan (satu per sel, run pertama).
        if (PROBE_LONG && run === 1 && status !== 'harness_timeout') {
          try {
            const p2 = await ctx.newPage();
            await p2.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 120000 });
            await p2.waitForFunction(() => !!document.querySelector('svg.canvas'), { timeout: 60000 }).catch(() => {});
            const probe = await probeLongPan(p2, 100000);
            writeFileSync(join(OUT, `${tag}.probe-long.json`), JSON.stringify({ tag, probe, note: 'idle 3s vs pan kontinu 6s, metode rAF sama; vbChanged membuktikan kamera bergerak' }, null, 2));
            console.log(`  probe-long: gestures=${probe.gestures} vbChanged=${probe.vbChanged} idle_p95=${probe.idle?.p95} busy_p95=${probe.busy?.p95}`);
            await p2.close();
          } catch (e) {
            console.log(`  probe-long gagal: ${e.message}`);
          }
        }
        await ctx.close().catch(() => {});
      }
    }
  } finally {
    try { await state.browser.close(); } catch { /* abaikan */ }
    kill();
  }
  summary.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, '_summary.json'), JSON.stringify(summary, null, 2));
  console.log(`ringkasan: ${join(OUT, '_summary.json')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
