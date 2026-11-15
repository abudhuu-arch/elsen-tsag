// Browser tests for Элсэн цаг.
//   cd tests && npm install && npm run setup && npm test
// A Chromium build can also be given with PW_CHROMIUM=/path/to/chrome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
let server, base, browser;

before(async () => {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
after(async () => { await browser?.close(); server?.close(); });

// A fresh phone-sized page with empty storage; fails the test on any page error.
async function open(t, seed, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['notifications'], acceptDownloads: true, ...(opts.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}), ...(opts.tz ? { timezoneId: opts.tz } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  if (seed) await ctx.addInitScript(`if(!sessionStorage.getItem('__seeded')){localStorage.clear();(${seed})();sessionStorage.setItem('__seeded','1')}`);
  await page.goto(base + (opts.query || ''));
  t.after(async () => { assert.deepEqual(errors, [], 'page errors'); await ctx.close(); });
  return { page, ctx };
}
const keyAgo = days => { const d = new Date(); d.setDate(d.getDate() - days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('index.html is well-formed: no script text leaks into the page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  const outside = html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.doesNotMatch(outside, /\b(const|let|function)\s+\w+\s*[=(]/);
});

test('loads with all four tabs and the hourglass', async t => {
  const { page } = await open(t);
  assert.equal(await page.locator('nav.tabs button').count(), 4);
  for (const v of ['v-sw', 'v-food', 'v-stat', 'v-day']) {
    await page.click(`nav.tabs button[data-v="${v}"]`);
    assert.ok(await page.$eval('#' + v, e => e.offsetHeight > 0), v);
  }
  assert.match(await page.textContent('#clock'), /^\d\d:\d\d:\d\d$/);
  assert.equal(await page.locator('#tasks .task').count(), 6);
});

test('old saved data migrates without losing history', async t => {
  const hist = { [keyAgo(3)]: { t1: '08:00', t5: '21:00' } };
  const { page } = await open(t, `()=>{localStorage.elsen_cfg=${JSON.stringify(JSON.stringify({ dayStart: '00:00', sleepS: '23:00', sleepE: '07:00', workS: '09:00', workE: '18:00', tasks: [{ id: 't1', name: 'Гадаад хэл' }, { id: 't5', name: 'Ном унших 30 минут' }] }))};localStorage.elsen_hist=${JSON.stringify(JSON.stringify(hist))}}`);
  const tasks = await page.evaluate(() => cfg.tasks);
  assert.deepEqual(tasks, [{ id: 't1', name: 'Гадаад хэл', min: 0, rem: '' }, { id: 't5', name: 'Ном унших 30 минут', min: 30, rem: '' }]);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.elsen_hist)), hist);
  assert.deepEqual(await page.$$eval('.tbtn', b => b.map(x => x.textContent)), ['▶ 30м']);
});

test('corrupted or hand-edited data does not break the app', async t => {
  const bad = {
    elsen_cfg: { dayStart: 'abc', sleepS: 5, tasks: [{ id: 't1', name: 'Ном 20 мин', min: 'x', rem: '25:99' }, null, { name: 'no id' }, { id: 7, name: 'Гүйх', min: 99999 }] },
    elsen_hist: { '2026-01-01': 'oops', [keyAgo(1)]: { t1: '08:00' } },
    elsen_tm: { x: 5, [keyAgo(1)]: { t1: { acc: 'no' }, t7: { acc: 60000, run: 'later' } } },
    elsen_snap: { [keyAgo(1)]: 'nope' }, elsen_sw: { acc: 'z', laps: 3 }, elsen_pantry: { a: 1 }, elsen_plan: { days: 'no' }
  };
  const { page } = await open(t, `()=>{const b=${JSON.stringify(bad)};for(const k in b)localStorage.setItem(k,JSON.stringify(b[k]))}`);
  const c = await page.evaluate(() => cfg);
  assert.equal(c.dayStart, '00:00'); assert.equal(c.sleepS, '23:00');
  assert.deepEqual(c.tasks, [{ id: 't1', name: 'Ном 20 мин', min: 20, rem: '' }, { id: '7', name: 'Гүйх', min: 600, rem: '' }]);
  assert.match(await page.textContent('#clock'), /^\d\d:\d\d:\d\d$/);
  for (const v of ['v-sw', 'v-food', 'v-stat']) await page.click(`nav.tabs button[data-v="${v}"]`);
});

test('ticking a task updates count, week and storage; keyboard works', async t => {
  const { page } = await open(t);
  await page.click('.task[data-id="t2"]');
  assert.equal(await page.textContent('#cnt'), '1');
  assert.equal(await page.$eval('.day.today .dot', e => e.textContent), '1');
  await page.focus('.task[data-id="t3"]'); await page.keyboard.press('Space');
  assert.equal(await page.getAttribute('.task[data-id="t3"]', 'aria-checked'), 'true');
  const h = JSON.parse(await page.evaluate(() => localStorage.elsen_hist));
  assert.deepEqual(Object.keys(Object.values(h).find(d => Object.keys(d).length)).sort(), ['t2', 't3']);
});

test('task timer counts down, pauses, and completes the task', async t => {
  const { page } = await open(t);
  await page.click('.task[data-id="t5"] .tbtn');
  await page.waitForTimeout(1100); await page.evaluate(() => tick());
  assert.match(await page.textContent('.task[data-id="t5"] .tbtn'), /^⏸ 29:5\d$/);
  await page.evaluate(() => { const s = tm[dayKey(new Date())].t5; s.run = Date.now() - 31 * 60000; });
  await page.evaluate(() => tick());
  assert.equal(await page.getAttribute('.task[data-id="t5"]', 'aria-checked'), 'true');
  assert.match(await page.textContent('#toastMsg'), /дууслаа/);
});

test('a countdown running over the day boundary continues on the new day', async t => {
  const { page } = await open(t);
  const r = await page.evaluate(() => {
    cfg.tasks.find(x => x.id === 't5').min = 3000;
    const today = dayKey(new Date()), b = dayStartTime(today).getTime(), y = dayKey(new Date(b - 3600000));
    tm[y] = { t5: { acc: 8 * 60000, run: b - 2 * 60000, base: 0 } };
    const expected = 10 * 60000 + (Date.now() - b);
    tick();
    return { old: tm[y].t5, moved: Math.abs(tmProg(tm[today].t5) - expected) < 2000, running: !!tm[today].t5.run };
  });
  assert.equal(r.old.run, null); assert.equal(r.old.acc, 10 * 60000);
  assert.ok(r.moved); assert.ok(r.running);
});

test('reminder fires once, and a missed one is marked late', async t => {
  const { page } = await open(t);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(() => {
    const at = m => { const d = new Date(Date.now() + m * 60000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    cfg.tasks[0].rem = at(-2); cfg.tasks[1].rem = at(-120); store.set('elsen_cfg', cfg);
    // Record only: newer headless Chromium rejects real notifications, which would make the app's fallback count twice.
    window.__n = [];
    ServiceWorkerRegistration.prototype.showNotification = function (a) { __n.push(a); return Promise.resolve(); };
    window.Notification = class { constructor(a) { __n.push(a); } static get permission() { return 'granted'; } };
    lastRemCheck = -1; tick();
  });
  await page.waitForTimeout(300);
  assert.equal((await page.evaluate(() => __n)).length, 1);
  assert.ok(await page.$eval('.task[data-id="t2"] .tm', e => e.classList.contains('late')));
  await page.evaluate(() => { lastRemCheck = -1; tick(); });
  await page.waitForTimeout(200);
  assert.equal((await page.evaluate(() => __n)).length, 1, 'not sent twice');
});

test('stopwatch laps, persists, and credits time to a task', async t => {
  const { page } = await open(t);
  await page.click('nav.tabs button[data-v="v-sw"]');
  await page.click('#swFor .chip:has-text("Гадаад хэл")');
  await page.click('#swGo'); await page.waitForTimeout(600);
  await page.click('#swLap'); await page.waitForTimeout(300); await page.click('#swGo');
  assert.equal(await page.locator('.lap').count(), 1);
  assert.ok(await page.evaluate(() => tm[dayKey(new Date())].t1.acc > 800));
  await page.reload();
  assert.equal(await page.evaluate(() => document.querySelector('.view.on').id), 'v-sw');
  assert.equal(await page.locator('.lap').count(), 1);
});

test('food plan works offline (fallbackPlan) and through Claude when available', async t => {
  const { page } = await open(t);
  await page.click('nav.tabs button[data-v="v-food"]');
  await page.click('#quick .chip:has-text("Өндөг")');
  await page.fill('#note', 'загас идэхгүй'); await page.dispatchEvent('#note', 'change');
  await page.click('#gen'); await page.waitForTimeout(200);
  const p = await page.evaluate(() => plan);
  assert.equal(p.src, 'local'); assert.equal(p.days.length, 7);
  assert.ok(!JSON.stringify(p.days).toLowerCase().includes('загас'));
  await page.evaluate(() => { window.claude = { use: async n => { if (n !== 'sample') return null; const f = async () => ({ text: '' }); f.json = async () => ({ days: [{ day: 'Даваа', breakfast: 'A', lunch: 'B', dinner: 'C', snack: 'D', workout: ['W'] }], uses: [], tips: [] }); return f; } }; });
  await page.click('#gen'); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => plan.src), 'claude');
});

test('backup downloads, restores, and can be undone', async t => {
  const { page } = await open(t, `()=>{localStorage.elsen_hist=${JSON.stringify(JSON.stringify({ [keyAgo(2)]: { t1: '08:00' } }))};localStorage.elsen_pantry='["Өндөг"]'}`);
  await page.click('#openSet');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  const file = path.join(os.tmpdir(), `elsen-${Date.now()}.json`); await dl.saveAs(file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.app, 'elsen-tsag'); assert.ok(j.data.elsen_cfg && j.data.elsen_hist);
  await page.evaluate(() => { localStorage.elsen_pantry = '["Мах"]'; });
  await page.reload(); await page.click('#openSet');
  await page.setInputFiles('#importFile', file);
  await Promise.all([page.waitForNavigation(), page.click('#toastBtn')]);
  assert.equal(await page.evaluate(() => localStorage.elsen_pantry), '["Өндөг"]');
  await page.waitForSelector('#toastBtn:not([hidden])');
  await Promise.all([page.waitForNavigation(), page.click('#toastBtn')]);
  assert.equal(await page.evaluate(() => localStorage.elsen_pantry), '["Мах"]');
  fs.unlinkSync(file);
});

test('monthly stats count only days since first use', async t => {
  const hist = {}; for (let i = 1; i <= 3; i++) hist[keyAgo(i)] = { t1: '1', t2: '1', t3: '1', t4: '1', t5: '1', t6: '1' };
  const { page } = await open(t, `()=>{localStorage.elsen_hist=${JSON.stringify(JSON.stringify(hist))}}`, { query: '?v=v-stat' });
  assert.equal(await page.evaluate(() => document.querySelector('.view.on').id), 'v-stat');
  const r = await page.evaluate(() => { const today = dayKey(new Date()), [y, m] = today.split('-').map(Number); return monthSummary(y, m - 1, firstUseKey(), today); });
  const inMonth = Object.keys(hist).filter(k => k.slice(0, 7) === keyAgo(0).slice(0, 7)).length;
  assert.equal(r.full, inMonth);
  assert.equal(r.counted.length, inMonth + 1);
});

test('works offline after the first visit (service worker)', async t => {
  const { page, ctx } = await open(t);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await ctx.setOffline(true);
  await page.reload();
  assert.equal(await page.title(), 'Элсэн цаг');
  assert.equal(await page.locator('#tasks .task').count(), 6);
  assert.ok(await page.evaluate(() => document.fonts.check('16px Manrope', 'Өдөр')));
  await ctx.setOffline(false);
});

test('phone: back button, settings scroll lock, reminder clear, keyboard, 16px fields', async t => {
  const { page } = await open(t, null, { mobile: true });
  const view = () => page.evaluate(() => document.querySelector('.view.on').id);
  const sheetOn = () => page.evaluate(() => document.getElementById('sheet').classList.contains('on'));
  // Android back: another tab → Day; Day → (would leave the app)
  await page.tap('nav.tabs button[data-v="v-stat"]');
  await page.tap('nav.tabs button[data-v="v-sw"]');
  assert.equal(await view(), 'v-sw');
  await page.goBack({ waitUntil: 'commit' }); await page.waitForFunction(() => document.getElementById('v-day').classList.contains('on'));
  // tapping Day in the bar after another tab leaves no extra history entry behind
  await page.tap('nav.tabs button[data-v="v-food"]'); await page.tap('nav.tabs button[data-v="v-day"]');
  assert.equal(await page.evaluate(() => history.state), null);
  // Settings: page behind it is pinned at its scroll position, back closes it and restores the scroll
  await page.evaluate(() => window.scrollTo(0, 300)); const y = await page.evaluate(() => scrollY);
  await page.evaluate(() => document.getElementById('openSet').click()); assert.ok(await sheetOn());  // tap() would scroll to the button first
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).position), 'fixed');
  await page.goBack({ waitUntil: 'commit' }); await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('on'));
  assert.equal(await page.evaluate(() => scrollY), y);
  assert.equal(await view(), 'v-day');
  // Closing with the button also removes the history entry it added
  await page.tap('#openSet'); await page.tap('#close');
  await page.waitForFunction(() => !(history.state && history.state.sheet));
  // Fields are 16px so iPhone does not zoom in; reminder can be cleared
  await page.tap('#openSet');
  assert.equal(await page.$eval('.editbox input.nm', e => getComputedStyle(e).fontSize), '16px');
  const rem = page.locator('.editbox').first().locator('input[type=time]');
  await rem.fill('09:30');
  const clr = page.locator('.editbox').first().locator('.remclr');
  assert.ok(await clr.isVisible());
  await clr.tap();
  assert.equal(await page.evaluate(() => draft[0].rem), '');
  assert.ok(!(await clr.isVisible()));
  // Keyboard up → tab bar hidden
  await page.locator('.editbox input.nm').first().focus();
  assert.ok(await page.evaluate(() => document.body.classList.contains('typing')));
  await page.locator('.editbox input.nm').first().blur();
  await page.waitForFunction(() => !document.body.classList.contains('typing'));
  // iPhone launch screens exist for every <link> declared
  for (const href of await page.$$eval('link[rel=apple-touch-startup-image]', ls => ls.map(l => l.getAttribute('href'))))
    assert.ok(fs.existsSync(path.join(ROOT, href)), href);
});

test('daylight saving days (Prague: 23 h in March, 25 h in October) keep the day and the sand right', async t => {
  const { page } = await open(t, null, { tz: 'Europe/Prague' });
  const r = await page.evaluate(() => {
    cfg.dayStart = '05:00';
    const H = 3600000, b = d => { const x = dayBounds(d); return (x.end - x.start) / H; };
    const frac = d => { const x = dayBounds(d); return (d - x.start) / (x.end - x.start); };
    const fall = new Date(2026, 9, 25, 2, 59);          // 02:59 CEST, a minute later the clock shows 02:00 CET
    return {
      spring: dayKey(new Date(2026, 2, 29, 5, 30)), beforeStart: dayKey(new Date(2026, 9, 25, 4, 30)),
      // with the day starting 05:00 the 02:00 change falls in the day that began the morning before
      hSpring: b(new Date(2026, 2, 28, 12)), hFall: b(new Date(2026, 9, 24, 12)), hNormal: b(new Date(2026, 10, 15, 12)),
      grows: frac(new Date(fall.getTime() + 60000)) > frac(fall),
      week: (() => { cfg.dayStart = '00:00'; return true; })(),
    };
  });
  assert.equal(r.spring, '2026-03-29');
  assert.equal(r.beforeStart, '2026-10-24');
  assert.deepEqual([r.hSpring, r.hFall, r.hNormal], [23, 25, 24]);
  assert.ok(r.grows, 'sand never flows backwards when the clocks go back');
});

test('the clock keeps running even if one update throws; hero animates only on the Day tab', async t => {
  const { page } = await open(t);
  await page.evaluate(() => { const orig = checkTimers; let once = true; window.checkTimers = checkTimers = () => { if (once) { once = false; throw new Error('boom'); } orig(); }; });
  const a = await page.textContent('#clock');
  await page.waitForFunction(x => document.getElementById('clock').textContent !== x, a, { timeout: 3000 });
  assert.match(await page.textContent('#clock'), /^\d\d:\d\d:\d\d$/);
  assert.ok(await page.evaluate(() => gRaf !== 0));
  await page.click('nav.tabs button[data-v="v-stat"]');
  assert.equal(await page.evaluate(() => gRaf), 0);
  assert.equal(await page.evaluate(() => cfg.sandSound), false);
});

test('shift rotation: hours follow the running shift and switch every N days', async t => {
  const { page } = await open(t);
  await page.click('#openSet');
  await page.check('#shiftOn', { force: true });
  assert.ok(await page.isVisible('#shiftSec')); assert.ok(!(await page.isVisible('#fixedSch')));
  assert.equal(await page.locator('#shiftList .shbox').count(), 3);
  // night shift is running since 2 days ago, rotates every 7 days
  await page.selectOption('#shiftCur', '2');
  await page.fill('#shiftFrom', keyAgo(2)); await page.dispatchEvent('#shiftFrom', 'change');
  await page.click('#save');
  const r = await page.evaluate(() => {
    const k = dayKey(new Date()), now = shiftOn(k), later = shiftOn(addDays(k, 5)), before = shiftOn(addDays(k, -3));
    return { now: now.shift.name, day: now.day, later: later.shift.name, laterDay: later.day, before: before.shift.name,
      sch: sch(k), b23: blockAt(23 * 60), b12: blockAt(12 * 60), saved: JSON.parse(localStorage.elsen_cfg).shifts.on };
  });
  assert.equal(r.now, 'Шөнийн ээлж'); assert.equal(r.day, 3);
  assert.equal(r.later, 'Өглөөний ээлж'); assert.equal(r.laterDay, 1);   // wraps round to the first shift
  assert.equal(r.before, 'Оройн ээлж');
  assert.equal(r.b23, 'work'); assert.equal(r.b12, 'sleep');
  assert.ok(r.saved);
  assert.match(await page.textContent('#shiftInfo'), /Шөнийн ээлж · 3\/7/);
  // reopening settings shows the same running shift
  await page.click('#openSet');
  assert.equal(await page.inputValue('#shiftCur'), '2');
});
