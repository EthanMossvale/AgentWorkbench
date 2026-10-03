import type { AppState, Session } from '../contracts';

/**
 * Incremental application-state stream between the desktop host and a window.
 * Only root fields, sessions, session fields and array entries whose object
 * identity changed are sent; the receiver keeps every other object, so
 * presentation caches survive. `base: null` replaces the receiver state; any
 * other base must equal the receiver's revision or the receiver asks for a full
 * resynchronisation.
 */
export interface SessionDelta {
  id: string;
  delta: true;
  fields: Record<string, unknown>;
  removed: string[];
  /** Arrays rebuilt from the previous array: new length plus replaced entries. */
  arrays: Record<string, { length: number; set: [number, unknown][] }>;
}
export interface StatePatch {
  revision: number;
  base: number | null;
  root: Record<string, unknown>;
  removed: string[];
  order: string[];
  sessions: (Session | SessionDelta)[];
}

export interface StatePublisher {
  /** Returns undefined when nothing observable changed since the last patch. */
  next(state: AppState): StatePatch | undefined;
  /** The next patch replaces the receiver state (window reload or resync request). */
  reset(): void;
}

const isDelta = (value: Session | SessionDelta): value is SessionDelta => (value as SessionDelta).delta === true;

function sessionDelta(previous: Session, next: Session): SessionDelta {
  const before = previous as unknown as Record<string, unknown>, after = next as unknown as Record<string, unknown>;
  const delta: SessionDelta = { id: next.id, delta: true, fields: {}, removed: [], arrays: {} };
  for (const key of Object.keys(after)) {
    const value = after[key], old = before[key];
    if (value === old && Object.hasOwn(before, key)) continue;
    if (Array.isArray(value) && Array.isArray(old)) {
      const set: [number, unknown][] = [];
      value.forEach((item, index) => { if (index >= old.length || item !== old[index]) set.push([index, item]); });
      // Rewritten arrays (a full copy upstream) are cheaper to send whole.
      if (set.length * 2 <= value.length) { delta.arrays[key] = { length: value.length, set }; continue; }
    }
    delta.fields[key] = value;
  }
  for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) delta.removed.push(key);
  return delta;
}

export function createStatePublisher(): StatePublisher {
  let revision = 0, full = true, root = new Map<string, unknown>(), sessions = new Map<string, Session>(), order: string[] = [];
  return {
    reset() { full = true; },
    next(state) {
      const { sessions: list, ...rest } = state, values = rest as Record<string, unknown>;
      const changedRoot: Record<string, unknown> = {}, removed: string[] = [];
      for (const key of Object.keys(values)) if (full || !root.has(key) || root.get(key) !== values[key]) changedRoot[key] = values[key];
      if (!full) for (const key of root.keys()) if (!Object.hasOwn(values, key)) removed.push(key);
      const nextOrder = list.map(session => session.id), changed: (Session | SessionDelta)[] = [];
      for (const session of list) {
        const previous = full ? undefined : sessions.get(session.id);
        if (previous === session) continue;
        changed.push(previous ? sessionDelta(previous, session) : session);
      }
      const sameOrder = nextOrder.length === order.length && nextOrder.every((id, index) => id === order[index]);
      if (!full && !changed.length && !removed.length && sameOrder && !Object.keys(changedRoot).length) return undefined;
      const patch: StatePatch = { revision: revision + 1, base: full ? null : revision, root: changedRoot, removed, order: nextOrder, sessions: changed };
      revision = patch.revision; full = false; order = nextOrder;
      root = new Map(Object.entries(values)); sessions = new Map(list.map(session => [session.id, session]));
      return patch;
    },
  };
}

export interface StateReceiver {
  /** The merged state, or 'resync' when the patch does not follow the current revision. */
  apply(patch: StatePatch): AppState | 'resync';
  current(): AppState | undefined;
}

/** `share` may keep unchanged nested branches of a fully replaced session (renderer memoization). */
export function createStateReceiver(share?: (previous: Session, next: Session) => Session): StateReceiver {
  let state: AppState | undefined, revision = 0;
  return {
    current: () => state,
    apply(patch) {
      if (patch.base === null) {
        if (patch.sessions.some(isDelta)) return 'resync';
        state = { ...patch.root, sessions: patch.sessions } as unknown as AppState;
      } else {
        if (!state || patch.base !== revision) return 'resync';
        const known = new Map(state.sessions.map(session => [session.id, session]));
        for (const entry of patch.sessions) {
          const old = known.get(entry.id);
          if (!isDelta(entry)) { known.set(entry.id, old && share ? share(old, entry) : entry); continue; }
          if (!old) return 'resync';
          const next = { ...old } as unknown as Record<string, unknown>;
          for (const key of entry.removed) delete next[key];
          Object.assign(next, entry.fields);
          for (const [key, change] of Object.entries(entry.arrays)) {
            const base = next[key];
            if (!Array.isArray(base)) return 'resync';
            const array = base.slice(0, change.length);
            for (const [index, item] of change.set) array[index] = item;
            if (array.length !== change.length) return 'resync';
            next[key] = array;
          }
          known.set(entry.id, next as unknown as Session);
        }
        const sessions = patch.order.map(id => known.get(id));
        if (sessions.some(session => !session)) return 'resync';
        const { sessions: _previous, ...previousRoot } = state, nextRoot = { ...previousRoot } as Record<string, unknown>;
        for (const key of patch.removed) delete nextRoot[key];
        Object.assign(nextRoot, patch.root);
        state = { ...nextRoot, sessions: sessions as Session[] } as unknown as AppState;
      }
      revision = patch.revision;
      return state;
    },
  };
}
