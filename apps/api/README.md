# API Insta2Figma

Persistência com **Prisma** + Postgres; HTTP NestJS entra na Fase 3. Ver §5.2 da [arquitetura](../../docs/ARQUITETURA-INSTA2FIGMA.md).

## Postgres local com Docker Compose

Na raíz do monorepo:

```bash
pnpm infra:up
```

Ou: `docker compose up -d`

Copiar `.env`:

```bash
cp apps/api/.env.example apps/api/.env
```

Instalar deps (se ainda não corrido na raíz): `pnpm install`

Gerar cliente Prisma:

```bash
pnpm --filter @insta2figma/api exec prisma generate
```

Aplicar migrações (produção/CI/local após primeira vez):

```bash
pnpm --filter @insta2figma/api exec prisma migrate deploy
```

Durante alterações ao schema: `pnpm --filter @insta2figma/api exec prisma migrate dev`.

## Smoke

Com o Postgres healthy e migrações aplicadas:

```bash
pnpm --filter @insta2figma/api run db:smoke
```
