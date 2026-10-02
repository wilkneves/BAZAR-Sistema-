/** Perfis configuráveis sobre a lista fixa de 24 permissões. Perfis padrão não são excluídos (nem há exclusão). */
import { useState } from 'react';
import { perfisApi } from '../../api/modules';
import { errorMessage } from '../../api/http';
import type { Perfil, Permissao } from '../../api/types';
import { useAsync } from '../../components/useAsync';
import { Badge, ErrorAlert, Field } from '../../components/ui';
import { fromCents, toCents, tryCents } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import { useToast } from '../../components/Toast';

export function PerfisTab() {
  const toast = useToast();
  const perfis = useAsync(() => perfisApi.listar(), []);
  const perms = useAsync(() => perfisApi.permissoes(), []);
  const [sel, setSel] = useState<Perfil | null>(null);
  const [nome, setNome] = useState(''); const [lista, setLista] = useState<Permissao[]>([]); const [limite, setLimite] = useState('0');
  const [erro, setErro] = useState<string | null>(null);

  function editar(p: Perfil | null) {
    setSel(p); setErro(null);
    setNome(p?.nome ?? ''); setLista(p?.permissoes ?? []); setLimite(p ? String(toCents(p.limiteDesconto) / 100) : '0');
  }
  const limiteCents = tryCents(limite);
  async function salvar() {
    if (nome.trim().length < 3 || limiteCents === null || limiteCents < 0 || limiteCents > 10000) return;
    setErro(null);
    try {
      const dados = { nome: nome.trim(), permissoes: lista, limiteDesconto: fromCents(limiteCents) };
      if (sel) await perfisApi.atualizar(sel.id, dados); else await perfisApi.criar({ id: uuid(), ...dados });
      toast('Perfil salvo. As novas permissões valem no próximo login/refresh do usuário.'); await perfis.reload(); editar(null);
    } catch (e) { setErro(errorMessage(e)); }
  }

  return (
    <div className="grid-2">
      <section>
        <div className="row"><button className="btn btn-primary" onClick={() => editar(null)}>+ Novo perfil</button></div>
        <ul className="lista-escolha">{perfis.data?.map((p) => (
          <li key={p.id}><button className={`btn btn-block ${sel?.id === p.id ? 'active' : ''}`} onClick={() => editar(p)}>{p.nome} {p.padrao && <Badge tom="info">Padrão</Badge>} <small>{p.permissoes.length} permissões</small></button></li>
        ))}</ul>
      </section>
      <section className="card">
        <h2>{sel ? `Editar: ${sel.nome}` : 'Novo perfil'}</h2>
        <Field label="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} /></Field>
        <Field label="Limite de desconto (%)" hint="PA-08: regra de desconto pendente de validação."><input inputMode="decimal" value={limite} onChange={(e) => setLimite(e.target.value)} /></Field>
        <fieldset className="perms">
          <legend>Permissões</legend>
          {perms.data?.map((p) => (
            <label key={p.codigo} className="check">
              <input type="checkbox" checked={lista.includes(p.codigo)} onChange={(e) => setLista(e.target.checked ? [...lista, p.codigo] : lista.filter((x) => x !== p.codigo))} />
              <code>{p.codigo}</code>
            </label>
          ))}
        </fieldset>
        <ErrorAlert erro={erro ?? perms.erro} />
        <button className="btn btn-primary" onClick={salvar} disabled={nome.trim().length < 3}>Salvar perfil</button>
      </section>
    </div>
  );
}
