import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** Tiny shared revision counter: any mutation bumps it, every resource refetches. */
let revision = 0;
const listeners = new Set<() => void>();
export const invalidateAll = () => {
  revision++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const getRevision = () => revision;

export interface Resource<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

/** Loads `fn()` on mount, when `deps` change, and whenever `invalidateAll` is called. */
export function useResource<T>(fn: () => Promise<T>, deps: readonly unknown[] = []): Resource<T> {
  const rev = useSyncExternalStore(subscribe, getRevision);
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef.current().then(
      (data) => live && setState({ data, loading: false }),
      (error: Error) => live && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}
