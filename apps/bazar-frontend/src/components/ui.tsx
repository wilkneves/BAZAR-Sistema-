/** Peças pequenas de UI reutilizadas em todas as telas. */
import type { ReactNode } from 'react';
import { formatMoney, type Money } from '../lib/money';

export function Field({ label, children, hint, erro }: { label: string; children: ReactNode; hint?: string; erro?: string | null }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
      {erro && <small className="field-error" role="alert">{erro}</small>}
    </label>
  );
}

export function ErrorAlert({ erro }: { erro: string | null | undefined }) {
  return erro ? <div className="alert alert-error" role="alert">{erro}</div> : null;
}

export function PageHeader({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return <div className="page-header"><h1>{titulo}</h1><div className="actions">{children}</div></div>;
}

export function MoneyText({ value }: { value: Money | number | undefined | null }) {
  return <span className="num">{value === undefined || value === null ? '—' : formatMoney(value)}</span>;
}

export function Badge({ children, tom = 'neutro' }: { children: ReactNode; tom?: 'neutro' | 'ok' | 'alerta' | 'erro' | 'info' }) {
  return <span className={`badge badge-${tom}`}>{children}</span>;
}

export function Empty({ children = 'Nenhum registro encontrado.' }: { children?: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Paginação">
      <button className="btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</button>
      <span>Página {page} de {pages}</span>
      <button className="btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima</button>
    </nav>
  );
}

export function Tabs<T extends string>({ abas, atual, onChange }: { abas: { id: T; rotulo: string }[]; atual: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {abas.map((a) => (
        <button key={a.id} role="tab" aria-selected={a.id === atual} className={`tab ${a.id === atual ? 'active' : ''}`} onClick={() => onChange(a.id)}>{a.rotulo}</button>
      ))}
    </div>
  );
}
