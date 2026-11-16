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

/**
 * Input teks yang commit sekali (blur/Enter), bukan tiap ketikan.
 * Mencegah banjir history undo saat edit label objek.
 */
export function CommittedText({ label, value, onCommit, ariaLabel }: {
  label: string; value: string; onCommit: (v: string) => void; ariaLabel?: string;
}) {
  const [draft, setDraft] = React.useState(value);
  const lastProp = React.useRef(value);
  if (lastProp.current !== value) {
    lastProp.current = value;
    if (draft !== value) setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="fld"><span>{label}</span>
      <input
        value={draft} aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(value);
        }}
      />
    </label>
  );
}

/**
 * Input angka yang commit sekali (blur/Enter). Nilai invalid diabaikan
 * dan dikembalikan ke prop terakhir agar store tidak kena NaN.
 */
export function CommittedNum({ label, value, onCommit, min, max, step, ariaLabel }: {
  label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; ariaLabel?: string;
}) {
  const [draft, setDraft] = React.useState(String(value));
  const lastProp = React.useRef(value);
  if (lastProp.current !== value) {
    lastProp.current = value;
    if (draft !== String(value)) setDraft(String(value));
  }
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
    else if (draft !== String(value)) setDraft(String(value));
  };
  return (
    <label className="fld"><span>{label}</span>
      <input
        type="number" value={draft} min={min} max={max} step={step ?? 1} aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(String(value));
        }}
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

/**
 * Debounce nilai (mis. kata kunci pencarian) agar filter/re-render berat
 * hanya jalan setelah user berhenti mengetik. Input tetap responsif karena
 * yang di-debounce adalah nilainya, bukan controlled input-nya.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), Math.max(0, delayMs));
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
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
