# BAZAR

Estrutura monorepo organizada para manter o backend e o frontend em um único repositório, separados por app.

## Estrutura

- `apps/bazar-backend` — API e serviços do sistema
- `apps/bazar-frontend` — interface web do sistema
- `QA_Correcoes_por_Area.md` — documentação de correções por área

## Comandos úteis

```bash
# Backend
npm --prefix apps/bazar-backend run dev
npm --prefix apps/bazar-backend run build

# Frontend
npm --prefix apps/bazar-frontend run dev
npm --prefix apps/bazar-frontend run build
```

Ou pelo root do monorepo:

```bash
npm run dev:backend
npm run dev:frontend
```
