# BAZAR — Sistema de Gestão de Bazar

Sistema de gestão para operação de bazar, com módulos de PDV, estoque, entradas, financeiro, cadastros, relatórios, administração e sincronização. O projeto está organizado em monorepo, separando backend e frontend em apps independentes, mantendo a base em uma única raiz para desenvolvimento e execução.

## Visão geral do sistema

O sistema foi pensado para apoiar as operações do dia a dia de um bazar, incluindo:

- PDV e fechamento de caixa
- Cadastro de clientes e produtos
- Entradas, triagem e lotes
- Controle de estoque e transferências
- Financeiro com contas a pagar e receber
- Relatórios e auditoria
- Administração de usuários, perfis e parâmetros
- Sincronização e funcionamento em ambiente offline/online

## Estrutura do projeto

- `apps/bazar-backend` — API em Node.js + Fastify + Prisma
- `apps/bazar-frontend` — interface em React + Vite + TypeScript
- `QA_Correcoes_por_Area.md` — checklist de correções por área
- `README.md` — instruções gerais do projeto

## Requisitos para rodar

Antes de iniciar, instale o seguinte na máquina:

- Node.js 20+
- npm 10+
- Git
- PostgreSQL local ou um banco compatível com a aplicação
- VS Code (recomendado)

## Extensões recomendadas no VS Code

Instale as extensões abaixo para facilitar o desenvolvimento:

- ESLint
- Prettier - Code formatter
- Prisma
- GitHub Copilot
- GitHub Copilot Chat
- Thunder Client ou Postman
- Material Icon Theme
- Auto Rename Tag

## Preparação do ambiente

### 1) Clonar o projeto

```bash
git clone https://github.com/wilkneves/BAZAR-Sistema-.git
cd BAZAR-Sistema-
```

### 2) Instalar dependências do monorepo

```bash
npm install
```

### 3) Configurar variáveis de ambiente do backend

Crie o arquivo `.env` dentro de `apps/bazar-backend` com base no `.env.example`:

```bash
cp apps/bazar-backend/.env.example apps/bazar-backend/.env
```

Preencha os valores mínimos, especialmente:

- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGINS`
- `ADMIN_INITIAL_PASSWORD`

Exemplo:

```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://bazar_api:troque@localhost:5432/bazar
MIGRATION_DATABASE_URL=postgresql://bazar_owner:troque@localhost:5432/bazar
JWT_SECRET=12345678901234567890123456789012
CORS_ORIGINS=http://localhost:5173
ADMIN_LOGIN=admin
ADMIN_INITIAL_PASSWORD=Admin@123
```

### 4) Configurar ambiente do frontend

Crie o arquivo `.env.local` em `apps/bazar-frontend`:

```bash
cp apps/bazar-frontend/.env.example apps/bazar-frontend/.env.local
```

Para desenvolvimento com dados mockados, use:

```env
VITE_USE_MOCK=true
```

## Rodando o projeto

### Opção 1: rodar backend e frontend separadamente

Backend:

```bash
npm --prefix apps/bazar-backend run dev
```

Frontend:

```bash
npm --prefix apps/bazar-frontend run dev
```

### Opção 2: rodar backend e frontend juntos

Na raiz do projeto:

```bash
npm run dev
```

Isso inicia os dois processos em paralelo:

- Backend: http://localhost:3000
- Frontend: http://localhost:5173

## Login padrão em desenvolvimento

Quando o frontend está em modo mockado, o login padrão é:

- Usuário: `admin`
- Senha: `Admin@123`

## Build para produção

```bash
npm run build:backend
npm run build:frontend
```

## Banco de dados

O backend usa Prisma e migrations. Para preparar o banco:

```bash
npm --prefix apps/bazar-backend run prisma:generate
npm --prefix apps/bazar-backend run db:migrate
npm --prefix apps/bazar-backend run db:seed
```

## Dicas de desenvolvimento

- Use o VS Code com o terminal integrado para rodar os scripts em paralelo.
- Mantenha os arquivos `.env` fora do controle de versão.
- Para produção, evite expor `ADMIN_INITIAL_PASSWORD` em ambientes públicos.
- Em desenvolvimento com mocks, o frontend simula a API e permite testar fluxo de login e telas sem backend real.

## Observações importantes

- O frontend em desenvolvimento usa mock e não depende do backend para navegação básica.
- O backend exige conexão com banco e variáveis de ambiente válidas.
- O sistema foi planejado para arquitetura modular e expansão por módulos de domínio.

## Tecnologias principais

- Backend: Fastify, TypeScript, Prisma, PostgreSQL
- Frontend: React, Vite, TypeScript
- Segurança: JWT, CORS, validação com Zod, ambiente isolado por configuração

## Suporte

Consulte a documentação local das apps e arquivos de correção por área para desvendar regras de negócio, permissões e fluxos específicos do sistema.
