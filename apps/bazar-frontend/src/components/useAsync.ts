/** Hook de carregamento com estado de erro/carregando e recarga manual. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/http';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    setCarregando(true); setErro(null);
    try { const d = await run(); if (my === seq.current) setData(d); }
    catch (e) { if (my === seq.current) setErro(errorMessage(e)); }
    finally { if (my === seq.current) setCarregando(false); }
  }, [run]);

  useEffect(() => { void reload(); }, [reload]);
  return { data, erro, carregando, reload, setData };
}
