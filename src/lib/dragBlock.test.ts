import { describe, expect, it } from 'vitest';
import { emptyVenue } from './venue';
import type { VenueObject } from './venue';
import { getDocIndex, queryBoxVisible } from './docIndex';

// Temuan #3: drag blok besar — cegah pemindaian kuadratik, pastikan tiap
// seat preview tampil tepat sekali, dan hasil cocok oracle brute-force.

function docBigBlock(): ReturnType<typeof emptyVenue> {
  const base = emptyVenue();
  const cat = base.categories[0];
  const section: VenueObject = {
    id: 'sec', kind: 'section', label: 'Sec',
    points: [[0, 0], [6000, 0], [6000, 6000], [0, 6000]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: cat.id,
  };
  // Satu objek 60x200 = 12.000 seat dalam section total 20.000 (sisa 8.000).
  const bigSeats = Array.from({ length: 12000 }, (_, i) => {
    const cc = i % 200; const rr = Math.floor(i / 200);
    return {
      id: `big-${i}`, row: 'B', number: String(i + 1),
      x: 80 + cc * 26, y: 80 + rr * 34,
      status: 'available' as const, price: cat.price, sectionId: 'sec', radius: 8,
    };
  });
  const big: VenueObject = {
    id: 'big', kind: 'row-straight', label: 'Blok raksasa',
    points: [[80, 80]], closed: false, width: 28, price: cat.price,
    rowParams: null, seats: bigSeats, source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'sec',
  };
  const smallSeats = Array.from({ length: 8000 }, (_, i) => ({
    id: `s-${i}`, row: 'S', number: String(i + 1),
    x: 80 + (i % 50) * 26, y: 3000 + Math.floor(i / 50) * 34,
    status: 'available' as const, price: cat.price, sectionId: 'sec', radius: 8,
  }));
  const small: VenueObject = {
    id: 'small', kind: 'row-straight', label: 'Kecil',
    points: [[80, 3000]], closed: false, width: 28, price: cat.price,
    rowParams: null, seats: smallSeats, source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'sec',
  };
  return { ...base, objects: [section, big, small] };
}

describe('drag blok besar 12.000 seat (temuan #3)', () => {
  it('viewport culling + preview-dari-luar: tiap seat tepat sekali, cocok oracle', () => {
    const doc = docBigBlock();
    const idx = getDocIndex(doc);
    const v = { x: 0, y: 0, w: 2000, h: 2000 };
    const m = 16;
    const refs = queryBoxVisible(idx, v.x - m, v.y - m, v.x + v.w + m, v.y + v.h + m, []);
    // Simulasi preview geser +200px: gabung basis + preview-dari-luar via Set O(1).
    const dx = 200;
    const refIds = new Set(refs.map((r) => r.seat.id));
    const seen = new Set<string>();
    for (const r of refs) {
      if (r.seat.sectionId !== 'sec') continue;
      seen.add(r.seat.id);
    }
    const big = idx.objectById.get('big')!;
    for (const s of big.seats) {
      const px = s.x + dx;
      if (px < v.x - m || px > v.x + v.w + m) continue;
      if (s.y < v.y - m || s.y > v.y + v.h + m) continue;
      if (refIds.has(s.id)) continue;
      seen.add(s.id);
    }
    // Oracle brute-force (semantik queryBoxVisible): lingkaran menyentuh
    // viewport diperluas, ATAU preview (pusat) dalam viewport diperluas.
    const oracle = new Set<string>();
    for (const o of doc.objects) {
      for (const s of o.seats) {
        if (s.sectionId !== 'sec') continue;
        const r = 8;
        const inBase = s.x + r >= v.x - m && s.x - r <= v.x + v.w + m && s.y + r >= v.y - m && s.y - r <= v.y + v.h + m;
        const inPrev = o.id === 'big' && (s.x + dx) >= v.x - m && (s.x + dx) <= v.x + v.w + m && s.y >= v.y - m && s.y <= v.y + v.h + m;
        if (inBase || inPrev) oracle.add(s.id);
      }
    }
    // Basis + tambahan preview-dari-luar = oracle, tanpa duplikat.
    // Karena refs memakai overlap (radius), seen harus sama dengan oracle.
    // Bandingkan via ukuran + subset (urutan Set tak relevan).
    expect(seen.size).toBe(oracle.size);
    for (const id of seen) expect(oracle.has(id)).toBe(true);
  });

  it('lintas batas viewport: seat besar di tepi tetap dihitung', () => {
    const doc = docBigBlock();
    const idx = getDocIndex(doc);
    // Geser viewport ke tengah blok.
    const v = { x: 2500, y: 500, w: 1000, h: 1000 };
    const refs = queryBoxVisible(idx, v.x, v.y, v.x + v.w, v.y + v.h, []);
    expect(refs.length).toBeGreaterThan(0);
    const brute = doc.objects.flatMap((o) => o.seats).filter((s) => {
      const r = s.radius ?? 8;
      return s.x + r >= v.x && s.x - r <= v.x + v.w && s.y + r >= v.y && s.y - r <= v.y + v.h;
    });
    expect(refs.length).toBe(brute.length);
  });
});
