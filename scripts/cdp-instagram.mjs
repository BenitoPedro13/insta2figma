#!/usr/bin/env node
/**
 * cdp-instagram.mjs — creates an Instagram account using the latest Gmail from accounts.json.
 * Reuses the same proxy saved by cdp.mjs (.proxy-session).
 * You manually enter the Gmail confirmation code when prompted.
 *
 * Usage:
 *   node scripts/cdp-instagram.mjs --launch          # no proxy
 *   node scripts/cdp-instagram.mjs --launch --proxy=random  # reuse saved proxy
 */

import CDP from 'chrome-remote-interface';
import { execSync, spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

const envPath = resolve(__dir, '../.env');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const FIVESIM_KEY     = process.env.SMS5SIM_API_KEY;
const ACCOUNTS_FILE   = resolve(__dir, 'accounts.json');
const SESSIONS_FILE   = resolve(__dir, 'sessions.json');
const PROXY_FILE      = resolve(__dir, '.proxy-session');

// --- data helpers ---

function loadLatestAccount() {
  if (!existsSync(ACCOUNTS_FILE)) throw new Error('scripts/accounts.json not found — run cdp.mjs first');
  const raw = readFileSync(ACCOUNTS_FILE, 'utf8').trim();
  if (!raw) throw new Error('accounts.json is empty — run cdp.mjs first or add an entry manually');
  const list = JSON.parse(raw);
  if (!list.length) throw new Error('accounts.json has no entries');
  return list[list.length - 1];
}

function loadProxy() {
  if (!existsSync(PROXY_FILE)) return null;
  return JSON.parse(readFileSync(PROXY_FILE, 'utf8'));
}

function proxyToUrl(p) {
  if (!p) return null;
  return p.user ? `http://${p.user}:${p.pass}@${p.server}` : `http://${p.server}`;
}

function saveSession(entry) {
  const list = existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) : [];
  list.push({ ...entry, createdAt: new Date().toISOString() });
  writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2));
  console.log(`Session saved → scripts/sessions.json (${list.length} total)`);
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(question, ans => { rl.close(); r(ans.trim()); }));
}

// --- browser helpers ---

const delay = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome', 'chromium',
];

const cliArgs   = process.argv.slice(2);
const shouldLaunch = cliArgs.includes('--launch');
const port      = Number(cliArgs.find(a => a.startsWith('--port='))?.split('=')[1] ?? 9222);
const useProxy  = cliArgs.find(a => a.startsWith('--proxy='))?.split('=').slice(1).join('=') === 'random';

function launchChrome(proxy) {
  const bin = CHROME_PATHS.find(p => {
    try { execSync(`test -f "${p}" || which "${p}"`, { stdio: 'ignore' }); return true; } catch { return false; }
  });
  if (!bin) throw new Error('Chrome not found.');
  try { execSync(`lsof -ti tcp:${port} | xargs kill -9`, { stdio: 'ignore' }); } catch { /* nothing running */ }
  if (proxy) console.log(`Using proxy: ${proxy.server}`);
  const proc = spawn(bin, [
    `--remote-debugging-port=${port}`,
    '--user-data-dir=/tmp/chrome-ig',   // separate profile — don't mix with Google session
    '--no-first-run', '--no-default-browser-check',
    ...(proxy ? [`--proxy-server=http://${proxy.server}`] : []),
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  proc.unref();
}

async function connectChrome(proxy) {
  if (shouldLaunch) launchChrome(proxy);
  let client;
  for (let i = 1; i <= 15; i++) {
    try { client = await CDP({ port }); break; } catch {
      if (i === 15) { console.error('Could not connect to Chrome'); process.exit(1); }
      process.stdout.write(i === 1 ? 'Waiting for Chrome' : '.');
      await new Promise(r => setTimeout(r, 500));
    }
  }
  console.log(' ready.');
  const { Page, Runtime, Network, Fetch } = client;
  await Promise.all([Page.enable(), Runtime.enable(), Network.enable()]);
  if (proxy?.user) {
    await Fetch.enable({ handleAuthRequests: true });
    Fetch.authRequired(({ requestId, authChallenge }) => {
      if (authChallenge.source === 'Proxy')
        Fetch.continueWithAuth({ requestId, authChallengeResponse: { response: 'ProvideCredentials', username: proxy.user, password: proxy.pass } });
    });
    Fetch.requestPaused(({ requestId }) => Fetch.continueRequest({ requestId }));
  }
  return { client, Page, Runtime, Network };
}

async function getCenter(selector, Runtime) {
  const { result } = await Runtime.evaluate({
    expression: `(() => { const el = document.querySelector('${selector}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left+r.width/2, y: r.top+r.height/2 }); })()`,
  });
  return result.value ? JSON.parse(result.value) : null;
}

async function moveAndClick(x, y, Input) {
  const steps = 8 + Math.floor(Math.random() * 6);
  const sx = x - 80 + Math.random() * 160, sy = y - 60 + Math.random() * 120;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    await Input.dispatchMouseEvent({ type: 'mouseMoved', x: Math.round(sx + (x-sx)*t), y: Math.round(sy + (y-sy)*t) });
    await delay(20, 60);
  }
  await delay(200, 500);
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await delay(60, 140);
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

async function humanType(text, Input) {
  for (const char of text) {
    await Input.dispatchKeyEvent({ type: 'keyDown', text: char });
    await Input.dispatchKeyEvent({ type: 'keyUp', text: char });
    await delay(60, 180);
    if (Math.random() < 0.1) await delay(200, 500);
  }
}

// --- 5sim helpers (for phone verification fallback) ---

async function fivesimRequest(path) {
  const res = await fetch(`https://5sim.net/v1${path}`, {
    headers: { Authorization: `Bearer ${FIVESIM_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`5sim ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function buyNumber(country = 'any') {
  const ep = country === 'any'
    ? '/user/buy/activation/any/any/instagram'
    : `/user/buy/activation/${country}/any/instagram`;
  try { return await fivesimRequest(ep); } catch { return await fivesimRequest('/user/buy/activation/any/any/instagram'); }
}

async function waitForSms(orderId) {
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const order = await fivesimRequest(`/user/check/${orderId}`);
    if (order.sms?.length) return order.sms[0].text;
    if (order.status === 'CANCELED') throw new Error('5sim order cancelled');
  }
  throw new Error('5sim SMS timeout');
}

async function finishOrder(id) { await fivesimRequest(`/user/finish/${id}`); }

// username from email — base + 4-digit suffix
function makeUsername(email) {
  const base = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20);
  return `${base}_${1000 + Math.floor(Math.random() * 9000)}`;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

const account = loadLatestAccount();
const proxy   = useProxy ? loadProxy() : null;

console.log(`Account : ${account.email}`);
console.log(`Proxy   : ${proxy ? proxy.server : 'none'}`);

const { client, Page, Runtime, Network } = await connectChrome(proxy);
const { Input } = client;

const G     = (sel) => getCenter(sel, Runtime);
const click = (x, y) => moveAndClick(x, y, Input);
const type  = (text) => humanType(text, Input);

const igUsername = makeUsername(account.email);
const igPassword = account.password;

console.log(`IG username : ${igUsername}`);
console.log(`IG password : ${igPassword}`);

// ── signup form ──────────────────────────────────────────────────────────────

await Page.navigate({ url: 'https://www.instagram.com/accounts/emailsignup/' });
await Page.loadEventFired();
await delay(2500, 4000);

// email
let pos = await G('input[name="emailOrPhone"]');
if (pos) { await click(pos.x, pos.y); await delay(300, 600); await type(account.email); console.log('Typed: email'); }

await delay(500, 900);

// full name
pos = await G('input[name="fullName"]');
if (pos) { await click(pos.x, pos.y); await delay(300, 600); await type('insta2figma'); console.log('Typed: full name'); }

await delay(400, 800);

// username — try the generated one; if taken Instagram will flag it
pos = await G('input[name="username"]');
if (pos) { await click(pos.x, pos.y); await delay(300, 600); await type(igUsername); console.log('Typed: username'); }

await delay(800, 1400);

// check username availability before proceeding
const { result: usernameState } = await Runtime.evaluate({
  expression: `document.querySelector('input[name="username"]')?.getAttribute('aria-describedby') ?? ''`,
});
if (String(usernameState.value).toLowerCase().includes('taken') || String(usernameState.value).toLowerCase().includes('unavailable')) {
  console.log('Username taken — appending extra suffix');
  const extra = Math.floor(Math.random() * 900) + 100;
  await Runtime.evaluate({ expression: `document.querySelector('input[name="username"]').value = ''` });
  await type(`${igUsername}${extra}`);
}

await delay(400, 800);

// password
pos = await G('input[name="password"]');
if (pos) { await click(pos.x, pos.y); await delay(300, 600); await type(igPassword); console.log('Typed: password'); }

await delay(800, 1500);

// submit
pos = await G('button[type="submit"]');
if (pos) { await click(pos.x, pos.y); console.log('Clicked: Next'); }

await delay(2500, 4000);

// ── birthday step (Instagram sometimes shows this) ───────────────────────────

const { result: bdCheck } = await Runtime.evaluate({
  expression: `!!document.querySelector('select[title="Month:"], [data-testid="birthday-month"]')`,
});
if (bdCheck.value) {
  console.log('Birthday step detected');
  const birthYear  = 1990 + Math.floor(Math.random() * 10);
  const birthMonth = 1    + Math.floor(Math.random() * 12);
  const birthDay   = 1    + Math.floor(Math.random() * 28);
  await Runtime.evaluate({
    expression: `(() => {
      const sels = document.querySelectorAll('select');
      function setVal(el, v) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
      if (sels[0]) setVal(sels[0], '${birthMonth}');
      if (sels[1]) setVal(sels[1], '${birthDay}');
      if (sels[2]) setVal(sels[2], '${birthYear}');
    })()`,
  });
  await delay(800, 1400);
  pos = await G('button[type="submit"]');
  if (pos) { await click(pos.x, pos.y); console.log('Clicked: Next (birthday)'); }
  await delay(2500, 4000);
}

// ── verification loop ─────────────────────────────────────────────────────────

let sessionCaptured = false;

for (let w = 0; w < 30; w++) {
  await delay(1000, 1500);
  const { result: state } = await Runtime.evaluate({
    expression: `(() => {
      if (document.querySelector('input[name="email_confirmation_code"]')) return 'email_code';
      if (document.querySelector('input[name="phoneNumber"], input[type="tel"]'))  return 'phone';
      const url = location.href;
      if (url.includes('/accounts/onetap') || url === 'https://www.instagram.com/' || url.endsWith('.com/')) return 'success';
      return null;
    })()`,
  });

  // ── email confirmation code ──────────────────────────────────────────────
  if (state.value === 'email_code') {
    console.log(`\n📧  Instagram sent a confirmation email to ${account.email}`);
    const code = await prompt('   Open Gmail, find the code and paste it here: ');
    pos = await G('input[name="email_confirmation_code"]');
    if (pos) {
      await click(pos.x, pos.y);
      await delay(300, 600);
      await type(code);
      await delay(800, 1400);
      pos = await G('button[type="submit"]');
      if (pos) { await click(pos.x, pos.y); console.log('Clicked: Confirm email'); }
    }
    continue;
  }

  // ── phone verification (5sim) ─────────────────────────────────────────────
  if (state.value === 'phone') {
    console.log('Phone verification required — using 5sim');
    if (!FIVESIM_KEY) { console.log('FIVESIM_KEY not set'); break; }
    try {
      const order = await buyNumber('any');
      console.log(`5sim number: +${order.phone}`);
      pos = await G('input[name="phoneNumber"], input[type="tel"]');
      if (pos) {
        await click(pos.x, pos.y); await delay(300, 500);
        await type(order.phone);
        await delay(800, 1400);
        pos = await G('button[type="submit"]');
        if (pos) { await click(pos.x, pos.y); console.log('Clicked: Send code'); }
        const smsText = await waitForSms(order.id);
        console.log('OTP SMS:', smsText);
        const match = smsText.match(/\b(\d{6})\b/);
        if (match) {
          await delay(1000, 1500);
          pos = await G('input[name="confirmationCode"], input[name="code"]');
          if (pos) {
            await click(pos.x, pos.y); await delay(300, 500);
            await type(match[1]);
            await delay(800, 1400);
            pos = await G('button[type="submit"]');
            if (pos) { await click(pos.x, pos.y); console.log('Clicked: Verify'); }
          }
        }
        await finishOrder(order.id);
      }
    } catch (e) { console.log('5sim failed:', e.message); }
    continue;
  }

  // ── success ───────────────────────────────────────────────────────────────
  if (state.value === 'success') {
    console.log('Instagram signup complete ✓');
    sessionCaptured = true;
    break;
  }
}

// ── extract sessionid cookie ──────────────────────────────────────────────────

await delay(2000, 3000);
const { cookies } = await Network.getAllCookies();
const sessionCookie = cookies.find(c => c.name === 'sessionid' && c.domain.includes('instagram'));

if (sessionCookie) {
  const proxyUrl = proxyToUrl(proxy);
  const entry = {
    account: igUsername,
    email:   account.email,
    cookie:  `sessionid=${sessionCookie.value}`,
    ...(proxyUrl ? { proxy: proxyUrl } : {}),
  };
  saveSession(entry);

  const igPoolEntry = { account: entry.account, cookie: entry.cookie, ...(entry.proxy ? { proxy: entry.proxy } : {}) };
  console.log('\n─── Add to IG_SESSION_POOL in .env ───────────────────────────');
  console.log(JSON.stringify([igPoolEntry], null, 2));
  console.log('──────────────────────────────────────────────────────────────');
} else {
  console.log('sessionid not found — account may need more time or manual steps in Chrome');
  console.log('IG cookies present:', cookies.filter(c => c.domain?.includes('instagram')).map(c => c.name).join(', ') || 'none');
}
