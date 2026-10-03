/**
 * Pending state for a CTA that starts async work.
 *
 * `run(work)` sets pending before the work starts and clears it in `finally`,
 * and refuses to start a second run while one is in flight — guarded by a ref
 * as well as the state, because two clicks dispatched before React re-renders
 * would both read the state as idle. A refused run resolves to `undefined`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function usePendingAction(): [
  pending: boolean,
  run: <T>(work: () => Promise<T>) => Promise<T | undefined>,
] {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPending(true);
    try {
      return await work();
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);

  return [pending, run];
}

/**
 * The same, for a list where each row has its own CTA (duplicate one project
 * while another is still copying). `isPending(key)` is that row's state.
 */
export function usePendingKeys(): [
  isPending: (key: string) => boolean,
  run: <T>(key: string, work: () => Promise<T>) => Promise<T | undefined>,
] {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());

  const run = useCallback(
    async <T>(key: string, work: () => Promise<T>): Promise<T | undefined> => {
      if (inFlight.current.has(key)) return undefined;
      inFlight.current.add(key);
      setKeys(new Set(inFlight.current));
      try {
        return await work();
      } finally {
        inFlight.current.delete(key);
        setKeys(new Set(inFlight.current));
      }
    },
    [],
  );

  const isPending = useCallback((key: string) => keys.has(key), [keys]);
  return [isPending, run];
}
