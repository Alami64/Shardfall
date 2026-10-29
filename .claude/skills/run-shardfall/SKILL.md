---
name: run-shardfall
description: Run, start, build, test, screenshot and drive the Shardfall game. Use when asked to launch the client, take screenshots of the map or overlays, click to move, walk to another map, check a change in the real app, or play fights through the combat engine (spells, effects, balance) from the command line.
---

Shardfall has two things to run. The **client** (Phaser on Vite) is driven in headless Chromium by
`.claude/skills/run-shardfall/driver.ts`, which starts and stops the dev server itself. The **fight
engine** (`packages/shared`) has no on-screen fights yet (they arrive in M1 step 5), so
`.claude/skills/run-shardfall/fight-smoke.ts` plays fights through it and prints a turn-by-turn log.
Most changes in M1 touch the engine: run the fight smoke for those, the driver for client changes.

All paths are relative to the repo root.

## Setup

Node 22 and the pre-installed Chromium + Playwright are enough; nothing to `apt-get`.

```bash
npm install
```

## Run the client (agent path)

Steps run in order; screenshots go to `$OUT` (default `/tmp/shardfall-run`). If nothing listens on
`:5173`, the driver starts `npm run dev` and kills it when done.

```bash
npx tsx .claude/skills/run-shardfall/driver.ts shot:map key:r shot:range key:r key:d shot:grid key:d hover:426 text:#cell-id click:426 wait:4000 shot:walked text:#map-name
```

Walk off the amber east edge into the next map (the walk is long, see Gotchas):

```bash
OUT=/tmp/shardfall-run npx tsx .claude/skills/run-shardfall/driver.ts click:251 wait:11000 text:#map-name shot:next-map
```

Expect `#map-name: Brightmoor Crossing` and `no page errors`. **Look at the PNGs**; a dim frame means
the map was still fading in.

| step | what it does |
|---|---|
| `shot:NAME` | screenshot to `$OUT/NAME.png` |
| `key:K` | press a key: `r` = 3-MP combat range overlay, `d` = cell grid with ids |
| `hover:CELL` / `click:CELL` | move to / click a cell by id (0–559); a click walks the hero there |
| `wait:MS` | wait |
| `text:SELECTOR` | print text: `#cell-id`, `#cell-grid`, `#cell-status`, `#map-name`, `#map-coords` |

Cell ids: run `key:d shot:grid` and read them off the grid. On Brightmoor Meadow the hero starts on
cell 339; 251 is an east exit; 426 is open grass.

## Run the fight engine

```bash
npx tsx .claude/skills/run-shardfall/fight-smoke.ts          # Vanguard vs Longshot, seed 7, full log
npx tsx .claude/skills/run-shardfall/fight-smoke.ts 3        # another seed
npx tsx .claude/skills/run-shardfall/fight-smoke.ts 1-20     # 20 fights: winner and length per seed, then a tally
```

It reads the built content (`content/maps/built/world.json`, `content/spells/built/spells.json`), so
run `npm run spells:build` after editing `content/spells/*.json`. The controller is naive (casts
whatever reaches, walks one cell at a time towards a preferred distance), so a tally is a hint about
balance, not a verdict. Edit `setups` in the script to try other classes, levels or stats.

## Run (human path)

```bash
npm run dev   # -> http://localhost:5173 in a browser; Ctrl-C to stop
```

## Test

```bash
npm test && npm run typecheck && npm run build
```

All three must pass before finishing a change (CLAUDE.md).

## Gotchas

- **`chromium-cli` is not installed here**, so the driver uses the pre-installed Playwright, which only
  resolves through `require`: `import { chromium } from 'playwright'` fails with `ERR_MODULE_NOT_FOUND`.
  The driver uses `createRequire(import.meta.url)('playwright')`.
- **The canvas is CSS-scaled.** It is `GAME_W × GAME_H` (1300 × 1014) inside, drawn at about
  1282 × 1000 in a 1400 × 1000 viewport. The driver maps a cell to page pixels with the real
  `cellToScreen` plus `ORIGIN_X`/`ORIGIN_Y` from `packages/client/src/config.ts`, scaled by the
  canvas bounding box. `hover:N text:#cell-id` printing `N` proves the mapping.
- **Wait after load and after a map change.** Sprites load in `BootScene` and the map fades in
  (300 ms), so the driver waits 1.5 s before the first step. Walking from cell 339 to the east edge
  and fading into the next map takes about 10 s; at 8 s the screenshot comes out dim.
- **npm does not forward signals** to Vite, so killing the `npm run dev` pid leaves the server up.
  The driver spawns it detached and kills the process group. To stop a server you started by hand:
  `lsof -ti:5173 -sTCP:LISTEN | xargs -r kill`.
- **The test maps have no start cells flagged** (`CellFlag.StartTeamA/B`), so `createFight` needs
  `startCells` passed in; the fight smoke uses cells 339 and 315 on the meadow's dirt path.
- **tsx runs the scripts without type-checking.** To check them:
  `npx tsc --noEmit --strict --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --resolveJsonModule --skipLibCheck --types node .claude/skills/run-shardfall/driver.ts .claude/skills/run-shardfall/fight-smoke.ts`
