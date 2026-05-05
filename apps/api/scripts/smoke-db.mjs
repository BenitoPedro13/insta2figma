import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.$connect();
  const ping = await prisma.$queryRaw`SELECT 1::int AS v`;
  const v = ping?.[0]?.v;
  if (Number(v) !== 1) {
    console.error('[db:smoke] Ping SQL inválido:', ping);
    process.exit(1);
  }

  const userCount = await prisma.user.count();
  console.info(
    `[db:smoke] OK · Prisma ligado ao Postgres · utilizadores (${userCount})`,
  );
} catch (err) {
  console.error('[db:smoke] Falhou:', err instanceof Error ? err.message : err);
  console.error(
    'Ordem habitual: docker compose up -d → cp apps/api/.env.example apps/api/.env → pnpm install → pnpm --filter @insta2figma/api exec prisma migrate deploy',
  );
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
