import { describe, expect, it } from 'vitest';
import { fitSeatsToShape, transformSeats, IDENTITY_TRANSFORM } from './seatLayout';
import { discInside, sectionGeomFor } from './contain';
import type { VenueObject, Seat } from './venue';
const seats: Seat[] = Array.from({length:6},(_,i) => ({id:`s${i}`,row:i<3?'A':'B',number:String(i%3+1),x:30+i%3*24,y:40+Math.floor(i/3)*24,status:'available',price:100,sectionId:'section'}));
const section: VenueObject = {id:'section',kind:'section',label:'Section',points:[[0,0],[200,0],[140,160],[60,160]],closed:true,isSection:true,width:0,price:100,rowParams:null,seats:[],source:{origin:'canvas',confidence:1},guess:null};
const row: VenueObject = {...section,id:'row',kind:'row-straight',isSection:false,sectionId:section.id,seats};
describe('seat layout',()=>{
 it('rotates about the centre, preserving identity and metadata',()=>{
  const result=transformSeats(seats,{...IDENTITY_TRANSFORM,rotation:180});
  expect(result[0].x).toBeCloseTo(78); expect(result[0].y).toBeCloseTo(64);
  expect(result.map(s=>s.id)).toEqual(seats.map(s=>s.id)); expect(result[0].price).toBe(100);
 });
 it('skews and scales before translating',()=>{
  const result=transformSeats(seats,{...IDENTITY_TRANSFORM,scaleX:200,skewX:45,dx:10});
  expect(result[0].x).toBeCloseTo(4); expect(result[0].y).toBe(40);
 });
 it('rejects singular skew and nonfinite transforms',()=>{
  expect(()=>transformSeats(seats,{...IDENTITY_TRANSFORM,skewX:90})).toThrow();
  expect(()=>transformSeats(seats,{...IDENTITY_TRANSFORM,dx:Infinity})).toThrow();
 });
 it('fits a tapered section without changing IDs or overlapping seats',()=>{
  const result=[...fitSeatsToShape([section,row],section,24,4).values()];
  expect(result).toHaveLength(6);
  expect(new Set(result.map(s=>s.id))).toEqual(new Set(seats.map(s=>s.id)));
  expect(result.every(s=>discInside(s.x,s.y,12,sectionGeomFor(section)!))).toBe(true);
  result.forEach((a,i)=>result.slice(i+1).forEach(b=>expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThanOrEqual(24-1e-8)));
 });
 it('excludes holes in SVG geometry',()=>{
  const holed: VenueObject={...section,kind:'vector',d:'M0 0H200V160H0Z M70 20H130V140H70Z',svgFillRule:'evenodd'};
  const result=[...fitSeatsToShape([holed,row],holed,24,2).values()];
  expect(result.every(s=>discInside(s.x,s.y,10,sectionGeomFor(holed)!))).toBe(true);
 });
 it('keeps the aisle clear',()=>{
  const aisle: VenueObject={...section,id:'aisle',kind:'aisle',isSection:false,points:[[100,0],[100,160]],width:20};
  const result=[...fitSeatsToShape([section,row,aisle],section,24,4).values()];
  expect(result.every(s=>Math.abs(s.x-100)>=22)).toBe(true);
 });
 it('fails atomically if seats cannot fit',()=>{
  const original=structuredClone(row);
  expect(()=>fitSeatsToShape([section,row],section,200,4)).toThrow();
  expect(row).toEqual(original);
 });
});

 it('fits compact section seats using their persisted radius', () => {
  const compact = {...row,seats:seats.map(s => ({...s,radius:1}))};
  const result = [...fitSeatsToShape([section,compact],compact,3,0.5).values()];
  expect(result).toHaveLength(6);
  expect(result.every(s => discInside(s.x,s.y,1.5,sectionGeomFor(section)!))).toBe(true);
 });
