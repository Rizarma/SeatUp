import React, { createContext, useCallback, useContext, useMemo, useReducer } from 'react';
import type { VenueDoc } from './lib/venue';
import { emptyVenue } from './lib/venue';
import { revalidateSeats } from './lib/contain';

export type Tool = 'hand' | 'select' | 'seat' | 'polygon' | 'stage' | 'rectangle' | 'circle' | 'aisle' | 'row';

interface State {
  doc: VenueDoc;
  past: VenueDoc[];
  future: VenueDoc[];
  selectedId: string | null;
  selectedSeatIds: string[];
  tool: Tool;
  dirty: boolean;
}

type Action =
  | { t: 'commit'; doc: VenueDoc }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'select'; id: string | null }
  | { t: 'seats'; ids: string[] }
  | { t: 'tool'; tool: Tool }
  | { t: 'load'; doc: VenueDoc }
  | { t: 'saved' };

const MAX_HISTORY = 60;

function clone(d: VenueDoc): VenueDoc {
  return structuredClone(d);
}

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'commit': {
      const rev = revalidateSeats(a.doc.objects);
      const doc = rev.objects === a.doc.objects ? a.doc : { ...a.doc, objects: rev.objects };
      const alive = new Set(doc.objects.flatMap((o) => o.seats.map((x) => x.id)));
      return {
        ...s,
        doc,
        past: [...s.past.slice(-MAX_HISTORY + 1), clone(s.doc)],
        future: [],
        dirty: true,
        selectedSeatIds: s.selectedSeatIds.filter((id) => alive.has(id)),
      };
    }
    case 'undo': {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      return {
        ...s,
        doc: prev,
        past: s.past.slice(0, -1),
        future: [clone(s.doc), ...s.future],
        selectedId: null,
        selectedSeatIds: [],
        dirty: true,
      };
    }
    case 'redo': {
      if (s.future.length === 0) return s;
      const [next, ...rest] = s.future;
      return {
        ...s,
        doc: next,
        past: [...s.past, clone(s.doc)],
        future: rest,
        selectedId: null,
        selectedSeatIds: [],
        dirty: true,
      };
    }
    case 'select':
      return { ...s, selectedId: a.id };
    case 'seats':
      return { ...s, selectedSeatIds: a.ids };
    case 'tool':
      return { ...s, tool: a.tool };
    case 'load': {
      const rev = revalidateSeats(a.doc.objects);
      return {
        doc: rev.objects === a.doc.objects ? a.doc : { ...a.doc, objects: rev.objects },
        past: [], future: [], selectedId: null, selectedSeatIds: [], tool: 'select', dirty: false,
      };
    }
    case 'saved':
      return { ...s, dirty: false };
    default:
      return s;
  }
}

interface Store {
  state: State;
  update: (fn: (doc: VenueDoc) => VenueDoc) => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  selectSeats: (ids: string[]) => void;
  setTool: (tool: Tool) => void;
  loadDoc: (doc: VenueDoc) => void;
  markSaved: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    doc: emptyVenue(),
    past: [],
    future: [],
    selectedId: null,
    selectedSeatIds: [],
    tool: 'select',
    dirty: false,
  });
  const update = useCallback((fn: (doc: VenueDoc) => VenueDoc) => {
    dispatch({ t: 'commit', doc: fn(clone(state.doc)) });
  }, [state.doc]);
  const value = useMemo<Store>(() => ({
    state,
    update,
    undo: () => dispatch({ t: 'undo' }),
    redo: () => dispatch({ t: 'redo' }),
    select: (id) => dispatch({ t: 'select', id }),
    selectSeats: (ids) => dispatch({ t: 'seats', ids }),
    setTool: (tool) => dispatch({ t: 'tool', tool }),
    loadDoc: (doc) => dispatch({ t: 'load', doc }),
    markSaved: () => dispatch({ t: 'saved' }),
  }), [state, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore di luar provider');
  return v;
}
