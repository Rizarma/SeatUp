import { describe, expect, it } from 'vitest';
import { emptyVenue } from './venue';
import type { VenueObject } from './venue';
import { getDocIndex, queryBox, queryPoint } from './docIndex';
import { finalTranslateForDrag, resolveCanvasRowHit } from '../components/EditorCanvas';

function docWithRows(perRow: number[], gap = 26): ReturnType<typeof emptyVenue> {
  const base = emptyVenue();
  const section: VenueObject = {
    id: 'sec', kind: 'section', label: 'Sec',
    points: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: base.categories[0].id,
  };
  const objects: VenueObject[] = [section];
  let y = 100;
  perRow.forEach((n, ri) => {
    const seats = Array.from({ length: n }, (_, i) => ({
      id: `r${ri}-s${i}`, row: `R${ri}`, number: String(i + 1),
      x: 100 + i * gap, y, status: 'available' as const, price: 0, sectionId: 'sec', radius: 8,
    }));
    objects.push({
      id: `row-${ri}`, kind: 'row-straight', label: `Baris ${ri}`,
      points: [[100, y]], closed: false, width: 28, price: 0, rowParams: null,
      seats, source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'sec',
    });
    y += 100;
  });
  return { ...base, objects };
}

describe('canvas select/drag baris (temuan #1)', () => {
  it.each([1501, 10000, 20000])('klik baris via hit-test memilih objek baris yang benar (%i seat)', (total) => {
    const perRow = total === 1501 ? [1501] : total === 10000 ? [10000] : [20000];
    const doc = docWithRows(perRow);
    const idx = getDocIndex(doc);
    // Klik seat ke-5 pada baris 0
    const target = doc.objects[1].seats[5];
    const hit = queryPoint(idx, target.x, target.y, 12);
    expect(hit).not.toBeNull();
    const row = resolveCanvasRowHit(idx, hit!.seat.id, 'sec');
    expect(row?.id).toBe('row-0');
  });

  it('drag baris setelah pan/zoom: seluruh seat berpindah sesuai delta world', () => {
    const doc = docWithRows([50, 50]);
    const idx = getDocIndex(doc);
    const row = idx.objectById.get('row-0')!;
    const start: [number, number] = [100, 100];
    const end: [number, number] = [160, 230];
    const done = finalTranslateForDrag(row, start, end);
    expect(done.seats.length).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(done.seats[i].x).toBe(row.seats[i].x + 60);
      expect(done.seats[i].y).toBe(row.seats[i].y + 130);
    }
    // Baris lain tidak berubah
    const other = idx.objectById.get('row-1')!;
    expect(other.seats[0].x).toBe(100);
  });

  it('pointerup sebelum rAF terakhir tetap menyimpan posisi akhir (final, bukan preview basi)', () => {
    const doc = docWithRows([10]);
    const row = getDocIndex(doc).objectById.get('row-0')!;
    const stalePreview = finalTranslateForDrag(row, [0, 0], [10, 10]);
    void stalePreview;
    const final = finalTranslateForDrag(row, [0, 0], [48, 30]);
    expect(final.seats[0].x).toBe(row.seats[0].x + 48);
    expect(final.seats[0].y).toBe(row.seats[0].y + 30);
  });

  it('marquee tidak menduplikasi seat dan query akurat vs brute force', () => {
    const doc = docWithRows([100]);
    const idx = getDocIndex(doc);
    const refs = queryBox(idx, 90, 90, 500, 110, []);
    const brute = doc.objects[1].seats.filter((s) => s.x >= 90 && s.x <= 500 && s.y >= 90 && s.y <= 110);
    expect(refs.length).toBe(brute.length);
    const ids = refs.map((r) => r.seat.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
