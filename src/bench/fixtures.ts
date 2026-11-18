import type { SeatStatus, VenueDoc, VenueObject } from '../lib/venue';
import { emptyVenue, uid } from '../lib/venue';

/**
 * Fixture deterministik untuk benchmark (seeded PRNG — hasil stabil antar run).
 * Satu section bisa menampung >10.000 seat sesuai target penerimaan.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FixtureOpts {
  /** jumlah section */
  sections: number;
  /** baris per section */
  rowsPerSection: number;
  /** kursi per baris */
  seatsPerRow: number;
  seatGap?: number;
  rowGap?: number;
  /** 'rect' = polygon sederhana, 'complex' = section vector berkurva */
  sectionKind?: 'rect' | 'complex';
  /** campuran status deterministik */
  mixedStatus?: boolean;
  seed?: number;
  /** bila diisi: baris pertama diganti blok raksasa berisi N seat (untuk uji drag 12k). */
  bigRowSeats?: number;
}

/** Path stadion ( gutes kurva ): cocok untuk uji flatten + containment kompleks. */
export function stadiumPath(w: number, h: number): string {
  const r = h / 2;
  return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}

export function makeBenchDoc(opts: FixtureOpts): VenueDoc {
  const {
    sections, rowsPerSection, seatsPerRow,
    seatGap = 26, rowGap = 34,
    sectionKind = 'rect', mixedStatus = true, seed = 42,
    bigRowSeats = 0,
  } = opts;
  const rnd = mulberry32(seed);
  const base = emptyVenue();
  base.name = `Bench ${sections}×${rowsPerSection}×${seatsPerRow} (${sectionKind})`;
  const cat = base.categories[0];
  const objects: VenueObject[] = [];
  // Bentang section disusun horizontal dengan celah 200.
  // Blok raksasa butuh section lebih besar agar footprint tetap valid.
  const bigCols = bigRowSeats > 0 ? (bigRowSeats > 1000 ? 200 : bigRowSeats) : 0;
  const bigRows = bigRowSeats > 0 ? Math.ceil(bigRowSeats / Math.max(1, bigCols)) : 0;
  const secW = Math.max(seatsPerRow * seatGap, bigCols * seatGap) + 160;
  const secH = rowsPerSection * rowGap + bigRows * rowGap + 160;
  for (let si = 0; si < sections; si++) {
    const ox = si * (secW + 200);
    const isComplex = sectionKind === 'complex';
    const sectionId = `bench-section-${si}`;
    if (isComplex) {
      objects.push({
        id: sectionId, kind: 'vector', label: `Section ${String.fromCharCode(65 + si)}`,
        points: [], d: stadiumPath(secW, secH), closed: true, width: 28, price: 0,
        rowParams: null, seats: [],
        vTransform: { tx: ox, ty: 0, scale: 1 }, svgFillRule: 'evenodd',
        source: { origin: 'canvas', confidence: 1 }, guess: null,
        isSection: true, categoryId: cat.id, color: cat.color,
      });
    } else {
      objects.push({
        id: sectionId, kind: 'section', label: `Section ${String.fromCharCode(65 + si)}`,
        points: [[ox, 0], [ox + secW, 0], [ox + secW, secH], [ox, secH]],
        closed: true, width: 28, price: 0, rowParams: null, seats: [],
        source: { origin: 'canvas', confidence: 1 }, guess: null,
        isSection: true, categoryId: cat.id, color: cat.color,
      });
    }
    // Kursi grid di dalam section (margin 80 agar footprint selalu valid).
    let n = 0;
    for (let r = 0; r < rowsPerSection; r++) {
      // Baris pertama dapat diganti blok raksasa (mis. 60x200 = 12.000 seat
      // dalam SATU objek) untuk uji drag blok besar tanpa 12k baris.
      const colsThisRow = bigRowSeats > 0 && r === 0 ? bigRowSeats : seatsPerRow;
      const seats = [];
      const yBase = 80 + r * rowGap + (bigRowSeats > 0 && r > 0 ? bigRows * rowGap : 0);
      for (let c = 0; c < colsThisRow; c++) {
        const perRow = colsThisRow > 1000 ? 200 : colsThisRow;
        const rr = Math.floor(c / perRow);
        const cc = c % perRow;
        const x = ox + 80 + cc * seatGap;
        const y = yBase + rr * rowGap;
        let status: SeatStatus = 'available';
        if (mixedStatus) {
          const v = rnd();
          status = v < 0.08 ? 'taken' : v < 0.16 ? 'book' : 'available';
        }
        seats.push({
          id: `bench-${si}-${r}-${c}`, row: String.fromCharCode(65 + (r % 26)), number: String(c + 1),
          x, y, status, price: cat.price, sectionId, radius: 8 as number,
        });
        n++;
        void n;
      }
      objects.push({
        id: `bench-row-${si}-${r}`, kind: 'row-straight', label: r === 0 && bigRowSeats > 0 ? `Blok raksasa (${colsThisRow})` : `Baris ${r + 1}`,
        points: [[ox + 80, yBase]], closed: false, width: 28, price: cat.price,
        rowParams: null, seats,
        source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId,
      });
    }
  }
  const doc: VenueDoc = {
    ...base,
    width: Math.max(1200, sections * (secW + 200)),
    height: Math.max(800, secH + 100),
    objects,
  };
  return doc;
}

/** Skenario standar: total seat per dokumen (satu section; matrix 1k/10k/20k/50k + kompleks + memanjang + blok besar). */
export function benchScenarios(): Array<{ name: string; opts: FixtureOpts }> {
  return [
    { name: '1k-rect', opts: { sections: 1, rowsPerSection: 20, seatsPerRow: 50 } },
    { name: '10k-rect', opts: { sections: 1, rowsPerSection: 200, seatsPerRow: 50 } },
    { name: '20k-rect', opts: { sections: 1, rowsPerSection: 400, seatsPerRow: 50 } },
    { name: '50k-rect', opts: { sections: 1, rowsPerSection: 500, seatsPerRow: 100 } },
    { name: '10k-complex', opts: { sections: 1, rowsPerSection: 200, seatsPerRow: 50, sectionKind: 'complex' } },
    // Layout memanjang horizontal: 20 baris x 1000 kursi (20.000, bentang ~26.000px)
    { name: '20k-elongated', opts: { sections: 1, rowsPerSection: 20, seatsPerRow: 1000 } },
    // Blok besar satu objek 12.000 seat (60x200) dalam section total ~20.000:
    // 1 blok raksasa 12.000 + 160 baris x 50 = 8.000 → total 20.000.
    { name: '20k-12kblock', opts: { sections: 1, rowsPerSection: 161, seatsPerRow: 50, seed: 7, bigRowSeats: 12000 } },
  ];
}

/** Ringkasan deterministik untuk verifikasi fixture (checksum murah). */
export function fixtureChecksum(doc: VenueDoc): { seats: number; xSum: number; statusTaken: number } {
  let seats = 0;
  let xSum = 0;
  let statusTaken = 0;
  for (const o of doc.objects) {
    for (const s of o.seats) {
      seats++;
      xSum += s.x;
      if (s.status === 'taken') statusTaken++;
    }
  }
  return { seats, xSum: Math.round(xSum), statusTaken };
}

/** Bangun & kembalikan id section pertama (untuk masuk fokus via API bench). */
export function firstSectionId(doc: VenueDoc): string | null {
  return doc.objects.find((o) => o.isSection)?.id ?? null;
}

export { uid };
