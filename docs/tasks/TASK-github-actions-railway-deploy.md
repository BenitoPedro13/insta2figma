# TASK — Deploy via GitHub Actions (Railway CLI + token)

## Cenário actual

- O projeto Railway foi recriado na conta business (projeto `awake-luck`,
  environment `production`), com serviços `api` e `worker` + Postgres, Redis e bucket.
- O deploy actual depende de:
  - **Integração nativa GitHub do Railway** ligada ao fork pessoal
    `BenitoPedro13/insta2figma` (branch `main`), OU
  - `railway up` manual a partir do local.
- Problemas:
  - A integração nativa está ligada ao **fork pessoal**, não ao repo da org
    `mainnetdesign/insta2figma` (canónico nos docs).
  - Risco de **deploy duplicado** se a integração nativa e um workflow CI
    estiverem ambos activos no mesmo push.
  - O utilizador quer CI/CD **sem** depender da integração GitHub-App do Railway
    (sem webhook/autorização ao nível da org).

## Mudanças planeadas

1. **Novo** `.github/workflows/deploy.yml`:
   - Trigger: `push` para `main`.
   - Usa `dorny/paths-filter` para replicar os `watchPatterns` dos `railway.*.toml`:
     só faz deploy do `api` quando muda `apps/api/**` / `packages/shared-*` / `Dockerfile.api`,
     e do `worker` quando muda `apps/worker/**` / `packages/shared-*` / `Dockerfile.worker`.
   - Cada job instala o Railway CLI e corre `railway up --service <name> --ci`
     autenticado por `RAILWAY_TOKEN` (project token, scoped ao environment `production`).
   - `concurrency` para serializar deploys do mesmo ref.
2. **Edição** `docs/RAILWAY.md`: nova secção "CI/CD via GitHub Actions" a documentar
   o token, o secret, e a regra de **um único trigger** (desligar a integração nativa
   para evitar deploy duplicado; secret só no repo canónico).

## Porquê

- Deploy reprodutível em `git push`, sem o Railway GitHub App (que falhou a importar
  o repo da org). O token é o único acesso que o Railway precisa.
- `paths-filter` evita rebuilds desnecessários (ex.: mudanças só em `docs/`), espelhando
  o comportamento dos `watchPatterns` que a integração nativa usava.
- Secret num só repo + integração nativa desligada = garantia de **um** deploy por push.

## Ficheiros afectados

| Ficheiro | Tipo | Mudança |
|----------|------|---------|
| `.github/workflows/deploy.yml` | novo | Workflow de deploy Railway por serviço |
| `docs/RAILWAY.md` | edição | Secção CI/CD + nota sobre deploy único |
| `docs/tasks/TASK-github-actions-railway-deploy.md` | novo | Este documento |
