import { useState, useEffect, useCallback } from 'react';
import { apiError } from '../api/client.js';

// Generic fetch hook with refetch + loading/error state
export function useFetch(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await fn()); }
    catch (e) { setError(apiError(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);
  return { data, loading, error, refetch: run, setData };
}
