# Shardfall

Browser-based, turn-based tactical MMORPG on an isometric grid (Dofus-style systems, original world and art). Phaser 3 + TypeScript, npm workspaces.

- Full design: `docs/design.md`. Read the relevant section before building a feature, and update the doc in the same change when the design moves (including the **Progress** checklist at the end).
- Current status: **M0 (Foundations) done**; **M1, offline combat prototype, built**: a playable fight on Brightmoor Meadow. Next is the M1 gate (playtests and balance), then M2 (see "Next up" below).
- **Launch scope is small on purpose**: 3 classes (Vanguard, Longshot, Mender), 3 regions (Brightmoor Isle, Gildhaven, Thornwild Forest), level cap 60, no erosion, no pushback damage. Don't build for content outside it; `docs/design.md` marks the rest as *later*.

## Commands

```bash
npm install          # .npmrc sets legacy-peer-deps: plain npm hits an arborist "edgesOut" bug in this workspace
npm test             # Vitest, packages/shared
npm run typecheck    # tsc for shared, tools, client
npm run build        # converts maps, validates spells and monsters, then builds packages/client/dist/index.html (single self-contained file)
npm run dev          # Vite dev server on :5173
npm run maps:generate  # regenerate the test maps in content/maps/*.tmj (overwrites hand edits)
npm run maps:build     # Tiled .tmj -> content/maps/built/world.json (validated)
npm run spells:build   # content/spells/*.json -> content/spells/built/spells.json (validated)
npm run monsters:build # content/monsters/*.json -> content/monsters/built/monsters.json (validated against the built spells)
npm run art            # redraw placeholder sprites (needs Python 3 + Pillow)
```

Before finishing any change: `npm test && npm run typecheck && npm run build` must pass.

To see a change running, use the `run-shardfall` skill (`.claude/skills/run-shardfall/`): `driver.ts` drives the client in headless Chromium and takes screenshots, `fight-smoke.ts` plays fights through the engine and prints the log.

## Layout

- `packages/shared` — game rules with no rendering or I/O: grid math, A* pathfinding, line of sight, map types, seeded RNG (`rng.ts`), stats (`stats.ts`), formulas (`formulas.ts`), spell types (`spell.ts`), areas (`zone.ts`), fight types and queries (`fightState.ts`), fight actions (`fight.ts`) on top of the internal `engine.ts`, monsters (`monster.ts`), monster AI (`ai.ts`). The client today and the server from M2 both import it. Tests in `packages/shared/test`.
- `packages/client` — Phaser scenes (`BootScene`, `MapScene` for exploring, `FightScene` for fights), map drawing shared by both (`src/render/mapView.ts`), DOM HUD (`index.html`; the bottom status bar `src/ui/bar.ts`, the Characteristics and Spells windows `src/ui/windows.ts`, spells in plain words `src/ui/spellText.ts`, hero view model `src/ui/characters.ts`; map readouts `src/hud.ts`; fight timeline and hover card `src/fight/fightHud.ts`), the prototype party and encounter (`src/fight/setup.ts`), event wording (`src/fight/describe.ts`), config in `src/config.ts`. In dev, `window.shardfall` exposes the live fight (`fight()`, `busy()`, `auto()`).
- `packages/tools` — map generator, Tiled converter (`src/tiled.ts` holds the zod schema), spell and monster validation (`src/spells.ts`, `src/monsters.ts`), placeholder art (`art/generate_placeholder_art.py`).
- `packages/server` — empty until M2 (Colyseus).
- `content/maps` — Tiled maps and the generated `built/world.json` (committed; `npm run build` regenerates it).
- `content/spells` — one JSON file per class (plus `monsters.json` for monster spells) and the generated `built/spells.json` (committed, regenerated the same way).
- `content/monsters` — monster files and the generated `built/monsters.json` (committed, regenerated the same way).
- `assets/tiles` — PNG sprites plus `manifest.json`, which stores each sprite's anchor (the pixel that sits on a cell centre).

## Rules of the codebase

- **Gameplay logic goes in `shared`**, as pure deterministic functions with Vitest tests. The client only renders and forwards input. Randomness must be injectable (an `Rng` from `createRng(seed)` passed in, never `Math.random`), because the server will roll it from M2 on.
- **Fight actions** (`fight.ts`) take a `FightState` and return `{ ok: false, error }` or `{ ok: true, state, events }` without mutating the input. They validate, `cloneFight`, then let `engine.ts` edit the copy; engine functions mutate and must never see a caller's state, so `index.ts` does not export them. Rolls come from the `Rng` passed to the action.
- **Grid vs screen coordinates.** A map is 14 cells across × 40 staggered lines = 560 cells. Gameplay (range, areas, distance, pathfinding, LoS) uses diamond grid coordinates from `cellToGrid`; screen pixels (`cellToScreen`) are for drawing only. Never compute gameplay from pixels.
- **Combat movement is orthogonal only** (`findPath` without `diagonals`, `reachableCells`); diagonal steps are for exploration.
- **Content is data.** Spells, monsters and items go in typed JSON under `content/`, validated with zod at build time, not hard-coded in TypeScript. Follow the spell data model in `docs/design.md`; enum lists (`ELEMENTS`, `EFFECT_KINDS`, ...) are constants in `spell.ts` so the zod schema and the types share them.
- TypeScript is strict with `noUncheckedIndexedAccess`. Inside `shared`, imports use `.js` extensions (`./grid.js`).
- Original IP only: no names, characters, art or text copied from Dofus or any other game.
- Keep `README.md` accurate when commands or controls change.

## M1 (offline combat prototype): built

1. ~~Fight state in `shared`: placement on start cells, initiative order, turns, AP/MP, end conditions.~~ Done (`fight.ts`). Tackle and buff ticks hook into `moveFighter` and `beginTurn`.
2. ~~Spell data model and engine.~~ Done: cast rules (`fight.ts`), effects (`engine.ts`, rules in `docs/design.md` > Spells > Effects), formulas (`formulas.ts`), tackle in `moveFighter`. Damage over time ticks at the start of the target's turns. Summons, glyphs and traps are not supported yet; the content check rejects them.
3. ~~First kits for Vanguard, Longshot and Mender.~~ Done: 3 pairs per class in `content/spells/`, each spell pinned by `test/kits.test.ts`. Numbers are first-pass; balance comes from playtests in step 5. The other 7 pairs per class come later.
4. ~~Monster AI by utility scoring (Brute and Caster archetypes first).~~ Done: `ai.ts` (`playAiTurn`, `planAiStep`), monsters in `content/monsters/` (Thornback Boar, Dewdrop Wisp). Rules in `docs/design.md` > Monster AI.
5. ~~Client fight on Brightmoor Meadow.~~ Done: `FightScene` (placement, timeline, spell bar, previews, AI turns, result), start cells as map properties `startA`/`startB`, class and monster placeholder sprites. `fight-smoke.ts meadow` is the same fight without the client.

## Next up

1. **M1 gate**: playtests. Balance spells and monsters from what players say; the numbers in `content/` are first-pass.
2. The other seven spell pairs per launch class (pairs 4–10), as content.
3. **M2, online fights** (see `docs/design.md` > Roadmap): Colyseus rooms in `packages/server`, server-rolled RNG, accounts and persistence.
