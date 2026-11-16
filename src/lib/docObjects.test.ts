import { describe, expect, it } from 'vitest';
import { emptyVenue, makeObject } from './venue';
import { withAddedObject, withObject, withoutObject } from './docObjects';

describe('docObjects', () => {
  it('withObject patch parsial', () => {
    const doc = emptyVenue();
    const obj = makeObject({ kind: 'stage', label: 'Panggung' });
    const added = withAddedObject(doc, obj);
    const renamed = withObject(added, obj.id, { label: 'Panggung Utama' });
    expect(renamed.objects.find((o) => o.id === obj.id)?.label).toBe('Panggung Utama');
    expect(added.objects.find((o) => o.id === obj.id)?.label).toBe('Panggung');
  });
  it('withoutObject menghapus', () => {
    const doc = emptyVenue();
    const obj = makeObject({ kind: 'stage', label: 'Panggung' });
    const added = withAddedObject(doc, obj);
    expect(withoutObject(added, obj.id).objects).toHaveLength(0);
  });
});
