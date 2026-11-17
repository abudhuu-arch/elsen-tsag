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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['notifications', 'clipboard-read', 'clipboard-write'], acceptDownloads: true, ...(opts.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}), ...(opts.tz ? { timezoneId: opts.tz } : {}) });
  const page = await ctx.newPage();
  if (opts.time) await page.clock.setFixedTime(opts.time);     // Date fixed, timers still run
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
  assert.deepEqual(tasks, [{ id: 't1', name: 'Гадаад хэл', min: 0, rem: '', unit: '', link: '', freq: { t: 'daily' } }, { id: 't5', name: 'Ном унших 30 минут', min: 30, rem: '', unit: '', link: '', freq: { t: 'daily' } }]);
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
  assert.deepEqual(c.tasks, [{ id: 't1', name: 'Ном 20 мин', min: 20, rem: '', unit: '', link: '', freq: { t: 'daily' } }, { id: '7', name: 'Гүйх', min: 600, rem: '', unit: '', link: '', freq: { t: 'daily' } }]);
  assert.match(await page.textContent('#clock'), /^\d\d:\d\d:\d\d$/);
  for (const v of ['v-sw', 'v-food', 'v-stat']) await page.click(`nav.tabs button[data-v="${v}"]`);
});

test('ticking a task updates count, week and storage; keyboard works', async t => {
  const { page } = await open(t);
  await page.click('.task[data-id="t6"]');                     // t2 is the water task: a tap there adds a cup
  assert.equal(await page.textContent('#cnt'), '1');
  assert.equal(await page.$eval('.day.today .dot', e => e.textContent), '1');
  await page.focus('.task[data-id="t3"]'); await page.keyboard.press('Space');
  assert.equal(await page.getAttribute('.task[data-id="t3"]', 'aria-checked'), 'true');
  const h = JSON.parse(await page.evaluate(() => localStorage.elsen_hist));
  assert.deepEqual(Object.keys(Object.values(h).find(d => Object.keys(d).length)).sort(), ['t3', 't6']);
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
  assert.match(await page.textContent('.task[data-id="t2"] .tm'), /^💧 0\/8 · ⏰ \d\d:\d\d$/);   // water task keeps its reminder
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

test('backup by copy and paste: copies all data, paste restores it, bad text is refused', async t => {
  const { page } = await open(t, `()=>{localStorage.elsen_pantry='["Өндөг"]'}`);
  await page.click('#openSet');
  await page.click('#copyBtn');
  const txt = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(JSON.parse(txt).app, 'elsen-tsag');
  assert.deepEqual(JSON.parse(txt).data.elsen_pantry, ['Өндөг']);
  await page.evaluate(() => { localStorage.elsen_pantry = '["Мах"]'; });
  await page.click('#pasteBtn');
  await page.waitForFunction(x => document.getElementById('pasteIn').value === x, txt);   // picked up from the clipboard
  await page.fill('#pasteIn', 'юу ч биш');
  await page.click('#pasteGo');
  assert.match(await page.textContent('#toastMsg'), /нөөц биш/);
  await page.fill('#pasteIn', txt);
  await page.click('#pasteGo');
  await Promise.all([page.waitForNavigation(), page.click('#toastBtn')]);
  assert.equal(await page.evaluate(() => localStorage.elsen_pantry), '["Өндөг"]');
});

test('water: count cups, tap a cup, goal from settings, shown in stats', async t => {
  const { page } = await open(t);
  assert.equal(await page.locator('#cups .cup').count(), 8);
  for (let i = 0; i < 3; i++) await page.click('#wPlus');
  assert.equal(await page.textContent('#wCnt'), '3');
  await page.click('#cups .cup >> nth=5');                 // fill up to the 6th cup
  assert.equal(await page.textContent('#wCnt'), '6');
  await page.click('#cups .cup >> nth=5');                 // tapping the last full cup takes one back
  assert.equal(await page.textContent('#wCnt'), '5');
  await page.click('#wMinus');
  assert.equal(await page.evaluate(() => water[dayKey(new Date())]), 4);
  await page.click('#openSet'); await page.fill('#waterGoalIn', '0'); await page.click('#save');
  assert.ok(!(await page.isVisible('#waterSec')));
  await page.click('nav.tabs button[data-v="v-stat"]');
  assert.match(await page.textContent('#dayInfo'), /💧 4 аяга ус/);
  assert.match(await page.textContent('#moreTiles'), /Ус · өдрийн дундаж\s*4/);
});

test('task amounts: log km on a task, shown in day details and month total', async t => {
  const { page } = await open(t);
  await page.click('#openSet');
  await page.locator('.editbox').nth(3).locator('input.unit').fill('км');   // "Алхах 30 минут"
  await page.click('#save');
  const card = page.locator('#tasks .task').nth(3);
  await card.locator('.tqty').click();
  await card.locator('.tqin').fill('5,5');                 // comma works as a decimal point
  await card.locator('.tqin').press('Enter');
  assert.equal(await card.locator('.tqty').textContent(), '5.5 км');
  assert.equal(await page.evaluate(() => (qty[dayKey(new Date())] || {}).t4), 5.5);
  assert.equal(await card.getAttribute('aria-checked'), 'false');   // logging an amount does not tick the task
  await page.click('nav.tabs button[data-v="v-stat"]');
  assert.match(await page.textContent('#dayInfo'), /5\.5 км/);
  assert.match(await page.textContent('#perTask'), /Нийт 5\.5 км · 1 өдөр/);
  // clearing the field removes it
  await page.click('nav.tabs button[data-v="v-day"]');
  await card.locator('.tqty').click(); await card.locator('.tqin').fill(''); await card.locator('.tqin').press('Enter');
  assert.equal(await card.locator('.tqty').textContent(), '+ км');
});

test('evening review: hidden by day, shown in the evening, rating + note saved and in stats', async t => {
  const day = new Date(); day.setHours(11, 0, 0, 0);
  const { page: p1 } = await open(t, null, { time: day });
  assert.ok(!(await p1.isVisible('#reviewSec')));
  const eve = new Date(); eve.setHours(20, 30, 0, 0);
  const { page } = await open(t, null, { time: eve });
  assert.ok(await page.isVisible('#reviewSec'));
  await page.click('#rates button >> nth=3');
  await page.fill('#revNote', 'Гүйлт сайхан байлаа');
  await page.press('#revNote', 'Enter');
  const r = await page.evaluate(() => review[dayKey(new Date())]);
  assert.deepEqual(r, { r: 4, n: 'Гүйлт сайхан байлаа' });
  assert.equal(await page.getAttribute('#rates button >> nth=3', 'aria-checked'), 'true');
  await page.click('nav.tabs button[data-v="v-stat"]');
  assert.match(await page.textContent('#dayInfo'), /4\/5 · «Гүйлт сайхан байлаа»/);
  assert.match(await page.textContent('#moreTiles'), /Өдрийн үнэлгээ\s*4\.0/);
});

test('sleep log: times give the duration, 7-day average, stats', async t => {
  const prev = { [keyAgo(1)]: { s: '22:00', w: '06:00' }, [keyAgo(2)]: { s: '00:30', w: '07:30' }, [keyAgo(9)]: { s: '20:00', w: '10:00' } };
  const { page } = await open(t, `()=>{localStorage.elsen_sleep=${JSON.stringify(JSON.stringify(prev))}}`);
  await page.fill('#slS', '23:30'); await page.dispatchEvent('#slS', 'change');
  assert.equal(await page.textContent('#slDur'), '—');               // only one time so far
  await page.fill('#slW', '06:45'); await page.dispatchEvent('#slW', 'change');
  assert.equal(await page.textContent('#slDur'), '7ц 15м');           // across midnight
  // 7 h 15 m, 8 h, 7 h → 7 h 25 m; the night 9 days ago is outside the week
  assert.equal(await page.textContent('#slAvg'), '7 хоногт дунджаар 7ц 25м');
  assert.ok(!(await page.isVisible('#slNow')));
  await page.click('nav.tabs button[data-v="v-stat"]');
  assert.match(await page.textContent('#dayInfo'), /😴 7ц 15м \(23:30–06:45\)/);
  assert.match(await page.textContent('#moreTiles'), /Нойр · дундаж/);
});

test('weekly report: Sunday card on the Day tab, best day, weak task, totals; also in Stats', async t => {
  // a fixed Sunday evening; data for the Monday..Sunday before it
  const sun = new Date(2026, 10, 15, 21, 0, 0);
  const { page } = await open(t, null, { time: sun });
  await page.evaluate(() => {
    const mon = '2026-11-09', all = { t1: '1', t2: '1', t3: '1', t4: '1', t5: '1', t6: '1' };
    for (let i = 0; i < 7; i++) { const k = addDays(mon, i); snap[k] = cfg.tasks.map(x => x.id); hist[k] = { ...all }; }
    delete hist['2026-11-11'].t5; delete hist['2026-11-12'].t5; delete hist['2026-11-12'].t2;   // Wed, Thu miss some
    cfg.tasks[3].unit = 'км'; qty['2026-11-10'] = { t4: 4 }; qty['2026-11-13'] = { t4: 6.5 };
    water['2026-11-09'] = 6; water['2026-11-10'] = 8;
    renderTasks();
  });
  assert.ok(await page.isVisible('#wkDaySec'));
  const txt = await page.textContent('#wkDay');
  assert.match(txt, /93%/);                                   // 39 of 42
  assert.match(txt, /5 өдөр бүгдийг биелүүлсэн/);
  assert.match(txt, /Сул даалгавар: Ном унших 30 минут 5\/7 өдөр/);
  assert.match(txt, /Алхах 30 минут: 10\.5 км/);
  assert.match(txt, /Ус дунджаар 7 аяга/);
  assert.equal(await page.locator('#wkDay .wbars i.full').count(), 5);
  await page.click('nav.tabs button[data-v="v-stat"]');
  assert.match(await page.textContent('#wkStat'), /93%/);
  assert.ok(await page.isDisabled('#wkNext'));
});

test('food tab follows the shift schedule: this week\'s shifts, meal times per day, told to the generator', async t => {
  // Wednesday; morning shift Mon–Sat... rotation every 7 days starting Monday 2026-11-09 with night shift
  const { page } = await open(t, null, { time: new Date(2026, 10, 11, 10, 0, 0) });
  await page.evaluate(() => {
    cfg.shifts = { ...cfg.shifts, on: true, every: 7, cur: 2, from: '2026-11-09' };   // night shift this week
    store.set('elsen_cfg', cfg); drawBar(); renderFoodShift(); renderPlan();
  });
  await page.click('nav.tabs button[data-v="v-food"]');
  assert.ok(!(await page.isVisible('#shiftRow')));
  assert.match(await page.textContent('#shiftAuto'), /Да–Ня Шөнийн ээлж/);
  await page.click('#gen');
  await page.waitForSelector('#plan .meal');
  const labels = await page.$$eval('#plan .meal .k', ks => ks.map(k => k.textContent));
  // night shift: wake 15:00, work 22:00–06:00
  assert.deepEqual(labels.slice(0, 3), ['Сэрээд · 15:30', 'Ажлын өмнө · 21:00', 'Ажил дээр · 02:00']);
  assert.match(await page.textContent('#plan'), /Шөнийн ээлжинд хүнд хоолноос/);
  assert.match(await page.evaluate(() => { const f = foodShiftInfo(); return planPrompt({ ...foodCfg, ...f, shiftDetail: f.detail, pantry: [] }); }),
    /Да–Ня: Шөнийн ээлж \(ажил 22:00–06:00, унтах 08:00–15:00\)/);
  // a morning schedule gives breakfast, at work, evening
  assert.deepEqual(await page.evaluate(() => mealTimes({ sleepS: 22 * 60, sleepE: 5 * 60, workS: 6 * 60, workE: 14 * 60 }).slice(0, 3)),
    ['Сэрээд · 05:30', 'Ажил дээр · 10:00', 'Орой · 19:00']);
  // shifts off → the manual choice is back
  await page.evaluate(() => { cfg.shifts.on = false; renderFoodShift(); });
  assert.ok(await page.isVisible('#shiftRow'));
});

test('"Ус уух 8 аяга" follows the water counter: taps add cups, it ticks itself at the goal', async t => {
  const { page } = await open(t);
  const card = page.locator('#tasks .task').nth(1);
  assert.equal(await page.evaluate(() => cfg.tasks[1].link), 'water');       // linked automatically by its name
  assert.equal(await page.evaluate(() => cfg.waterGoal), 8);
  await card.click(); await card.click();
  assert.equal(await page.textContent('#wCnt'), '2');                         // a tap on the task = one cup
  assert.match(await card.locator('.tm').textContent(), /💧 2\/8/);
  assert.equal(await card.getAttribute('aria-checked'), 'false');
  await page.click('#cups .cup >> nth=7');                                    // 8 cups
  assert.equal(await card.getAttribute('aria-checked'), 'true');
  assert.ok(await page.evaluate(() => !!hist[dayKey(new Date())].t2));
  await page.click('#wMinus');                                                // back under the goal → not done
  assert.equal(await card.getAttribute('aria-checked'), 'false');
  // unlink in settings: the task becomes an ordinary tick box again, and stays unlinked after reload
  await page.click('#openSet');
  await page.locator('.editbox').nth(1).locator('label.wl input').uncheck();
  await page.click('#save');
  await card.click();
  assert.equal(await card.getAttribute('aria-checked'), 'true');
  assert.equal(await page.textContent('#wCnt'), '7');
  await page.reload();
  assert.equal(await page.evaluate(() => cfg.tasks[1].link), '');
});

test('data safety: a full copy is kept before the format upgrade; unknown fields and removed habits are never lost', async t => {
  const old = { dayStart: '00:00', sleepS: '23:00', sleepE: '07:00', workS: '09:00', workE: '18:00',
    tasks: [{ id: 't1', name: 'Гадаад хэл', future: { x: 1 } }, { id: 't5', name: 'Ном унших 30 минут' }] };
  const hist = { [keyAgo(2)]: { t1: '08:00', t5: '21:00' }, [keyAgo(1)]: { t5: '20:00' } };
  const { page } = await open(t, `()=>{localStorage.elsen_cfg=${JSON.stringify(JSON.stringify(old))};localStorage.elsen_hist=${JSON.stringify(JSON.stringify(hist))};localStorage.elsen_undo='"keep me out"'}`);
  // untouched copy of the old data, made once, before anything was rewritten
  const pre = await page.evaluate(() => JSON.parse(localStorage.elsen_premig_v1));
  assert.deepEqual(JSON.parse(pre.data.elsen_cfg), old);
  assert.deepEqual(JSON.parse(pre.data.elsen_hist), hist);
  assert.ok(!('elsen_undo' in pre.data));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.elsen_cfg).v), 2);
  // a field this version doesn't know survives load and a save in Settings
  await page.click('#openSet'); await page.click('#save');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.elsen_cfg).tasks[0].future), { x: 1 });
  // removing a habit archives it: its history and its row in Stats stay
  await page.click('#openSet');
  await page.locator('.editbox').nth(1).locator('button.del').click();
  await page.click('#save');
  assert.equal(await page.locator('#tasks .task').count(), 1);
  const c = await page.evaluate(() => JSON.parse(localStorage.elsen_cfg));
  assert.deepEqual(c.archive.map(x => [x.id, x.name]), [['t5', 'Ном унших 30 минут']]);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.elsen_hist))[keyAgo(1)], { t5: '20:00' });
  await page.reload();
  const copy = await page.evaluate(() => localStorage.elsen_premig_v1);
  assert.equal(JSON.parse(copy).at, pre.at);                                   // made once, never replaced
  if (keyAgo(2).slice(0, 7) === keyAgo(0).slice(0, 7)) {
    await page.click('nav.tabs button[data-v="v-stat"]');
    assert.match(await page.textContent('#perTask'), /Ном унших 30 минут · архив/);
  }
});

test('habits: own streak per habit, frequency (daily / N a week / weekdays), days off never break a streak', async t => {
  // Wednesday 2026-11-18, noon. Read: every day. Run: Mon/Wed/Fri. Swim: 2 a week. Journal: every day, missed Monday.
  const K = d => `2026-${d}`;
  const cfg = { dayStart: '00:00', sleepS: '23:00', sleepE: '07:00', workS: '09:00', workE: '18:00', v: 2, tasks: [
    { id: 'r', name: 'Ном унших', start: K('10-01') },
    { id: 'g', name: 'Гүйх', freq: { t: 'days', d: [1, 3, 5] }, start: K('10-01') },
    { id: 's', name: 'Усанд сэлэх', freq: { t: 'week', n: 2 }, start: K('10-01') },
    { id: 'j', name: 'Тэмдэглэл', start: K('10-01') }] };
  const hist = {};
  const add = (k, ...ids) => { hist[k] = hist[k] || {}; ids.forEach(i => hist[k][i] = '08:00'); };
  for (let d = 1; d <= 17; d++) add(K(`11-${String(d).padStart(2, '0')}`), 'r');          // read 1–17 Nov
  add(K('11-14'), 'j'); add(K('11-15'), 'j'); add(K('11-17'), 'j');                     // journal: Mon 16 missed
  add(K('11-09'), 'g'); add(K('11-11'), 'g'); add(K('11-13'), 'g'); add(K('11-16'), 'g'); // runs on Mon/Wed/Fri only
  add(K('11-04'), 's'); add(K('11-06'), 's'); add(K('11-10'), 's'); add(K('11-14'), 's'); add(K('11-17'), 's');
  const { page } = await open(t, `()=>{localStorage.elsen_cfg=${JSON.stringify(JSON.stringify(cfg))};localStorage.elsen_hist=${JSON.stringify(JSON.stringify(hist))}}`,
    { time: new Date(2026, 10, 18, 12, 0) });
  // the habit's line without its rest button
  const line = i => page.locator('#tasks .task').nth(i).locator('.st').evaluate(e => [...e.childNodes].filter(n => n.nodeName !== 'BUTTON').map(n => n.textContent).join('').replace(/ · $/, ''));
  assert.equal(await line(0), '🔥 17 өдөр дараалан');                 // today not done yet: doesn't break it
  assert.match(await line(1), /^🔥 4 өдөр дараалан · Да·Лх·Ба$/);      // Tue/Thu/Sat/Sun are not run days
  assert.equal(await line(2), '🔥 5 удаа дараалан · 7 хоногт 1/2');    // weeks of 2+ in a row, this week still open
  assert.equal(await line(3), '🔥 1 өдөр дараалан');                   // Monday (a due day) missed: only Tuesday counts
  // 66-day path: started 1 Oct → 18 Nov is day 49
  const pw = page.locator('#tasks .task').nth(0).locator('.pw');
  assert.equal(await pw.locator('span').textContent(), '49/66');
  assert.equal(await pw.getAttribute('aria-label'), '66 хоногийн замын 49 дэх өдөр');
  assert.equal(Math.round(parseFloat(await pw.locator('i').evaluate(e => e.style.width))), 74);
    // tick reading: it becomes "18 дахь өдөр"
  await page.locator('#tasks .task').nth(0).locator('.t').click();
  assert.equal(await line(0), '🔥 18 дахь өдөр');
  // the day's score: fixed habits due today; "2 a week" counts only on a day it's done
  assert.equal(await page.textContent('#tot'), '3');
  assert.deepEqual(await page.evaluate(() => snap[dayKey(new Date())]), ['r', 'g', 'j']);
  // Thursday: running is not due — shown dimmed, not in the count, still tickable as an extra
  await page.clock.setFixedTime(new Date(2026, 10, 19, 12, 0)); await page.evaluate(() => tick());
  const run = page.locator('#tasks .task').nth(1);
  assert.match(await run.getAttribute('class'), /\boff\b/);
  assert.match(await line(1), /Өнөөдөр биш · Да·Лх·Ба/);
  assert.equal(await page.textContent('#tot'), '2');
  await run.locator('.t').click();
  assert.equal(await page.textContent('#tot'), '3');                  // done on an extra day → counts that day
  // Settings: frequency editor saves weekdays and "N a week"
  await page.click('#openSet');
  const box = page.locator('.editbox').nth(0);
  await box.locator('.fq select').selectOption('week');
  await box.locator('.fq input').fill('4');
  await page.locator('.editbox').nth(3).locator('.fq select').selectOption('days');
  await page.click('#save');
  const saved = await page.evaluate(() => JSON.parse(localStorage.elsen_cfg).tasks.map(x => x.freq));
  assert.deepEqual(saved, [{ t: 'week', n: 4 }, { t: 'days', d: [1, 3, 5] }, { t: 'week', n: 2 }, { t: 'days', d: [1, 3, 5] }]);
});

test('66-day path: finished habits show it, a new habit starts at day 1', async t => {
  const cfg = { dayStart: '00:00', sleepS: '23:00', sleepE: '07:00', workS: '09:00', workE: '18:00', v: 2,
    tasks: [{ id: 'a', name: 'Хуучин', start: '2026-08-01' }] };
  const { page } = await open(t, `()=>{localStorage.elsen_cfg=${JSON.stringify(JSON.stringify(cfg))}}`, { time: new Date(2026, 10, 18, 12, 0) });
  const pw = page.locator('#tasks .task').nth(0).locator('.pw');
  assert.equal(await pw.locator('span').textContent(), '66 ✓');
  assert.match(await pw.getAttribute('class'), /\bfin\b/);
  await page.click('#openSet'); await page.click('#addTask');
  await page.locator('#editList input.nm').last().fill('Шинэ дадал'); await page.click('#save');
  assert.equal(await page.locator('#tasks .task').nth(1).locator('.pw span').textContent(), '1/66');
  assert.equal(await page.evaluate(() => cfg.tasks[1].start), '2026-11-18');
});

test('rest days: two a month per habit keep the streak; chosen with a button or covering a missed day', async t => {
  // Wednesday 18 Nov. Reading done 1–17 Nov except 10 and 12 (missed: covered by the 2 rests of November).
  const cfg = { dayStart: '00:00', sleepS: '23:00', sleepE: '07:00', workS: '09:00', workE: '18:00', v: 2,
    tasks: [{ id: 'r', name: 'Ном унших', start: '2026-11-01' }, { id: 'j', name: 'Тэмдэглэл', start: '2026-11-01' }] };
  const hist = {};
  for (let d = 1; d <= 17; d++) if (d !== 10 && d !== 12) hist[`2026-11-${String(d).padStart(2, '0')}`] = { r: '08:00', j: '09:00' };
  hist['2026-11-10'] = { j: '09:00' }; hist['2026-11-12'] = { j: '09:00' };
  const { page } = await open(t, `()=>{localStorage.elsen_cfg=${JSON.stringify(JSON.stringify(cfg))};localStorage.elsen_hist=${JSON.stringify(JSON.stringify(hist))}}`,
    { time: new Date(2026, 10, 18, 12, 0) });
  const row = i => page.locator('#tasks .task').nth(i);
  assert.match(await row(0).locator('.st').textContent(), /^🔥 15 өдөр дараалан$/);    // 2 missed days covered: no button left
  assert.equal(await row(0).locator('.rbtn').count(), 0);
  assert.match(await page.textContent('#streak'), /\b15\b/);                       // whole-day streak survives too (rest days don't add)
  // journal has both rests left: rest today → out of today's count, streak kept, can be undone
  assert.equal(await row(1).locator('.rbtn').textContent(), '☾ Амрах 2/2');
  assert.equal(await page.textContent('#tot'), '2');
  await row(1).locator('.rbtn').click();
  assert.match(await row(1).getAttribute('class'), /\brest\b/);
  assert.match(await row(1).locator('.st').textContent(), /🔥 17 өдөр дараалан · ☾ Амралтын өдөр/);
  assert.equal(await page.textContent('#tot'), '1');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.elsen_rest)), { '2026-11-18': ['j'] });
  assert.ok(await page.evaluate(() => DATA_KEYS.includes('elsen_rest')));          // in backups
  // next day: the rest day didn't break the streak; one rest left this month
  await page.clock.setFixedTime(new Date(2026, 10, 19, 12, 0)); await page.evaluate(() => tick());
  assert.match(await row(1).locator('.st').textContent(), /^🔥 17 өдөр дараалан · ☾ Амрах 1\/2$/);
  // a third missed day in the month breaks it: miss the 19th and 20th, look on the 21st
  await page.clock.setFixedTime(new Date(2026, 10, 21, 12, 0)); await page.evaluate(() => tick());
  assert.doesNotMatch(await row(1).locator('.st').textContent(), /🔥/);
  // ticking a habit on a picked rest day clears the rest
  await row(1).locator('.rbtn').click().catch(() => {});
  await page.evaluate(() => { setRest(cfg.tasks[0], dayKey(new Date()), true); renderTasks(); });
  await row(0).locator('.t').click();
  assert.equal(await page.evaluate(() => restPicked(cfg.tasks[0], dayKey(new Date()))), false);
});
