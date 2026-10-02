import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tipo = 'ok' | 'erro' | 'info';
interface ToastMsg { id: number; tipo: Tipo; texto: string }
const Ctx = createContext<(texto: string, tipo?: Tipo) => void>(() => {});
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msgs, setMsgs] = useState<ToastMsg[]>([]);
  const show = useCallback((texto: string, tipo: Tipo = 'ok') => {
    const id = ++seq;
    setMsgs((m) => [...m, { id, tipo, texto }]);
    setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== id)), tipo === 'erro' ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {msgs.map((m) => <div key={m.id} className={`toast toast-${m.tipo}`} role={m.tipo === 'erro' ? 'alert' : 'status'}>{m.texto}</div>)}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
