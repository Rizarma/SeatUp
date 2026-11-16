import React from 'react';
import type { LucideIcon } from 'lucide-react';

/** Field angka generik untuk panel. Satu sumber agar label/input konsisten. */
export function Num({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <label className="fld"><span>{label}</span>
      <input
        type="number" value={value} min={min} max={max} step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** Header konteks panel (ikon + judul + sub). */
export function CtxHead({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) {
  return (
    <div className="ctxhead ctxhead--stable">
      <span className="ctxicon" aria-hidden="true"><Icon size={18} strokeWidth={2} /></span>
      <div className="ctxtext">
        <p className="ctxtitle"><span className="ell" title={title}>{title}</span></p>
        <p className="muted ctxsub" title={sub}>{sub}</p>
      </div>
    </div>
  );
}

/** Grup collapsible untuk tab Objek. */
export function ObjGroup({ title, openDefault, children }: { title: string; openDefault?: boolean; children: React.ReactNode }) {
  return (
    <details className="ogrp" open={openDefault}>
      <summary>{title}</summary>
      <div className="ogrp-body">{children}</div>
    </details>
  );
}
