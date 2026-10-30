/**
 * Drives the Shardfall client in headless Chromium: a list of steps on the
 * command line, run in order against the Vite dev server (started and stopped
 * here if it is not already up). Cell positions come from the real grid math
 * and canvas offsets, so clicks land on the cell you name.
 *
 *   npx tsx .claude/skills/run-shardfall/driver.ts shot:map key:r shot:range click:426 wait:4000 shot:walked
 *
 * Env: URL (default http://localhost:5173/), OUT (screenshot folder), VIEWPORT (default 1400x1000).
 *
 * Steps:
 *   shot:NAME        screenshot to $OUT/NAME.png (OUT defaults to /tmp/shardfall-run)
 *   key:K            press a key (r = range overlay, d = cell grid)
 *   hover:CELL       move the mouse over a cell (fills the cell readout)
 *   click:CELL       click a cell (the hero walks there)
 *   tap:SELECTOR     click a page element, e.g. tap:#btn-ready or tap:button.spell >> nth=0
 *   wait:MS          wait
 *   text:SELECTOR    print an element's text, e.g. text:#cell-id or text:#map-name
 *   eval:EXPR        print a page expression as JSON; in a fight (dev server only),
 *                    window.shardfall.fight() is the FightState and .busy() is true while animating
 *   idle             wait until a fight is not animating (dev server only)
 *   until:EXPR       wait (up to 5 minutes) until a page expression is truthy
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cellToScreen } from '../../../packages/shared/src/index.ts';
import { GAME_W, GAME_H, ORIGIN_X, ORIGIN_Y } from '../../../packages/client/src/config.ts';

// The pre-installed Playwright only resolves through require, not ESM import.
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const URL = process.env.URL ?? 'http://localhost:5173/';
const OUT = process.env.OUT ?? '/tmp/shardfall-run';
const [VW = 1400, VH = 1000] = (process.env.VIEWPORT ?? '1400x1000').split('x').map(Number);
const steps = process.argv.slice(2);
if (steps.length === 0) steps.push('shot:map');

async function up(): Promise<boolean> {
  try {
    return (await fetch(URL)).ok;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let server: ChildProcess | undefined;
  if (!(await up())) {
    // detached: npm does not forward signals, so kill the whole process group at the end.
    server = spawn('npm', ['run', 'dev'], { cwd: ROOT, detached: true, stdio: 'ignore' });
    for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await up())) throw new Error(`dev server did not come up on ${URL}`);
    console.log(`started dev server (pid group ${server.pid})`);
  }

  const browser = await chromium.launch();
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    page.on('pageerror', (e: Error) => errors.push(String(e)));
    page.on('console', (m: { type(): string; text(): string }) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(URL);
    const canvas = page.locator('#game canvas');
    await canvas.waitFor();
    await page.waitForTimeout(1500); // BootScene loads the sprites, then MapScene fades in
    const box = await canvas.boundingBox();
    // The canvas is GAME_W x GAME_H internally and CSS-scaled to the viewport.
    const toPage = (cell: number) => {
      const { sx, sy } = cellToScreen(cell);
      return { x: box.x + ((sx + ORIGIN_X) * box.width) / GAME_W, y: box.y + ((sy + ORIGIN_Y) * box.height) / GAME_H };
    };

    for (const step of steps) {
      const [cmd = '', arg = ''] = step.split(/:(.*)/s);
      switch (cmd) {
        case 'shot': {
          const path = join(OUT, `${arg || 'shot'}.png`);
          await page.screenshot({ path });
          console.log(`shot ${path}`);
          break;
        }
        case 'key':
          await page.keyboard.press(arg);
          await page.waitForTimeout(300);
          break;
        case 'hover':
        case 'click': {
          const p = toPage(Number(arg));
          await page.mouse.move(p.x, p.y);
          if (cmd === 'click') await page.mouse.click(p.x, p.y);
          await page.waitForTimeout(300);
          break;
        }
        case 'tap':
          await page.locator(arg).first().click();
          await page.waitForTimeout(300);
          break;
        case 'wait':
          await page.waitForTimeout(Number(arg));
          break;
        case 'eval':
          console.log(`${arg} = ${JSON.stringify(await page.evaluate(arg))}`);
          break;
        case 'idle':
          await page.waitForFunction(
            () => !(window as unknown as { shardfall?: { busy(): boolean } }).shardfall?.busy(),
            undefined,
            { timeout: 60_000 },
          );
          await page.waitForTimeout(300);
          break;
        case 'until':
          await page.waitForFunction(arg, undefined, { timeout: 300_000, polling: 250 });
          break;
        case 'text':
          console.log(`${arg}: ${(await page.locator(arg).textContent())?.trim()}`);
          break;
        default:
          throw new Error(`unknown step "${step}"`);
      }
    }
  } finally {
    await browser.close();
    if (server?.pid) process.kill(-server.pid);
    console.log(errors.length ? `page errors:\n  ${errors.join('\n  ')}` : 'no page errors');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
