// The built page against the real OnlyWorlds: it reads the demo world, and with OW_KEY set
// (a read key, from the environment, never printed) your own world too.
//   npm run build && node walk/live.mjs [chromium|firefox]
// It writes nothing anywhere, keeps no trace, and checks the page's shape, not a world's contents.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { chromium, firefox } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.env.DIST ?? join(here, '..', 'dist'));
const port = 4800 + Math.floor(Math.random() * 100);
const base = `http://localhost:${port}/`;
const engine = { chromium, firefox }[process.argv[2] ?? 'chromium'];
const key = (process.env.OW_KEY ?? '').trim();

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const server = spawn(process.execPath, [join(here, 'serve.mjs'), dist, String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
const watchdog = setTimeout(() => { console.log('FAIL the walk ran out of time'); server.kill(); process.exit(1); }, 120_000);
const browser = await engine.launch();
try {
  const page = await browser.newPage();
  let violations = 0;
  await page.exposeFunction('__violation', () => { violations++; });
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', () => window.__violation()));
  await page.goto(base);
  await page.locator('.chip', { hasText: /Demo world|Built-in key/ }).waitFor();
  await page.locator('nav li a, nav .problem, nav .muted:not(:has-text("Reading"))').first().waitFor({ timeout: 30_000 });
  const title = (await page.locator('h1').textContent()) ?? '';
  check(title.length > 0 && title !== 'Reading…' && title !== 'No world', `opens on a world (${title})`);
  const first = page.locator('nav li a').first();
  check((await page.locator('nav li a').count()) > 0, `lists its characters (${await page.locator('nav li a').count()})`);
  await first.click();
  await page.locator('main h2').waitFor({ timeout: 30_000 });
  check(((await page.locator('main h2').textContent()) ?? '').length > 0, 'opens an element');
  await page.screenshot({ path: join(here, 'out-live-start.png') });

  if (key) {
    await page.locator('summary', { hasText: 'Your world' }).click();
    await page.fill('#key', key);
    await page.press('#key', 'Enter');
    await page.locator('.chip', { hasText: 'Your key' }).waitFor();
    await page.locator('h1:not(:has-text("Reading…"))').waitFor({ timeout: 30_000 });
    const mine = (await page.locator('h1').textContent()) ?? '';
    check(mine !== title && mine !== 'No world', `reads your world with your key (${mine})`);
    check(await page.evaluate(() => [...document.querySelectorAll('input')].every((i) => i.value === '')), 'the key field is empty again');
    await page.locator('nav li a, nav .muted:not(:has-text("Reading"))').first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: join(here, 'out-live-yours.png') });
  } else {
    console.log('(set OW_KEY to a read key to walk your own world too)');
  }
  check(violations === 0, `the page's policy refused nothing (${violations})`);
} catch (err) {
  console.log(`FAIL ${String(err?.message ?? err).split('\n')[0]}`);
  failures++;
} finally {
  clearTimeout(watchdog);
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
