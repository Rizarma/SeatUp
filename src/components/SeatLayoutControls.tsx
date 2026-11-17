import { useState } from 'react';
import type { VenueObject } from '../lib/venue';
import { useStore } from '../store';
import { fitSeatsToShape, IDENTITY_TRANSFORM, transformSeats } from '../lib/seatLayout';
import type { SeatTransform } from '../lib/seatLayout';

export default function SeatLayoutControls({ target }: { target: VenueObject }) {
  const { state, update } = useStore();
  const [mode, setMode] = useState('manual');
  const [transform, setTransform] = useState({ ...IDENTITY_TRANSFORM });
  const seats = target.isSection ? state.doc.objects.flatMap(o => o.seats.filter(s => s.sectionId === target.id)) : target.seats;
  const seatRadius = seats.length ? Math.max(...seats.map(s => s.radius ?? 8)) : 8;
  const [gap, setGap] = useState(() => seatRadius * 3);
  const [margin, setMargin] = useState(() => seatRadius / 2);
  const [message, setMessage] = useState('');

  const manualPairs: [keyof SeatTransform, string, number, number][][] = [
    [['rotation', 'Rotate (°)', -360, 360], ['skewX', 'Skew X (°)', -84, 84]],
    [['skewY', 'Skew Y (°)', -84, 84], ['scaleX', 'Skala X (%)', 1, 1000]],
    [['scaleY', 'Skala Y (%)', 1, 1000], ['dx', 'Geser X (px)', -10000, 10000]],
    [['dy', 'Geser Y (px)', -10000, 10000]],
  ];
  function apply() {
    try {
      const changed = mode === 'fit' ? fitSeatsToShape(state.doc.objects, target, gap, margin) : new Map(transformSeats(seats, transform).map(s => [s.id,s]));
      update(doc => ({ ...doc, objects: doc.objects.map(o => ({ ...o, seats: o.seats.map(s => changed.get(s.id) ?? s) })) }));
      setTransform({ ...IDENTITY_TRANSFORM });
      setMessage(`${changed.size} kursi disesuaikan. Gunakan Urungkan untuk mengembalikan susunan sebelumnya.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Susunan tidak dapat diterapkan.'); }
  }
  return <section className="seat-layout-controls" aria-label="Atur susunan kursi">
    <h4 className="subh">Atur susunan kursi</h4>
    <p className="muted">Target: {seats.length} kursi{target.isSection ? ' dalam section ini' : ' dalam kelompok baris ini'}. Bentuk section tetap.</p>
    <label className="fld"><span>Pengaturan</span><select value={mode} onChange={e => { setMode(e.target.value); setMessage(''); }}><option value="manual">Manual</option><option value="fit">Fit to shape</option></select></label>
    {mode === 'manual' ? <>
      {manualPairs.map((pair, i) => (
        <div className="frow" key={i}>
          {pair.map(([key,label,min,max]) => <label className="fld" key={key}><span>{label}</span><input type="number" min={min} max={max} value={transform[key]} onChange={e => setTransform({ ...transform, [key]:Number(e.target.value) })} /></label>)}
        </div>
      ))}
    </> : <>
      <div className="frow">
        <label className="fld"><span>Jarak minimum (px)</span><input type="number" min={seatRadius * 2} step="any" value={gap} onChange={e => setGap(Number(e.target.value))} /></label>
        <label className="fld"><span>Margin batas (px)</span><input type="number" min={0} step="any" value={margin} onChange={e => setMargin(Number(e.target.value))} /></label>
      </div>
      <p className="muted">Baris horizontal mengikuti lebar bentuk section, menghindari lubang, lorong, dan kursi lain. ID, label, harga, dan jumlah kursi tetap. Bentuk rumit mungkin perlu penyesuaian manual.</p>
    </>}
    <button className="apply-primary" disabled={!seats.length} onClick={apply}>{mode === 'fit' ? 'Terapkan fit to shape' : 'Terapkan transformasi'}</button>
    {message && <p className="tool-stat" role="status">{message}</p>}
  </section>;
}
