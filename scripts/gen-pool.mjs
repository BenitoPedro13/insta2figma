#!/usr/bin/env node
/**
 * gen-pool.mjs — reads scripts/sessions.json and prints the IG_SESSION_POOL
 * value ready to paste into .env or Railway.
 *
 * Usage:  pnpm cdp:pool
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = resolve(__dir, 'sessions.json');

if (!existsSync(SESSIONS_FILE)) {
  console.error('scripts/sessions.json not found.');
  process.exit(1);
}

const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));

if (!sessions.length) {
  console.error('sessions.json is empty.');
  process.exit(1);
}

// Strip record-keeping fields — only keep what IG_SESSION_POOL needs
const pool = sessions.map(({ account, cookie, proxy }) => ({
  account,
  cookie,
  ...(proxy ? { proxy } : {}),
}));

const value = JSON.stringify(pool);

console.log('\nIG_SESSION_POOL value:\n');
console.log(value);
console.log(`\n${pool.length} account(s) in pool`);
pool.forEach(e => console.log(`  · ${e.account}${e.proxy ? '  proxy: ' + e.proxy : '  (no proxy)'}`));
