/** Modal acessível: role=dialog, foco preso no conteúdo, Esc fecha (quando permitido). */
import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  titulo: string;
  aberto: boolean;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: 'sm' | 'md' | 'lg';
  /** false impede fechar com Esc/clique fora (ex.: durante gravação). */
  fechavel?: boolean;
}

export function Modal({ titulo, aberto, onFechar, children, rodape, largura = 'md', fechavel = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fechavel) { e.stopPropagation(); onFechar(); }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const first = f[0]!, last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); anterior?.focus(); };
  }, [aberto, fechavel, onFechar]);

  if (!aberto) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && fechavel) onFechar(); }}>
      <div ref={ref} className={`modal modal-${largura}`} role="dialog" aria-modal="true" aria-labelledby="modal-titulo">
        <header className="modal-header">
          <h2 id="modal-titulo">{titulo}</h2>
          {fechavel && <button type="button" className="btn btn-ghost" onClick={onFechar} aria-label="Fechar">✕</button>}
        </header>
        <div className="modal-body">{children}</div>
        {rodape && <footer className="modal-footer">{rodape}</footer>}
      </div>
    </div>
  );
}
