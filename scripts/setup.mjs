import { existsSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function run(cmd) {
  console.log(`\n[setup] ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

/** Migration antiga fora de ordem (alterava `assets` antes do `init`). */
const LEGACY_FAILED_MIGRATION = '20260505121352';

function recoverLegacyFailedMigration() {
  const apiDir = resolve(ROOT, 'apps/api');
  try {
    execSync(
      `pnpm exec prisma migrate resolve --rolled-back "${LEGACY_FAILED_MIGRATION}"`,
      { cwd: apiDir, stdio: 'pipe' },
    );
    console.log(
      `[setup] Migration falhada "${LEGACY_FAILED_MIGRATION}" marcada como rolled-back.`,
    );
  } catch {
    // Não havia bloqueio — segue normalmente.
  }
}

function ensureEnv(relDir) {
  const envPath = resolve(ROOT, relDir, '.env');
  const examplePath = resolve(ROOT, relDir, '.env.example');
  if (existsSync(envPath)) {
    console.log(`[setup] OK: ${relDir}/.env já existe`);
    return;
  }
  if (!existsSync(examplePath)) {
    throw new Error(`Falta ${relDir}/.env.example`);
  }
  copyFileSync(examplePath, envPath);
  console.log(`[setup] Criado ${relDir}/.env a partir de .env.example`);
}

function main() {
  console.log('[setup] Insta2Figma bootstrap');
  ensureEnv('apps/api');
  ensureEnv('apps/worker');

  run('pnpm install --force');
  run('pnpm infra:up');
  run('pnpm --filter @insta2figma/api exec prisma generate');
  recoverLegacyFailedMigration();
  run('pnpm db:migrate:deploy');
  run('pnpm db:smoke');

  console.log('\n[setup] Concluído com sucesso.');
  console.log('[setup] Próximos comandos:');
  console.log('  pnpm dev');
  console.log('  pnpm build');
  console.log(
    '  Importar no Figma: apps/figma-plugin/dist/manifest.json',
  );
}

main();
