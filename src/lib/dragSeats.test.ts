import { describe, expect, it } from 'vitest';
import { dragSeatLayout } from './dragSeats';
import { classifySeats } from './contain';
const form = {mode:'arc' as const,rows:3,seatsPerRow:12,seatGap:26,rowGap:34,angleDeg:45,radius:230,spanDeg:140,startDeg:20,rowLabelOffset:0};
describe('drag seat layout', () => {
 it('makes a single horizontal row regardless of the click mode and counts', () => {
  const r = dragSeatLayout([20,20],[98,20],form,1);
  expect(r.params).toMatchObject({mode:'straight',rows:1,seatsPerRow:4,angleDeg:0});
  expect(r.seats.map(s => [s.x,s.y])).toEqual([[20,20],[46,20],[72,20],[98,20]]);
 });
 it('adds rows to fill the dragged rectangle', () => {
  const r = dragSeatLayout([20,20],[98,88],form,1);
  expect(r.params.rows).toBe(3);
  expect(r.seats).toHaveLength(12);
  expect(r.seats.at(-1)).toMatchObject({row:'C',number:'4',x:98,y:88});
 });
 it('supports left/up drags while keeping labels in creation order', () => {
  const r = dragSeatLayout([98,88],[20,20],form,1);
  expect(r.seats).toHaveLength(12);
  expect(r.seats[0]).toMatchObject({row:'A',number:'1',x:98,y:88});
  expect(r.seats.at(-1)).toMatchObject({row:'C',number:'4',x:20,y:20});
 });
 it('supports vertical-only and compact section layouts', () => {
  expect(dragSeatLayout([20,20],[20,88],form,1).seats).toHaveLength(3);
  const compact = dragSeatLayout([20,20],[29.75,28.5],form,0.125);
  expect(compact.seats).toHaveLength(12);
  expect(compact.params.seatGap).toBe(3.25);
 });
 it('keeps previews bounded even for an enormous drag', () => {
  const r = dragSeatLayout([0,0],[1e9,1e9],form,0.001);
  expect(r.limited).toBe(true);
  expect(r.seats).toHaveLength(12000);
 });
 it('excludes seats whose full footprint intersects a boundary or hole', () => {
  const r = dragSeatLayout([10,10],[88,78],form,1);
  const geom = {rings:[[[0,0],[100,0],[100,100],[0,100]],[[30,0],[60,0],[60,100],[30,100]]],rule:'evenodd' as const};
  const valid = classifySeats(r.seats,geom as Parameters<typeof classifySeats>[1],8);
  expect(valid.filter(Boolean)).toHaveLength(6);
 });
});
