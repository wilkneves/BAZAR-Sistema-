import { useEffect, useState } from 'react';
import { isOnline, subscribeConnectivity } from '../lib/connectivity';
import { subscribeFila, tamanhoFila } from './queue';

export function useOnline(): boolean {
  const [on, setOn] = useState(isOnline());
  useEffect(() => subscribeConnectivity(setOn), []);
  return on;
}

export function useTamanhoFila(): number {
  const [n, setN] = useState(0);
  useEffect(() => { tamanhoFila().then(setN); return subscribeFila(setN); }, []);
  return n;
}
