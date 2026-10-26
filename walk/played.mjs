// The built page in a real browser, with OnlyWorlds played by the walk: no account, no network to
// onlyworlds.com, so it runs on a fresh clone. `npm run walk` builds first.
//   node walk/played.mjs [chromium|firefox|webkit|all]      (default: chromium and firefox)
// DIST=<dir> walks another build (a control). Exit 0 when every check passed.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.env.DIST ?? join(here, '.dist'));
const port = 4400 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}/sub/`;
const API = 'https://www.onlyworlds.com/api/v2';
const PICS = 'https://media.onlyworlds.com/';
const DEMO = '0000000001';
const READ_KEY = 'ow_r_' + 'k'.repeat(40);
const ACCOUNT = 'ow_a_' + 'a'.repeat(40);
const HOSTILE = '<img src=x onerror="window.__owned=1">Hostile';
const id = (n) => `0695db83-0000-7000-8000-${String(n).padStart(12, '0')}`;

const engines = { chromium, firefox, webkit };
const pick = process.argv[2] ?? 'both';
const which = pick === 'all' ? ['chromium', 'firefox', 'webkit'] : pick === 'both' ? ['chromium', 'firefox'] : [pick];

// The played worlds: the demo, and one more behind READ_KEY.
const worlds = {
  [DEMO]: {
    world: { id: 'w-demo', name: 'Played Demo', description: 'A world the walk plays.' },
    character: [
      { id: id(1), name: 'Ada', description: 'A sailor.', image_url: `${PICS}ada.png`, location: id(10), friends: [id(2), id(99)] },
      { id: id(2), name: HOSTILE, description: HOSTILE, image_url: 'https://tracker.example/pixel.png' },
      { id: id(3), name: 'Proposed Pete', x_review_proposed: { by: 'm1', at: '2026-10-26' } },
      { id: id(4), name: 'Hidden Hal', hidden: true },
      { id: id(5), name: 'Known Kit', known_of: true },
    ],
    location: [{ id: id(10), name: 'Port Damp' }],
    narrative: [
      { id: id(20), name: 'The Long Drip' },
      { id: id(21), name: 'A line in the room', supertype: 'Message', x_room_of: 'w-demo' },
    ],
    object: [{ id: id(30), name: 'Slow Spoon' }],
  },
  [READ_KEY]: {
    world: { id: 'w-mine', name: 'My Own World', description: '' },
    character: Array.from({ length: 150 }, (_, i) => ({ id: id(1000 + i), name: `Mine ${i}` })),
  },
};
const everything = new Map(Object.values(worlds[DEMO]).filter(Array.isArray).flat().map((e) => [e.id, e]));

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const server = spawn(process.execPath, [join(here, 'serve.mjs'), dist, String(port), '/sub/'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
const watchdog = setTimeout(() => { console.log('FAIL the walk ran out of time'); server.kill(); process.exit(1); }, 240_000);

try {
  for (const name of which) {
    console.log(`\n${name}`);
    let browser;
    try {
      browser = await engines[name].launch();
    } catch {
      console.log(`FAIL ${name} is not installed here: run  npx playwright install ${name}`);
      failures++;
      continue;
    }
    for (const phone of [false, true]) {
      const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 800 } : { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const asked = [];
      const strangers = [];
      let slowType = null;
      let busy = false;
      page.on('request', (r) => {
        const u = r.url();
        if (!u.startsWith(base) && !u.startsWith(API) && !u.startsWith(PICS) && !u.startsWith('data:')) strangers.push(u);
      });
      await page.route(`${PICS}**`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>' }));
      await page.route(`${API}/**`, async (route) => {
        const req = route.request();
        const key = req.headers()['api-key'];
        asked.push({ url: req.url(), key });
        const w = worlds[key];
        if (!w) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { type: 'auth_error', code: 'invalid_key', message: 'SERVER WORDS' } }) });
        // keel exposes Retry-After to browser code; without that header a page cannot read it.
        if (busy) return route.fulfill({ status: 429, headers: { 'Retry-After': '9', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Retry-After' }, contentType: 'application/json', body: JSON.stringify({ error: { type: 'api_error', code: 'rate_limited', message: 'SERVER WORDS' } }) });
        const url = new URL(req.url());
        const [type, one] = url.pathname.replace('/api/v2/', '').split('/').filter(Boolean);
        if (slowType && type === slowType) await new Promise((r) => setTimeout(r, 1500));
        if (type === 'world') return route.fulfill({ json: w.world });
        const rows = w[type] ?? [];
        if (one) {
          const el = rows.find((e) => e.id === one);
          if (!el) return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'gone' } } });
          // expand: a link this world holds becomes a stub; one it does not stays an id.
          const out = { ...el };
          for (const f of (url.searchParams.get('expand') ?? '').split(',').filter(Boolean)) {
            const stub = (v) => (everything.has(v) ? { id: v, name: everything.get(v).name } : v);
            if (Array.isArray(out[f])) out[f] = out[f].map(stub);
            else if (typeof out[f] === 'string') out[f] = stub(out[f]);
          }
          return route.fulfill({ json: out });
        }
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const start = Number(url.searchParams.get('cursor') ?? 0);
        const more = start + limit < rows.length;
        return route.fulfill({ json: { data: rows.slice(start, start + limit), has_more: more, next_cursor: more ? String(start + limit) : null } });
      });
      let violations = 0;
      await page.exposeFunction('__violation', () => { violations++; });
      await page.addInitScript(() => document.addEventListener('securitypolicyviolation', () => window.__violation()));

      const tag = phone ? '390' : 'desk';
      await page.goto(base);
      await page.getByRole('heading', { level: 1, name: 'Played Demo' }).waitFor({ timeout: 10_000 });
      check(true, `${tag}: opens on the demo world with no setup`);
      check((await page.locator('.chip').textContent()) === 'Demo world', `${tag}: says it is the demo world`);
      await page.locator('nav li a').first().waitFor();
      check((await page.locator('nav li a').count()) === 5, `${tag}: lists the demo's five characters`);
      check(await page.getByText(HOSTILE).first().isVisible(), `${tag}: a name with markup in it shows as text`);
      check((await page.locator('nav img, main img').count()) === 0 && !(await page.evaluate(() => window.__owned)), `${tag}: the markup made no element and ran nothing`);
      check((await page.locator('nav .mark.proposed').count()) === 1 && (await page.locator('nav .mark.hidden').count()) === 1 && (await page.locator('nav .mark.known-of').count()) === 1, `${tag}: proposed, hidden and known-of characters are marked`);

      await page.getByRole('link', { name: 'Ada' }).click();
      await page.locator('main h2', { hasText: 'Ada' }).waitFor();
      await page.locator('main a', { hasText: 'Port Damp' }).waitFor();
      check(true, `${tag}: an element opens, its links named by the server's expand`);
      check(await page.locator('main', { hasText: 'a character this key cannot see' }).isVisible(), `${tag}: a link the key cannot see is said, not dropped`);
      check((await page.locator('main img.epic').getAttribute('src')) === `${PICS}ada.png`, `${tag}: a picture from OnlyWorlds' host shows`);
      await page.locator('main a', { hasText: HOSTILE }).click();
      await page.locator('main h2', { hasText: 'Hostile' }).waitFor();
      check((await page.locator('main img').count()) === 0, `${tag}: a picture from any other host is never asked for`);
      await page.goBack();
      await page.locator('main a', { hasText: 'Port Damp' }).click();
      await page.locator('main h2', { hasText: 'Port Damp' }).waitFor();
      check((await page.locator('select').inputValue()) === 'location', `${tag}: a link to another type opens that type's list`);

      await page.selectOption('select', 'narrative');
      await page.locator('nav li a', { hasText: 'The Long Drip' }).waitFor();
      check((await page.locator('nav li a', { hasText: 'A line in the room' }).count()) === 0 && (await page.getByText('1 line of room talk left out').isVisible()), `${tag}: room talk is left out of the list and counted`);
      await page.selectOption('select', 'creature');
      await page.getByText('No creatures in this world.').waitFor();
      check(true, `${tag}: an empty type says so`);

      // A late answer never paints over a newer choice (a type not read yet, so no kept answer).
      slowType = 'object';
      await page.selectOption('select', 'object');
      await page.selectOption('select', 'character');
      await page.waitForTimeout(2200);
      slowType = null;
      check((await page.locator('select').inputValue()) === 'character' && (await page.locator('nav li a', { hasText: 'Ada' }).count()) === 1 && (await page.locator('nav li a', { hasText: 'Slow Spoon' }).count()) === 0, `${tag}: a slow answer for an older choice is dropped`);

      // Your world.
      await page.locator('summary', { hasText: 'Your world' }).click();
      await page.fill('#key', ACCOUNT);
      await page.click('button[type=submit]');
      check(await page.getByText('This page only reads, so it takes a read key').isVisible(), `${tag}: an account token is refused in words`);
      const historyBefore = await page.evaluate(() => history.length);
      const before = asked.length;
      await page.fill('#key', `  ${READ_KEY} `);
      await page.press('#key', 'Enter');
      await page.getByRole('heading', { level: 1, name: 'My Own World' }).waitFor();
      check(asked.slice(before).length > 0 && asked.slice(before).every((a) => a.key === READ_KEY), `${tag}: a read key sent with Enter reads its own world`);
      check((await page.locator('.chip').textContent()) === 'Your key', `${tag}: says it reads with your key`);
      await page.locator('nav li a').first().waitFor();
      check((await page.locator('nav li a').count()) === 100, `${tag}: the first hundred are listed`);
      await page.getByRole('button', { name: 'Load more' }).click();
      await page.locator('nav li a', { hasText: 'Mine 149' }).waitFor();
      check((await page.locator('nav li a').count()) === 150 && !(await page.getByRole('button', { name: 'Load more' }).isVisible()), `${tag}: Load more reads the rest and then goes`);
      const kept = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie, u: location.href, inputs: [...document.querySelectorAll('input')].map((i) => i.value) }));
      check(!kept.includes('kkkkkkkk') && !kept.includes('My Own World'), `${tag}: the key and its world are in no storage, cookie, address or input`);
      check((await page.evaluate(() => history.length)) - historyBefore <= 1 && !page.url().includes('kkkk') && !page.url().includes('?'), `${tag}: Enter put nothing in the address (${page.url().replace(base, '')})`);
      check(asked.every((a) => !a.url.includes('kkkkkkkk')), `${tag}: the key never went in a request's address`);

      busy = true;
      await page.selectOption('select', 'location');
      await page.getByText('OnlyWorlds asked this page to slow down. Try again in 9 seconds.').waitFor();
      busy = false;
      check(!(await page.content()).includes('SERVER WORDS'), `${tag}: a refusal is said in the page's words, never the server's`);
      check((await page.getByText('Reading…').count()) === 0, `${tag}: a refusal leaves nothing stuck on Reading`);

      const demoAsksBefore = asked.filter((a) => a.key === DEMO).length;
      await page.reload();
      await page.getByRole('heading', { level: 1, name: 'Played Demo' }).waitFor();
      check(true, `${tag}: a reload forgets the key and goes back to the demo`);
      await page.locator('nav li a, nav .muted').first().waitFor();
      await page.waitForTimeout(300);
      check(asked.filter((a) => a.key === DEMO).length === demoAsksBefore, `${tag}: the demo's answers were kept, so the reload asked nothing again`);

      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(wide <= 0, `${tag}: no sideways scroll (${wide})`);
      check(violations === 0, `${tag}: the page's policy refused nothing (${violations})`);
      check(strangers.length === 0, `${tag}: asked no other host (${strangers.slice(0, 2).join(', ')})`);
      await page.screenshot({ path: join(here, `out-${name}-${tag}.png`) });
      await ctx.close();
    }
    await browser.close();
  }
} catch (err) {
  console.log(`FAIL ${err?.message ?? err}`);
  failures++;
} finally {
  clearTimeout(watchdog);
  server.kill();
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
