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
import { Vonage } from '@vonage/server-sdk';
import { SMS } from '@vonage/messages';

// load .env manually (no dotenv dependency needed)
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const FIVESIM_KEY = process.env.SMS5SIM_API_KEY;

// --- 5sim API helpers ---

async function fivesimRequest(path) {
  const res = await fetch(`https://5sim.net/v1${path}`, {
    headers: { Authorization: `Bearer ${FIVESIM_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`5sim ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

// detect proxy country via ip-api.com routed through the proxy
async function getProxyCountry(proxyObj) {
  try {
    const { server, user, pass } = proxyObj;
    const auth = user ? `-U "${user}:${pass}"` : '';
    const out = execSync(
      `curl -s ${auth} --proxy "http://${server}" "http://ip-api.com/json?fields=countryCode"`,
      { timeout: 8000 }
    ).toString();
    const { countryCode } = JSON.parse(out);
    // 5sim uses full country names in lowercase (e.g. "netherlands", "germany")
    const codeToName = {
      nl: 'netherlands', de: 'germany', fr: 'france', gb: 'england',
      us: 'usa', br: 'brazil', pt: 'portugal', es: 'spain',
      it: 'italy', pl: 'poland', ro: 'romania', ua: 'ukraine',
      ru: 'russia', in: 'india', id: 'indonesia', ph: 'philippines',
    };
    const code = countryCode?.toLowerCase();
    const name = codeToName[code] ?? code ?? 'any';
    console.log(`Proxy IP country: ${countryCode} → 5sim: ${name}`);
    return name;
  } catch (e) {
    console.log('Country detection failed:', e.message);
    return 'any';
  }
}

// buy a number for google verification from 5sim
async function buyNumber(country) {
  const service = 'google';
  const endpoint = country === 'any'
    ? `/user/buy/activation/any/any/${service}`
    : `/user/buy/activation/${country}/any/${service}`;
  try {
    return await fivesimRequest(endpoint);
  } catch {
    // fallback to any country
    return await fivesimRequest(`/user/buy/activation/any/any/${service}`);
  }
}

// poll for incoming SMS on the order (max 3 min)
async function waitForSms(orderId) {
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const order = await fivesimRequest(`/user/check/${orderId}`);
    if (order.sms?.length) return order.sms[0].text;
    if (order.status === 'CANCELED') throw new Error('5sim order cancelled');
  }
  throw new Error('5sim SMS timeout after 3 min');
}

async function finishOrder(orderId) {
  await fivesimRequest(`/user/finish/${orderId}`);
}

// --- Vonage SMS sender ---
async function sendViаVonage(toNumber, messageBody) {
  const apiKey    = process.env.VONAGE_API_KEY;
  const apiSecret = process.env.VONAGE_API_SECRET;
  const fromNum   = process.env.VONAGE_FROM_NUMBER ?? 'Vonage';

  if (!apiKey || !apiSecret) throw new Error('VONAGE_API_KEY / VONAGE_API_SECRET not set in .env');

  const vonage = new Vonage({ apiKey, apiSecret });
  const result = await vonage.messages.send(
    new SMS(messageBody, toNumber, fromNum)
  );
  return result.messageUUID;
}

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
}

async function connect() {
  if (shouldLaunch) await launchChrome();

  let client;
  const maxAttempts = 15;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      client = await CDP({ port });
      break;
    } catch {
      if (i === maxAttempts) {
        console.error(`Could not connect to Chrome on port ${port} after ${maxAttempts} attempts.`);
        process.exit(1);
      }
      process.stdout.write(i === 1 ? 'Waiting for Chrome' : '.');
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  console.log(' ready.');

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

const { client, Page, Runtime, Target } = await connect();
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

// open a Google custom dropdown and pick an option by data-value, with retry
async function selectDropdown(containerId, dataValue) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const triggerPos = await getCenter(`#${containerId} [role="combobox"]`);
    if (!triggerPos) { console.log(`Dropdown #${containerId} not found`); return; }
    await moveAndClick(triggerPos.x, triggerPos.y);

    // wait until the listbox is open and the option is visible
    let optionPos = null;
    for (let w = 0; w < 8; w++) {
      await delay(200, 350);
      optionPos = await getCenter(`#${containerId} li[data-value="${dataValue}"]`);
      if (optionPos) break;
    }
    if (!optionPos) { console.log(`Option ${dataValue} not visible in #${containerId}`); continue; }

    // scroll the option into view before clicking
    await Runtime.evaluate({
      expression: `document.querySelector('#${containerId} li[data-value="${dataValue}"]')?.scrollIntoView({ block: 'nearest' })`,
    });
    await delay(150, 300);
    optionPos = await getCenter(`#${containerId} li[data-value="${dataValue}"]`);
    await moveAndClick(optionPos.x, optionPos.y);
    await delay(400, 700);

    // confirm selection: selected value span should no longer be empty
    const { result: selected } = await Runtime.evaluate({
      expression: `document.querySelector('#${containerId} [role="combobox"] [jsname="Fb0Bif"]')?.textContent?.trim()`,
    });
    if (selected.value) {
      console.log(`Selected #${containerId} → "${selected.value}"`);
      return;
    }
    console.log(`#${containerId} selection not confirmed, retrying (${attempt}/3)…`);
  }
  console.log(`Failed to select #${containerId} after 3 attempts`);
}

// clear an input and type a new value
async function clearAndType(selector, text) {
  const pos = await getCenter(selector);
  if (!pos) { console.log(`Input ${selector} not found`); return; }
  await moveAndClick(pos.x, pos.y);
  await delay(200, 400);
  // select all + delete
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'a', modifiers: 2 });
  await Input.dispatchKeyEvent({ type: 'keyUp',   key: 'a', modifiers: 2 });
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Backspace' });
  await Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Backspace' });
  await delay(150, 300);
  await humanType(text);

  // verify value
  const { result } = await Runtime.evaluate({
    expression: `document.querySelector('${selector}')?.value`,
  });
  if (result.value === text) {
    console.log(`Typed ${selector}: ${text}`);
  } else {
    console.log(`⚠ ${selector} value mismatch — got "${result.value}", expected "${text}"`);
  }
}

// --- birthday + gender form ---
await delay(1500, 2500);

// random adult birthday: age 22–35
const birthYear  = 1990 + Math.floor(Math.random() * 13);
const birthMonth = 1    + Math.floor(Math.random() * 12);
const birthDay   = 1    + Math.floor(Math.random() * 28);

await selectDropdown('month', birthMonth);
await delay(400, 700);
await clearAndType('#day',  String(birthDay));
await delay(400, 700);
await clearAndType('#year', String(birthYear));
await delay(600, 1200);
await selectDropdown('gender', 3);

// verify all birthday fields before proceeding
await delay(400, 700);
const { result: bdVerify } = await Runtime.evaluate({
  expression: `
    (() => {
      const month = document.querySelector('#month [role="combobox"] [jsname="Fb0Bif"]')?.textContent?.trim()
                 || document.querySelector('#month [role="combobox"] [jsname="V67aGc"]')?.textContent?.trim();
      const day   = document.querySelector('#day')?.value;
      const year  = document.querySelector('#year')?.value;
      const gender = document.querySelector('#gender [role="combobox"] [jsname="Fb0Bif"]')?.textContent?.trim()
                  || document.querySelector('#gender [role="combobox"] [jsname="V67aGc"]')?.textContent?.trim();
      return JSON.stringify({ month, day, year, gender });
    })()
  `,
});
console.log('Birthday/gender verify:', bdVerify.value);

// Next button (birthday/gender)
await delay(800, 1600);
const birthdayNextPos = await getCenter('#birthdaygenderNext button');
if (birthdayNextPos) {
  await moveAndClick(birthdayNextPos.x, birthdayNextPos.y);
  console.log('Clicked: Next (birthday/gender)');
} else {
  console.log('Birthday/gender Next button not found');
}

// --- email step: poll until radio suggestions OR emailPhone input appears ---
let emailVariant = null;
for (let w = 0; w < 20; w++) {
  await delay(600, 900);
  const { result } = await Runtime.evaluate({
    expression: `
      (() => {
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
        const input = document.querySelector('#emailPhone');
        if (input) {
          const r = input.getBoundingClientRect();
          return JSON.stringify({ type: 'input', x: r.left + r.width / 2, y: r.top + r.height / 2, value: null });
        }
        return null;
      })()
    `,
  });
  if (result.value) { emailVariant = JSON.parse(result.value); break; }
}

const emailVariantResult = { value: emailVariant ? JSON.stringify(emailVariant) : null };

if (emailVariantResult.value) {
  const variant = JSON.parse(emailVariantResult.value);

  if (variant.type === 'radio') {
    // scroll the option into view before clicking
    await Runtime.evaluate({
      expression: `document.querySelector('input[name="usernameRadio"][value="${variant.value.replace('@gmail.com','')}"]')?.closest('.sfqPrd')?.scrollIntoView({ block: 'center' })`,
    });
    await delay(300, 500);

    // refresh coords after scroll, then mouse click
    const freshPos = await getCenter(`input[name="usernameRadio"][value="${variant.value.replace('@gmail.com','')}"]`);
    if (freshPos) await moveAndClick(freshPos.x, freshPos.y);

    // verify radio is checked; fallback to JS click if not
    const { result: radioChecked } = await Runtime.evaluate({
      expression: `document.querySelector('input[name="usernameRadio"][value="${variant.value.replace('@gmail.com','')}"]')?.checked`,
    });
    if (!radioChecked.value) {
      await Runtime.evaluate({
        expression: `document.querySelector('input[name="usernameRadio"][value="${variant.value.replace('@gmail.com','')}"]')?.closest('[role="presentation"], .sfqPrd, div')?.click()`,
      });
      await delay(300, 500);
    }
    console.log(`Selected suggested email: ${variant.value}`);
  } else {
    console.log('⚠ Email suggestion not available. Google is asking for an existing email/phone.');
  }
} else {
  console.log('Email step: no element found after polling — page may not have loaded');
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

// --- phone verification step ---
await delay(2000, 3000);

// poll for QR image OR phone number input
let verifyQrSrc = null;
let verifyPhonePos = null;
for (let w = 0; w < 15; w++) {
  await delay(600, 900);
  const { result: pageState } = await Runtime.evaluate({
    expression: `
      (() => {
        const qr = document.querySelector('img[alt*="QR"]');
        if (qr) return JSON.stringify({ type: 'qr', src: qr.src });
        const ph = document.querySelector('input[name="phoneNumberId"], #phoneNumberId');
        if (ph) {
          const r = ph.getBoundingClientRect();
          return JSON.stringify({ type: 'phone', x: r.left + r.width/2, y: r.top + r.height/2 });
        }
        return null;
      })()
    `,
  });
  if (pageState.value) {
    const s = JSON.parse(pageState.value);
    if (s.type === 'qr')    { verifyQrSrc = s.src; break; }
    if (s.type === 'phone') { verifyPhonePos = { x: s.x, y: s.y }; break; }
  }
}

// --- Flow A: QR device verification → open tab → click Send SMS → Vonage ---
if (verifyQrSrc) {
  const qrUrl = await decodeQRFromBase64(verifyQrSrc);
  if (!qrUrl) { console.log('Could not decode QR'); }
  else {
    console.log('QR URL:', qrUrl);

    // open in blank tab so interceptor is in place before page loads
    const { targetId } = await Target.createTarget({ url: 'about:blank' });
    await delay(400, 700);

    const phoneClient  = await CDP({ port, target: targetId });
    const phoneRuntime = phoneClient.Runtime;
    const phonePage    = phoneClient.Page;
    const phoneInput   = phoneClient.Input;
    await Promise.all([phoneRuntime.enable(), phonePage.enable()]);

    // capture sms: URL via CDP navigation event + JS interceptor
    let capturedSmsUrl = null;
    phonePage.frameRequestedNavigation(({ url }) => {
      if (url?.startsWith('sms:')) { capturedSmsUrl = url; console.log('CDP sms: captured:', url); }
    });
    await phonePage.addScriptToEvaluateOnNewDocument({
      source: `(function(){
        const trap=(u)=>{if(u&&String(u).startsWith('sms:'))window.__smsUrl=String(u);};
        const o=window.open; window.open=function(u,...a){trap(u);return o?.apply(this,[u,...a]);};
        const oa=location.assign.bind(location); location.assign=function(u){trap(u);return oa(u);};
        try{Object.defineProperty(location,'href',{set(u){trap(u);oa(u);}});}catch(_){}
        document.addEventListener('click',(e)=>{const a=e.target.closest('a');if(a?.href?.startsWith('sms:'))trap(a.href);},true);
      })();`,
    });

    await phonePage.navigate({ url: qrUrl });

    // poll for Send SMS button
    let smsBtnPos = null;
    for (let w = 0; w < 20; w++) {
      await delay(500, 800);
      const { result } = await phoneRuntime.evaluate({
        expression: `(() => {
          const btn = [...document.querySelectorAll('button')].find(
            b => b.querySelector('span[jsname="V67aGc"]')?.textContent.trim() === 'Send SMS'
          );
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 });
        })()`,
      });
      if (result.value) { smsBtnPos = JSON.parse(result.value); break; }
    }

    if (smsBtnPos) {
      const { x, y } = smsBtnPos;
      const steps = 8 + Math.floor(Math.random() * 6);
      const sx = x - 80 + Math.random() * 160, sy = y - 60 + Math.random() * 120;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        await phoneInput.dispatchMouseEvent({ type: 'mouseMoved',
          x: Math.round(sx + (x-sx)*t + (Math.random()-.5)*4),
          y: Math.round(sy + (y-sy)*t + (Math.random()-.5)*4) });
        await delay(20, 60);
      }
      await delay(200, 500);
      await phoneInput.dispatchMouseEvent({ type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      await delay(60, 140);
      await phoneInput.dispatchMouseEvent({ type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      console.log('Clicked: Send SMS');

      await delay(1000, 1500);
      const { result: jsCapture } = await phoneRuntime.evaluate({ expression: `window.__smsUrl ?? null` });
      const rawSmsUrl = capturedSmsUrl ?? jsCapture.value ?? null;

      if (rawSmsUrl) {
        const smsUrl   = new URL(rawSmsUrl);
        const toPhone  = smsUrl.host || smsUrl.pathname.replace(/^\/+/, '').split(/[/?&]/)[0];
        const bodyMatch = rawSmsUrl.match(/[?&]body=([^&\s]*)/);
        const msgBody  = bodyMatch ? decodeURIComponent(bodyMatch[1]) : '';
        console.log(`sms: → to: ${toPhone}, body: ${msgBody}`);

        try {
          const uuid = await sendViаVonage(toPhone, msgBody);
          console.log(`SMS sent via Vonage ✓ (uuid: ${uuid})`);
        } catch (e) {
          console.log('Vonage send failed:', e.message);
        }
      } else {
        console.log('sms: URL not captured');
      }
    } else {
      console.log('Send SMS button not found');
    }
  }

// --- Flow B: Phone number input → 5sim OTP ---
} else if (verifyPhonePos) {
  const proxyCountry = proxy ? await getProxyCountry(proxy) : 'any';
  console.log(`Proxy country: ${proxyCountry}`);

  if (FIVESIM_KEY) {
    try {
      const order = await buyNumber(proxyCountry);
      console.log(`5sim number: +${order.phone}`);

      await moveAndClick(verifyPhonePos.x, verifyPhonePos.y);
      await delay(300, 500);
      await humanType(order.phone);

      await delay(800, 1400);
      const phoneNextPos = await getCenter('#next button, #sendVerificationCode button');
      if (phoneNextPos) { await moveAndClick(phoneNextPos.x, phoneNextPos.y); console.log('Clicked: Send code'); }

      const smsText = await waitForSms(order.id);
      console.log('OTP SMS:', smsText);
      const codeMatch = smsText.match(/\b(\d{6})\b/);
      if (codeMatch) {
        const otp = codeMatch[1];
        await delay(1000, 1500);
        const otpPos = await getCenter('input[name="code"], #code');
        if (otpPos) {
          await moveAndClick(otpPos.x, otpPos.y);
          await humanType(otp);
          await delay(800, 1400);
          const verifyPos = await getCenter('#next button');
          if (verifyPos) { await moveAndClick(verifyPos.x, verifyPos.y); console.log('Clicked: Verify'); }
        }
      }
      await finishOrder(order.id);
    } catch (e) {
      console.log('5sim OTP flow failed:', e.message);
    }
  } else {
    console.log('FIVESIM_KEY not set — cannot complete phone OTP verification');
  }

} else {
  console.log('No phone verification page detected — may have been skipped or already verified');
}
