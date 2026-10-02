/** Rotas (Especificação Técnica, seção 4). Cada rota checa a permissão só para UX; o servidor decide. */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/guards';
import { ToastProvider } from './components/Toast';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { TrocarSenhaPage } from './pages/TrocarSenhaPage';
import { HomePage } from './pages/HomePage';
import { AbrirCaixaPage } from './pages/pdv/AbrirCaixaPage';
import { PdvPage } from './pages/pdv/PdvPage';
import { FecharCaixaPage } from './pages/pdv/FecharCaixaPage';
import { VendasPage } from './pages/VendasPage';
import { LotesPage } from './pages/entradas/LotesPage';
import { NovoLotePage } from './pages/entradas/NovoLotePage';
import { TriagemPage } from './pages/entradas/TriagemPage';
import { EstoquePage } from './pages/estoque/EstoquePage';
import { HistoricoItemPage } from './pages/estoque/HistoricoItemPage';
import { TransferenciaPage } from './pages/estoque/TransferenciaPage';
import { AjustesPage } from './pages/estoque/AjustesPage';
import { ContasPagarPage } from './pages/financeiro/ContasPagarPage';
import { ContasReceberPage } from './pages/financeiro/ContasReceberPage';
import { ResumoFinanceiroPage } from './pages/financeiro/ResumoFinanceiroPage';
import { RelatoriosPage } from './pages/RelatoriosPage';
import { SincronizacaoPage } from './pages/SincronizacaoPage';
import { CadastrosPage } from './pages/CadastrosPage';
import { AdminPage } from './pages/admin/AdminPage';
import type { Permissao } from './api/types';
import type { ReactNode } from 'react';

const P = (perms: Permissao[], el: ReactNode) => <RequirePermission perms={perms}>{el}</RequirePermission>;

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/trocar-senha" element={<RequireAuth><TrocarSenhaPage /></RequireAuth>} />
            {/* PDV: tela cheia, fora do layout do Backoffice */}
            <Route path="/pdv" element={<RequireAuth>{P(['caixa.operar'], <PdvPage />)}</RequireAuth>} />
            <Route path="/pdv/abrir" element={<RequireAuth>{P(['caixa.operar'], <AbrirCaixaPage />)}</RequireAuth>} />
            <Route path="/pdv/fechar" element={<RequireAuth>{P(['caixa.operar'], <FecharCaixaPage />)}</RequireAuth>} />
            {/* Backoffice */}
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<HomePage />} />
              <Route path="vendas" element={P(['caixa.operar', 'venda.cancelar'], <VendasPage />)} />
              <Route path="entradas" element={P(['entrada.registrar'], <LotesPage />)} />
              <Route path="entradas/novo" element={P(['entrada.registrar'], <NovoLotePage />)} />
              <Route path="entradas/:id/triagem" element={P(['entrada.registrar'], <TriagemPage />)} />
              <Route path="estoque" element={P(['estoque.consultar'], <EstoquePage />)} />
              <Route path="estoque/itens/:id" element={P(['estoque.consultar'], <HistoricoItemPage />)} />
              <Route path="estoque/transferir" element={P(['estoque.transferir'], <TransferenciaPage />)} />
              <Route path="estoque/ajustes" element={P(['estoque.ajustar'], <AjustesPage />)} />
              <Route path="financeiro/pagar" element={P(['contas_pagar.gerenciar'], <ContasPagarPage />)} />
              <Route path="financeiro/receber" element={P(['contas_receber.receber'], <ContasReceberPage />)} />
              <Route path="financeiro/resumo" element={P(['relatorios.consultar'], <ResumoFinanceiroPage />)} />
              <Route path="relatorios/:tipo" element={P(['relatorios.consultar'], <RelatoriosPage />)} />
              <Route path="sincronizacao" element={P(['sincronizacao.resolver'], <SincronizacaoPage />)} />
              <Route path="cadastros/:tipo" element={P(['cadastros.gerenciar', 'cadastros.consultar', 'clientes.gerenciar'], <CadastrosPage />)} />
              <Route path="admin/*" element={<AdminPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
