#!/usr/bin/env node
/**
 * CDP helper — connects to a Chrome instance already running with:
 *   --remote-debugging-port=9222
 *
 * Launch Chrome manually:
 *   Mac:
 *     /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *       --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-cdp
 *
 *   Or use the convenience launcher in this script:
 *     node scripts/cdp.mjs --launch
 *
 * Usage:
 *   node scripts/cdp.mjs                      # connects, opens about:blank
 *   node scripts/cdp.mjs --launch             # launches Chrome then connects
 *   node scripts/cdp.mjs --port=9333          # custom port
 */

import CDP from 'chrome-remote-interface';
import { execSync, spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import jsQR from 'jsqr';

async function decodeQRFromBase64(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  const img = sharp(buf);
  const { width, height } = await img.metadata();
  const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), width, height);
  return result?.data ?? null;
}

const __dir = dirname(fileURLToPath(import.meta.url));

function loadProxies(file = resolve(__dir, 'proxies.txt')) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [host, port, user, pass] = l.split(':');
      return { server: `${host}:${port}`, user, pass };
    });
}

const PROXY_SESSION_FILE = resolve(__dir, '.proxy-session');

function pickProxy(value) {
  if (!value) return null;

  // --proxy=reset  →  clear saved session
  if (value === 'reset') {
    if (existsSync(PROXY_SESSION_FILE)) {
      unlinkSync(PROXY_SESSION_FILE);
      console.log('Proxy session cleared.');
    }
    return null;
  }

  // --proxy=random  →  reuse saved session if exists, else pick a new one and save it
  if (value === 'random') {
    if (existsSync(PROXY_SESSION_FILE)) {
      const saved = JSON.parse(readFileSync(PROXY_SESSION_FILE, 'utf8'));
      console.log(`Reusing saved proxy: ${saved.server} (user: ${saved.user})`);
      return saved;
    }
    const pool = loadProxies();
    if (!pool.length) throw new Error('proxies.txt not found or empty');
    const picked = pool[Math.floor(Math.random() * pool.length)];
    writeFileSync(PROXY_SESSION_FILE, JSON.stringify(picked));
    console.log(`Proxy selected + saved: ${picked.server} (user: ${picked.user})`);
    return picked;
  }

  // manual format: http://user:pass@host:port
  const match = value.match(/^https?:\/\/([^:]+):([^@]+)@(.+)$/);
  if (match) return { server: match[3], user: match[1], pass: match[2] };
  return { server: value, user: null, pass: null };
}

const args = process.argv.slice(2);
const shouldLaunch = args.includes('--launch');
const port = Number(args.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 9222);
const proxy = pickProxy(args.find((a) => a.startsWith('--proxy='))?.split('=').slice(1).join('=') ?? null);

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium',
];

function launchChrome() {
  const bin = CHROME_PATHS.find((p) => {
    try { execSync(`test -f "${p}" || which "${p}"`, { stdio: 'ignore' }); return true; } catch { return false; }
  });
  if (!bin) throw new Error('Chrome not found. Install Chrome or set path manually.');

  // Kill any Chrome already holding the debug port so the new one starts clean
  try {
    execSync(`lsof -ti tcp:${port} | xargs kill -9`, { stdio: 'ignore' });
    console.log(`Killed existing process on port ${port}`);
  } catch { /* nothing was running */ }

  if (proxy) console.log(`Using proxy: ${proxy.server}`);
  console.log(`Launching Chrome on port ${port}…`);
  const proc = spawn(bin, [
    `--remote-debugging-port=${port}`,
    '--user-data-dir=/tmp/chrome-cdp',
    '--no-first-run',
    '--no-default-browser-check',
    // credentials are NOT passed here — handled via Fetch.authRequired below
    ...(proxy ? [`--proxy-server=http://${proxy.server}`] : []),
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  proc.unref();

  return new Promise((res) => setTimeout(res, 2000));
}

async function connect() {
  if (shouldLaunch) await launchChrome();

  let client;
  try {
    client = await CDP({ port });
  } catch {
    console.error(`Could not connect to Chrome on port ${port}.`);
    console.error('Make sure Chrome is running with --remote-debugging-port=' + port);
    console.error('Or run: node scripts/cdp.mjs --launch');
    process.exit(1);
  }

  const { Page, Runtime, Network, Fetch, Target } = client;

  await Promise.all([Page.enable(), Runtime.enable(), Network.enable()]);

  // Handle proxy auth challenge — credentials never go in the CLI flag
  if (proxy?.user) {
    await Fetch.enable({ handleAuthRequests: true });
    Fetch.authRequired(({ requestId, authChallenge }) => {
      if (authChallenge.source === 'Proxy') {
        Fetch.continueWithAuth({
          requestId,
          authChallengeResponse: {
            response: 'ProvideCredentials',
            username: proxy.user,
            password: proxy.pass,
          },
        });
      }
    });
    Fetch.requestPaused(({ requestId }) => Fetch.continueRequest({ requestId }));
  }

  console.log(`Connected to Chrome via CDP on port ${port}`);
  console.log('Domains enabled: Page, Runtime, Network' + (proxy?.user ? ', Fetch (proxy auth)' : '') + '\n');

  // Example: list open tabs
  const targets = await CDP.List({ port });
  console.log('Open tabs:');
  targets.forEach((t, i) => console.log(`  [${i}] ${t.title} — ${t.url}`));

  // Expose client + domains for interactive use
  return { client, Page, Runtime, Network, Fetch, Target };
}

const { client, Page, Runtime } = await connect();
const { Input } = client;

// random delay between min and max ms
const delay = (min, max) => new Promise((res) => setTimeout(res, min + Math.random() * (max - min)));

await Page.navigate({ url: 'https://accounts.google.com/signup' });
await Page.loadEventFired();

// pause like a human reading the page
await delay(1800, 3500);

const { result } = await Runtime.evaluate({ expression: 'document.title' });
console.log('Page title:', result.value);

// move mouse to button area before clicking
const { result: btnBox } = await Runtime.evaluate({
  expression: `
    (() => {
      const btn = document.querySelector('span[jsname="V67aGc"]')?.closest('button');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()
  `,
});

// move mouse to an element and click it
async function moveAndClick(x, y) {
  const steps = 8 + Math.floor(Math.random() * 6);
  const startX = x - 80 + Math.random() * 160;
  const startY = y - 60 + Math.random() * 120;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    await Input.dispatchMouseEvent({
      type: 'mouseMoved',
      x: Math.round(startX + (x - startX) * t + (Math.random() - 0.5) * 4),
      y: Math.round(startY + (y - startY) * t + (Math.random() - 0.5) * 4),
    });
    await delay(20, 60);
  }
  await delay(200, 500);
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await delay(60, 140);
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

// get element center coords by selector
async function getCenter(selector) {
  const { result } = await Runtime.evaluate({
    expression: `
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })()
    `,
  });
  return result.value ? JSON.parse(result.value) : null;
}

// type a string with human keystroke timing
async function humanType(text) {
  for (const char of text) {
    await Input.dispatchKeyEvent({ type: 'keyDown', text: char });
    await Input.dispatchKeyEvent({ type: 'keyUp', text: char });
    await delay(60, 180);
    // occasional longer pause like a human thinking
    if (Math.random() < 0.1) await delay(200, 500);
  }
}

// --- click "Create account" ---
if (btnBox.value) {
  const { x, y } = JSON.parse(btnBox.value);
  await moveAndClick(x, y);
  console.log('Clicked: Create account');
} else {
  console.log('Button not found');
}

// --- wait for form to appear, fill First name ---
await delay(1500, 2500);

const firstNamePos = await getCenter('#firstName');
if (firstNamePos) {
  await moveAndClick(firstNamePos.x, firstNamePos.y);
  await delay(300, 600);
  await humanType('insta2figma');
  console.log('Typed: insta2figma');
} else {
  console.log('First name input not found');
}

// --- click Next (name step) ---
await delay(800, 1600);

const nextPos = await getCenter('#collectNameNext button');
if (nextPos) {
  await moveAndClick(nextPos.x, nextPos.y);
  console.log('Clicked: Next');
} else {
  console.log('Next button not found');
}

// open a Google custom dropdown and pick an option by data-value
async function selectDropdown(containerId, dataValue) {
  // click the combobox trigger to open
  const triggerPos = await getCenter(`#${containerId} [role="combobox"]`);
  if (!triggerPos) { console.log(`Dropdown #${containerId} not found`); return; }
  await moveAndClick(triggerPos.x, triggerPos.y);
  await delay(400, 800);

  // click the option
  const optionPos = await getCenter(`#${containerId} li[data-value="${dataValue}"]`);
  if (!optionPos) { console.log(`Option ${dataValue} in #${containerId} not found`); return; }
  await moveAndClick(optionPos.x, optionPos.y);
  await delay(300, 600);
  console.log(`Selected #${containerId} → data-value=${dataValue}`);
}

// --- birthday + gender form ---
await delay(1500, 2500);

// random adult birthday: age 22–35
const birthYear  = 1990 + Math.floor(Math.random() * 13);   // 1990–2002
const birthMonth = 1    + Math.floor(Math.random() * 12);   // 1–12
const birthDay   = 1    + Math.floor(Math.random() * 28);   // 1–28 (safe for all months)

// Month dropdown
await selectDropdown('month', birthMonth);

// Day input
await delay(400, 800);
const dayPos = await getCenter('#day');
if (dayPos) {
  await moveAndClick(dayPos.x, dayPos.y);
  await delay(300, 500);
  await humanType(String(birthDay));
  console.log(`Typed day: ${birthDay}`);
}

// Year input
await delay(400, 800);
const yearPos = await getCenter('#year');
if (yearPos) {
  await moveAndClick(yearPos.x, yearPos.y);
  await delay(300, 500);
  await humanType(String(birthYear));
  console.log(`Typed year: ${birthYear}`);
}

// Gender dropdown — "Rather not say" = data-value 3
await delay(600, 1200);
await selectDropdown('gender', 3);

// Next button (birthday/gender)
await delay(800, 1600);
const birthdayNextPos = await getCenter('#birthdaygenderNext button');
if (birthdayNextPos) {
  await moveAndClick(birthdayNextPos.x, birthdayNextPos.y);
  console.log('Clicked: Next (birthday/gender)');
} else {
  console.log('Birthday/gender Next button not found');
}

// --- email step: suggested radios OR manual emailPhone input ---
await delay(1500, 2500);

const { result: emailVariant } = await Runtime.evaluate({
  expression: `
    (() => {
      // variant A: suggested radio buttons
      const radios = document.querySelectorAll('input[name="usernameRadio"]:not([value="custom"])');
      if (radios.length) {
        const idx = Math.random() < 0.5 ? 0 : 1;
        const radio = radios[Math.min(idx, radios.length - 1)];
        const container = radio.closest('.sfqPrd');
        if (container) {
          const r = container.getBoundingClientRect();
          return JSON.stringify({ type: 'radio', x: r.left + r.width / 2, y: r.top + r.height / 2, value: radio.value + '@gmail.com' });
        }
      }
      // variant B: free-form emailPhone input
      const input = document.querySelector('#emailPhone');
      if (input) {
        const r = input.getBoundingClientRect();
        return JSON.stringify({ type: 'input', x: r.left + r.width / 2, y: r.top + r.height / 2, value: null });
      }
      return null;
    })()
  `,
});

if (emailVariant.value) {
  const variant = JSON.parse(emailVariant.value);

  if (variant.type === 'radio') {
    await moveAndClick(variant.x, variant.y);
    console.log(`Selected suggested email: ${variant.value}`);
  } else {
    // Google is asking for an existing email or phone — log and pause
    console.log('⚠ Email suggestion not available. Google is asking for an existing email/phone.');
    console.log('  Add a phone number to the script or handle this step manually.');
    // type a fallback email if you have one, e.g.:
    // await moveAndClick(variant.x, variant.y);
    // await humanType('your-phone-or-email-here');
  }
} else {
  console.log('Email step: no element found — page may still be loading');
}

// Next button (email step)
await delay(800, 1600);
const emailNextPos = await getCenter('#next button');
if (emailNextPos) {
  await moveAndClick(emailNextPos.x, emailNextPos.y);
  console.log('Clicked: Next (email)');
} else {
  console.log('Email Next button not found');
}

// --- password step ---
await delay(1500, 2500);

// generate a strong random password: Aa1! + 9 random chars
const pwdChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
const password = 'Aa1!' + Array.from({ length: 9 }, () => pwdChars[Math.floor(Math.random() * pwdChars.length)]).join('');
console.log(`Generated password: ${password}`);

// fill password
const passwdPos = await getCenter('#passwd');
if (passwdPos) {
  await moveAndClick(passwdPos.x, passwdPos.y);
  await delay(300, 600);
  await humanType(password);
  console.log('Typed: password');
}

// fill confirm password — wait for it to appear after typing password
await delay(800, 1200);

// scroll it into view and retry up to 5 times
let confirmPos = null;
for (let i = 0; i < 5; i++) {
  await Runtime.evaluate({
    expression: `document.querySelector('#confirm-passwd input')?.scrollIntoView({ block: 'center' })`,
  });
  confirmPos = await getCenter('#confirm-passwd input');
  if (confirmPos) break;
  await delay(600, 1000);
}

if (confirmPos) {
  await moveAndClick(confirmPos.x, confirmPos.y);
  await delay(300, 600);
  await humanType(password);
  console.log('Typed: confirm password');
} else {
  console.log('Confirm password field not found after retries');
}

// click Next
await delay(800, 1600);
const passwordNextPos = await getCenter('#createpasswordNext button');
if (passwordNextPos) {
  await moveAndClick(passwordNextPos.x, passwordNextPos.y);
  console.log('Clicked: Next (password)');
} else {
  console.log('Password Next button not found');
}

// --- phone verification QR step ---
await delay(2000, 3000);

const { result: qrSrc } = await Runtime.evaluate({
  expression: `document.querySelector('img[alt*="QR"]')?.src ?? null`,
});

if (qrSrc.value) {
  const qrUrl = await decodeQRFromBase64(qrSrc.value);
  if (!qrUrl) { console.log('QR found but could not decode'); process.exit(1); }

  console.log('\nPhone verification QR URL:', qrUrl);

  // open QR URL in a new tab and connect to it
  const { targetId } = await Target.createTarget({ url: qrUrl });
  await delay(2000, 3000);

  const phoneClient = await CDP({ port, target: targetId });
  const phoneRuntime = phoneClient.Runtime;
  const phonePage    = phoneClient.Page;
  const phoneInput   = phoneClient.Input;

  await Promise.all([phonePage.enable(), phoneRuntime.enable()]);
  await phonePage.loadEventFired();
  await delay(1500, 2500);

  const { result: phoneTitle } = await phoneRuntime.evaluate({ expression: 'document.title' });
  console.log('Phone page title:', phoneTitle.value);

  // find "Send SMS" button
  const { result: smsBtnBox } = await phoneRuntime.evaluate({
    expression: `
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => b.querySelector('span[jsname="V67aGc"]')?.textContent.trim() === 'Send SMS'
        );
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })()
    `,
  });

  if (smsBtnBox.value) {
    const { x, y } = JSON.parse(smsBtnBox.value);
    const steps = 8 + Math.floor(Math.random() * 6);
    const sx = x - 80 + Math.random() * 160;
    const sy = y - 60 + Math.random() * 120;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      await phoneInput.dispatchMouseEvent({
        type: 'mouseMoved',
        x: Math.round(sx + (x - sx) * t + (Math.random() - 0.5) * 4),
        y: Math.round(sy + (y - sy) * t + (Math.random() - 0.5) * 4),
      });
      await delay(20, 60);
    }
    await delay(200, 500);
    await phoneInput.dispatchMouseEvent({ type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    await delay(60, 140);
    await phoneInput.dispatchMouseEvent({ type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    console.log('Clicked: Send SMS');
  } else {
    console.log('Send SMS button not found');
  }
} else {
  console.log('No QR code on page — skipping phone verification step');
}
