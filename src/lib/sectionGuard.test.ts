import { describe, it, expect } from 'vitest';
import { markEligibility } from './panelContext';
import { sectionGeomFor } from './contain';
import { makeObject, normalizeSectionFlags } from './venue';
import { parseVenueJson, validateVenueDoc } from './validate';

function poly(kind: string, seats = 0) {
  const o = makeObject({ kind: kind as never, label: kind });
  o.closed = true;
  o.points = [[0, 0], [100, 0], [100, 100], [0, 100]];
  o.seats = seats > 0
    ? [{ id: 's1', row: 'A', number: '1', x: 50, y: 50, status: 'available', price: 0, sectionId: null }]
    : [];
  return o;
}

describe('section guard: hanya area tertutup tanpa kursi', () => {
  it('stage/aisle/row/draf ditolak; polygon & vektor tertutup diterima', () => {
    expect(markEligibility(poly('stage')).ok).toBe(false);
    expect(markEligibility(poly('aisle')).ok).toBe(false);
    expect(markEligibility(poly('row-straight')).ok).toBe(false);
    expect(markEligibility(poly('row-arc')).ok).toBe(false);
    expect(markEligibility(poly('import-draft')).ok).toBe(false);
    expect(markEligibility(poly('section')).ok).toBe(true);
    expect(markEligibility({ kind: 'vector', d: 'M0 0H100V100H0Z' }).ok).toBe(true);
    expect(markEligibility({ kind: 'vector', d: 'M0 0H100V100' }).ok).toBe(false);
  });

  it('normalize melucuti flag tak valid dokumen lama (keputusan: strip, bukan hapus objek)', () => {
    const stage = poly('stage'); stage.isSection = true;
    const aisle = poly('aisle'); aisle.isSection = true;
    const row = poly('row-straight'); row.isSection = true;
    const draft = poly('import-draft'); draft.isSection = true;
    const withSeats = poly('section', 1); withSeats.isSection = true;
    const ok = poly('section'); ok.isSection = true;
    const { objects, stripped } = normalizeSectionFlags([stage, aisle, row, draft, withSeats, ok]);
    expect(stripped).toHaveLength(5);
    expect(objects.filter((o) => o.isSection)).toHaveLength(1);
    expect(objects.every((o) => o.points.length > 0)).toBe(true);
  });

  it('geometri stage ber-flag tak menghasilkan section (kursi tak bisa valid di dalamnya)', () => {
    const stage = poly('stage'); stage.isSection = true;
    expect(sectionGeomFor(stage)).toBeNull();
    const draft = poly('import-draft'); draft.isSection = true;
    expect(sectionGeomFor(draft)).toBeNull();
  });

  it('impor JSON lama ber-flag tak valid tetap dibuka dengan flag dilucuti', () => {
    const stage = poly('stage'); stage.isSection = true;
    const text = JSON.stringify({ id: 'v', name: 'lama', units: 'px', width: 800, height: 600, backgroundImage: null, objects: [stage] });
    const { doc, errors } = parseVenueJson(text);
    expect(errors).toEqual([]);
    expect(doc!.objects[0].isSection).toBe(false);
  });

  it('validasi menolak flag tak valid pada dokumen baru', () => {
    const stage = poly('stage'); stage.isSection = true;
    const v = validateVenueDoc({ id: 'v', name: 'x', units: 'px', width: 1, height: 1, backgroundImage: null, objects: [stage] });
    expect(v.ok).toBe(false);
  });
});
