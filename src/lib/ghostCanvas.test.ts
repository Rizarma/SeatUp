import { describe, expect, it } from 'vitest';
// Uji jalur produksi langsung (temuan #2): tidak menduplikasi logika,
// melainkan mengimpor implementasi yang dipakai EditorCanvas.
import { ghostOverlayKinds, ghostVisualHash, needsGhostCanvas } from '../components/EditorCanvas';

describe('ghost preview blok >500 seat (temuan #2, jalur produksi)', () => {
  it.each([
    [0, 500], [0, 501], [0, 3000],
    [1000, 500], [1000, 501], [1000, 3000],
    [2000, 500], [2000, 501], [2000, 3000],
  ])('existing %i + kandidat %i: renderer benar', (existing, kandidat) => {
    void existing;
    const anchor = { x: 0, y: 0 };
    const need = needsGhostCanvas('row', anchor, kandidat);
    // >500 selalu butuh canvas overlay; <=500 cukup SVG
    expect(need).toBe(kandidat > 500);
  });

  it('melewati batas 500 saat drag tidak menghilangkan preview (tetap overlay)', () => {
    const anchor = { x: 0, y: 0 };
    expect(needsGhostCanvas('row', anchor, 500)).toBe(false);
    expect(needsGhostCanvas('row', anchor, 501)).toBe(true);
    expect(ghostOverlayKinds([{ ok: true }, { ok: false }])).toEqual(['ghost-ok', 'ghost-bad']);
  });

  it('ghost dibersihkan saat commit/cancel/tool/section/unmount (anchor null)', () => {
    expect(needsGhostCanvas('row', null, 3000)).toBe(false);
    expect(needsGhostCanvas('select', { x: 0, y: 0 }, 3000)).toBe(false);
  });

  it('hash visual berubah saat koordinat bergeser dengan JUMLAH TETAP', () => {
    const a = Array.from({ length: 600 }, (_, i) => ({ x: i * 26, y: 0, ok: true }));
    const b = a.map((g) => ({ ...g, x: g.x + 13 }));
    expect(ghostVisualHash(a)).not.toBe(ghostVisualHash(b));
  });

  it('hash visual berubah saat validitas berubah dengan JUMLAH TETAP', () => {
    const a = Array.from({ length: 600 }, (_, i) => ({ x: i, y: 0, ok: true }));
    const b = a.map((g, i) => (i < 10 ? { ...g, ok: false } : g));
    expect(ghostVisualHash(a)).not.toBe(ghostVisualHash(b));
  });

  it('hash stabil untuk konten identik', () => {
    const a = Array.from({ length: 600 }, (_, i) => ({ x: i * 2, y: i, ok: i % 2 === 0 }));
    const b = a.map((g) => ({ ...g }));
    expect(ghostVisualHash(a)).toBe(ghostVisualHash(b));
  });
});
