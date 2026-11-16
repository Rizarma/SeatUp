import type { Pt, Seat, VenueObject } from './venue';
import { discInside, resolvedPoints, SEAT_R, sectionGeomFor } from './contain';

export interface SeatTransform { rotation: number; skewX: number; skewY: number; scaleX: number; scaleY: number; dx: number; dy: number }
export const IDENTITY_TRANSFORM: SeatTransform = { rotation: 0, skewX: 0, skewY: 0, scaleX: 100, scaleY: 100, dx: 0, dy: 0 };

export function transformSeats(seats: Seat[], transform: SeatTransform): Seat[] {
  if (!seats.length) return seats;
  if (!Object.values(transform).every(Number.isFinite) || transform.scaleX <= 0 || transform.scaleY <= 0 || Math.abs(transform.skewX) >= 85 || Math.abs(transform.skewY) >= 85) throw new Error('Nilai transformasi tidak valid. Skew harus antara -84° dan 84°.');
  if (Math.abs(1 - Math.tan(transform.skewX * Math.PI / 180) * Math.tan(transform.skewY * Math.PI / 180)) < 0.01) throw new Error('Kombinasi skew ini meratakan susunan menjadi garis. Ubah salah satu sudut.');
  const cx = (Math.min(...seats.map(s => s.x)) + Math.max(...seats.map(s => s.x))) / 2;
  const cy = (Math.min(...seats.map(s => s.y)) + Math.max(...seats.map(s => s.y))) / 2;
  const rad = Math.PI / 180, angle = transform.rotation * rad;
  return seats.map(seat => {
    const x = (seat.x - cx) * transform.scaleX / 100, y = (seat.y - cy) * transform.scaleY / 100;
    const sx = x + Math.tan(transform.skewX * rad) * y, sy = y + Math.tan(transform.skewY * rad) * x;
    return { ...seat, x: cx + sx * Math.cos(angle) - sy * Math.sin(angle) + transform.dx, y: cy + sx * Math.sin(angle) + sy * Math.cos(angle) + transform.dy };
  });
}

/** Lay out existing rows on safe horizontal spans; holes are excluded by full-disc checks. */
export function fitSeatsToShape(objects: VenueObject[], target: VenueObject, gap: number, margin: number): Map<string, Seat> {
  const section = target.isSection ? target : objects.find(o => o.id === target.sectionId);
  const geom = section && sectionGeomFor(section);
  if (!geom) throw new Error('Pilih baris yang terhubung ke section atau pilih section tertutup.');
  const targetSeats = target.isSection ? objects.flatMap(o => o.seats.filter(s => s.sectionId === target.id)) : target.seats;
  if (!targetSeats.length) throw new Error('Belum ada kursi untuk disesuaikan.');
  const seatRadius = Math.max(...targetSeats.map(s => s.radius ?? SEAT_R));
  if (!Number.isFinite(gap) || gap < seatRadius * 2 || !Number.isFinite(margin) || margin < 0) throw new Error(`Jarak pusat kursi minimal ${seatRadius * 2} px dan margin minimal 0 px.`);
  const targetIds = new Set(targetSeats.map(s => s.id));
  const obstacles = objects.flatMap(o => o.seats).filter(s => !targetIds.has(s.id));
  const aisles = objects.filter(o => o.kind === 'aisle');
  function clearOfAisles(x: number, y: number): boolean {
    // Lorong terputar ikut sebagai penghalang (koordinat kanvas hasil resolve).
    return aisles.every(aisle => {
      const pts = resolvedPoints(aisle);
      return pts.slice(1).every((end, i) => {
        const start = pts[i];
        const dx = end[0]-start[0], dy = end[1]-start[1];
        const length = dx*dx+dy*dy;
        const t = length ? Math.max(0, Math.min(1, ((x-start[0])*dx+(y-start[1])*dy)/length)) : 0;
        return Math.hypot(x-start[0]-t*dx, y-start[1]-t*dy) >= seatRadius + margin + aisle.width/2;
      });
    });
  }
  const groups = new Map<string, Seat[]>();
  for (const object of objects) for (const seat of object.seats) {
    if (!targetIds.has(seat.id)) continue;
    const key = `${object.id}:${seat.row}`;
    const row = groups.get(key) ?? [];
    row.push(seat); groups.set(key, row);
  }
  const rows = [...groups.values()].sort((a, b) => a.reduce((n,s) => n+s.y,0)/a.length - b.reduce((n,s) => n+s.y,0)/b.length);
  const points = geom.rings.flat();
  const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
  const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
  const radius = seatRadius + margin;
  // Bounded scan resolution for large imported SVGs.
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  let step = Math.max(Math.min(2, seatRadius / 2), spanX / 600, spanY / 600);
  // P3: batasi total sel grid agar section raksasa/kompleks tak freeze UI.
  const MAX_CELLS = 250000;
  const estCols = (spanX - 2 * radius) / step + 1;
  const estRows = (spanY - 2 * radius) / step + 1;
  const estCells = estCols * estRows;
  if (Number.isFinite(estCells) && estCells > MAX_CELLS && estCells > 0) {
    step *= Math.sqrt(estCells / MAX_CELLS);
  }
  const candidates: { y: number; xs: number[] }[] = [];
  for (let y = minY + radius; y <= maxY - radius; y += step) {
    const xs: number[] = [];
    for (let x = minX + radius; x <= maxX - radius; x += step) {
      if (discInside(x, y, radius, geom) && clearOfAisles(x,y) && obstacles.every(s => Math.hypot(s.x-x,s.y-y) >= Math.max(gap, seatRadius + (s.radius ?? SEAT_R)))) xs.push(x);
    }
    if (xs.length) candidates.push({ y, xs });
  }
  const result = new Map<string, Seat>();
  let previousY = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idealY = minY + (maxY-minY) * (i+1)/(rows.length+1);
    const options = candidates.filter(c => c.y >= previousY + gap).sort((a,b) => Math.abs(a.y-idealY)-Math.abs(b.y-idealY));
    let placed = false;
    for (const candidate of options) {
      const slots: Pt[] = [];
      for (const x of candidate.xs) if (!slots.length || x - slots[slots.length-1][0] >= gap) slots.push([x,candidate.y]);
      if (slots.length < row.length) continue;
      // Spread seats across all usable spans without putting seats in gaps or holes.
      row.sort((a,b) => a.number.localeCompare(b.number, undefined, { numeric:true }));
      row.forEach((seat,j) => {
        const index = row.length === 1 ? Math.floor(slots.length/2) : Math.round(j*(slots.length-1)/(row.length-1));
        result.set(seat.id, { ...seat, x:slots[index][0], y:slots[index][1] });
      });
      previousY = candidate.y; placed = true; break;
    }
    if (!placed) throw new Error('Susunan belum bisa dimuat dengan jarak dan margin ini. Kurangi jarak/margin, ubah jumlah baris, atau gunakan mode manual. Tidak ada kursi diubah.');
  }
  return result;
}
