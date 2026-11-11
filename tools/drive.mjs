// Drives the built game in headless Chromium and takes screenshots.
//   node tools/drive.mjs [scenario]     scenarios: tour (default), fight, play
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const scenario = process.argv[2] ?? 'tour';
mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file://' + resolve('dist/index.html'));
const shot = (name) => page.screenshot({ path: `shots/${name}.png` });
const wait = (ms) => page.waitForTimeout(ms);
const sf = (code) => page.evaluate(code);

await wait(300);
await shot('00-create');
await page.fill('#cname', 'Tester');
await page.click('[data-act=create]');
await wait(500);
await shot('01-village');

if (scenario === 'tour') {
  for (const id of ['meadow_w', 'meadow_s', 'meadow_e', 'forest_edge', 'forest_deep', 'marsh', 'marsh_deep', 'ruins', 'hollow']) {
    await sf(`shardfall.goto('${id}')`);
    await wait(400);
    await shot('map-' + id);
  }
}

if (scenario === 'fight' || scenario === 'tour') {
  await sf(`shardfall.goto('meadow_e'); shardfall.level(5); shardfall.fight(0)`);
  await wait(600);
  await shot('10-placement');
  await page.click('#act');
  await wait(2500);
  for (let k = 0; k < 40 && await sf(`shardfall.busy()`); k++) await wait(250);
  await shot('11-turn');
  await page.keyboard.press('2');
  await wait(200);
  await page.mouse.move(500, 300);
  await shot('12-spell');
  await sf(`shardfall.speed(4); shardfall.auto(true)`);
  for (let k = 0; k < 200 && await sf(`shardfall.G.mode === 'fight'`); k++) { await wait(250); if (k === 6) await shot('13-midfight'); }
  await sf(`shardfall.auto(false); shardfall.speed(1)`);
  await wait(300);
  await shot('14-after');
  await page.keyboard.press('c'); await wait(200); await shot('20-char'); await page.keyboard.press('Escape');
  await sf(`shardfall.give('moss_hood'); shardfall.give('boar_belt'); shardfall.give('tusk_cleaver'); shardfall.give('moss_tuft', 4)`);
  await page.keyboard.press('i'); await wait(200); await shot('21-bag'); await page.keyboard.press('Escape');
  await page.keyboard.press('s'); await wait(200); await shot('22-spells'); await page.keyboard.press('Escape');
  await page.keyboard.press('m'); await wait(200); await shot('23-map'); await page.keyboard.press('Escape');
}

if (scenario === 'play') {
  const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) errors.push('check failed: ' + name); };
  const clickCell = async (cell, dy = 0) => { const [x, y] = await sf(`shardfall.cellXY(${cell}, ${dy})`); await page.mouse.move(x, y); await page.mouse.click(x, y); };
  const idle = async () => { for (let k = 0; k < 120; k++) { await wait(150); if (!(await sf(`shardfall.G.hero.path.length > 0 || shardfall.busy()`))) return; } };
  // Quest giver.
  await clickCell(await sf(`shardfall.G.map.npcs.find(n => n.id === 'tobin').cell`), -20);
  await idle(); await wait(200);
  await shot('30-quest');
  await page.click('[data-what=accept]');
  check('quest accepted', await sf(`shardfall.G.ch.questTaken`));
  // Shop: buy and equip a weapon, sell a roll.
  await sf(`shardfall.gold(100)`);
  await clickCell(await sf(`shardfall.G.map.npcs.find(n => n.id === 'maren').cell`), -20);
  await idle(); await wait(200);
  await page.click('[data-def=twig_blade]'); await page.click('[data-act=buy]');
  await page.click('.bag [data-act=pick-inv]'); await shot('31-shop');
  await page.click('[data-act=equip]');
  check('weapon equipped', await sf(`shardfall.G.ch.equip.weapon?.def === 'twig_blade'`));
  const goldBefore = await sf(`shardfall.G.ch.gold`);
  await page.click('.bag [data-act=pick-inv]'); await page.click('[data-act=sell]');
  check('sold an item', (await sf(`shardfall.G.ch.gold`)) > goldBefore);
  await page.keyboard.press('Escape');
  // Walk west to the next map.
  await clickCell(await sf(`shardfall.G.map.exits.findIndex((d, i) => d === 'left' && i > 14 * 14)`));
  await idle(); await wait(600);
  check('walked to Dewfield', (await sf(`shardfall.G.map.def.id`)) === 'meadow_w');
  await shot('32-dewfield');
  // Attack a group by clicking it.
  for (let k = 0; k < 6 && (await sf(`shardfall.G.mode`)) !== 'fight'; k++) {
    await clickCell(await sf(`shardfall.G.map.groups[0].cell`), -12);
    await idle(); await wait(300);
  }
  check('fight started', (await sf(`shardfall.G.mode`)) === 'fight');
  await clickCell(await sf(`shardfall.G.fight.startCells[1] ?? shardfall.G.fight.startCells[0]`));
  await page.keyboard.press('Space');
  await idle();
  check('player turn', (await sf(`shardfall.G.fight.phase`)) === 'player');
  // One manual move, then let auto-play finish.
  const mp = await sf(`shardfall.G.fight.st.fighters[0].mp`);
  await clickCell(await sf(`(() => { const st = shardfall.G.fight.st, me = st.fighters[0]; return shardfall.G.marks.map(m => m.cell).find(c => c !== me.cell); })()`));
  await idle();
  check('moved in fight', (await sf(`shardfall.G.fight.st.fighters[0].mp`)) < mp);
  await page.keyboard.press('3'); await wait(150); await shot('33-fight');
  await page.keyboard.press('Escape');
  await sf(`shardfall.speed(5); shardfall.auto(true)`);
  for (let k = 0; k < 300 && (await sf(`shardfall.G.mode`)) === 'fight'; k++) await wait(200);
  await sf(`shardfall.auto(false); shardfall.speed(1)`);
  check('fight won', (await sf(`shardfall.G.ch.wins`)) === 1);
  check('xp gained', (await sf(`shardfall.G.ch.xp + shardfall.G.ch.level`)) > 1);
  // Reload: the save comes back.
  await page.reload(); await wait(500);
  check('save restored', await sf(`shardfall.G.ch.name === 'Tester' && shardfall.G.ch.wins === 1 && shardfall.G.ch.equip.weapon?.def === 'twig_blade' && shardfall.G.map.def.id === 'meadow_w'`));
  // Lose against the boss at low level.
  await sf(`shardfall.goto('hollow'); shardfall.speed(6); shardfall.auto(true); shardfall.fight(shardfall.G.map.groups.findIndex(g => g.boss))`);
  for (let k = 0; k < 300 && (await sf(`shardfall.G.mode`)) === 'fight'; k++) await wait(200);
  await sf(`shardfall.auto(false); shardfall.speed(1)`);
  check('defeat sends you home', (await sf(`shardfall.G.map.def.id`)) === 'village');
  await shot('34-home');
}

console.log(JSON.stringify(await sf(`({ level: shardfall.G.ch.level, xp: shardfall.G.ch.xp, gold: shardfall.G.ch.gold, wins: shardfall.G.ch.wins, inv: shardfall.G.ch.inv.length, map: shardfall.G.ch.mapId })`)));
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
