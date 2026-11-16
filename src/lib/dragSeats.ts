import type { Pt, RowParams } from './venue';
import { straightSeats } from './venue';

/** Drag starts at the first seat centre; directions follow the pointer. */
export function dragSeatLayout(start: Pt, end: Pt, form: RowParams, scale: number) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const seatGap = Math.max(16, Number.isFinite(form.seatGap) ? form.seatGap : 26) * safeScale;
  const rowGap = Math.max(16, Number.isFinite(form.rowGap) ? form.rowGap : 34) * safeScale;
  const requestedColumns = Math.floor(Math.abs(end[0] - start[0]) / seatGap + 1e-6) + 1;
  const requestedRows = Math.floor(Math.abs(end[1] - start[1]) / rowGap + 1e-6) + 1;
  const seatsPerRow = Math.min(200, requestedColumns);
  const rows = Math.min(60, requestedRows);
  const params = { ...form, mode: 'straight' as const, angleDeg: 0, rows, seatsPerRow, seatGap, rowGap };
  const dx = end[0] < start[0] ? -1 : 1;
  const dy = end[1] < start[1] ? -1 : 1;
  const seats = straightSeats([0, 0], 0, rows, seatsPerRow, seatGap, rowGap, form.rowLabelOffset)
    .map(s => ({ ...s, x: start[0] + s.x * dx, y: start[1] + s.y * dy }));
  return { seats, params, limited: requestedColumns > seatsPerRow || requestedRows > rows };
}
