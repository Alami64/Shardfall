# Shardfall

Browser-based, turn-based tactical MMORPG on an isometric grid (Dofus-style systems, original world and art). Phaser 3 + TypeScript, npm workspaces.

- Full design: `docs/design.md`. Read the relevant section before building a feature, and update the doc in the same change when the design moves (including the **Progress** checklist at the end).
- Current status: **M0 (Foundations) done**. Next milestone: **M1, offline combat prototype** (see "Next up" below).

## Commands

```bash
npm install          # .npmrc sets legacy-peer-deps: plain npm hits an arborist "edgesOut" bug in this workspace
npm test             # Vitest, packages/shared
npm run typecheck    # tsc for shared, tools, client
npm run build        # converts maps, then builds packages/client/dist/index.html (single self-contained file)
npm run dev          # Vite dev server on :5173
npm run maps:generate  # regenerate the test maps in content/maps/*.tmj (overwrites hand edits)
npm run maps:build     # Tiled .tmj -> content/maps/built/world.json (validated)
npm run art            # redraw placeholder sprites (needs Python 3 + Pillow)
```

Before finishing any change: `npm test && npm run typecheck && npm run build` must pass.

## Layout

- `packages/shared` — game rules with no rendering or I/O: grid math, A* pathfinding, line of sight, map types. The client today and the server from M2 both import it. Tests in `packages/shared/test`.
- `packages/client` — Phaser scenes (`BootScene`, `MapScene`), DOM HUD (`index.html` + `src/hud.ts`), config in `src/config.ts`.
- `packages/tools` — map generator, Tiled converter (`src/tiled.ts` holds the zod schema), placeholder art (`art/generate_placeholder_art.py`).
- `packages/server` — empty until M2 (Colyseus).
- `content/maps` — Tiled maps and the generated `built/world.json` (committed; `npm run build` regenerates it).
- `assets/tiles` — PNG sprites plus `manifest.json`, which stores each sprite's anchor (the pixel that sits on a cell centre).

## Rules of the codebase

- **Gameplay logic goes in `shared`**, as pure deterministic functions with Vitest tests. The client only renders and forwards input. Randomness must be injectable (seeded RNG passed in), because the server will roll it from M2 on.
- **Grid vs screen coordinates.** A map is 14 cells across × 40 staggered lines = 560 cells. Gameplay (range, areas, distance, pathfinding, LoS) uses diamond grid coordinates from `cellToGrid`; screen pixels (`cellToScreen`) are for drawing only. Never compute gameplay from pixels.
- **Combat movement is orthogonal only** (`findPath` without `diagonals`, `reachableCells`); diagonal steps are for exploration.
- **Content is data.** Spells, monsters and items go in typed JSON under `content/`, validated with zod at build time, not hard-coded in TypeScript. Follow the spell data model in `docs/design.md`.
- TypeScript is strict with `noUncheckedIndexedAccess`. Inside `shared`, imports use `.js` extensions (`./grid.js`).
- Original IP only: no names, characters, art or text copied from Dofus or any other game.
- Keep `README.md` accurate when commands or controls change.

## Next up: M1 (offline combat prototype)

1. Fight state in `shared`: placement on start cells, initiative order, turns, AP/MP, end conditions.
2. Spell data model and engine: range shapes, areas, line of sight, cooldowns; damage, tackle, pushback and AP/MP-removal formulas exactly as in `docs/design.md`, each with tests.
3. First kits for Vanguard, Longshot, Mender and Warden (start with the 3 pairs per class in the doc).
4. Monster AI by utility scoring (Brute and Caster archetypes first).
5. Client: a fight on Brightmoor Meadow against one monster group, with a turn timeline, spell bar, range and area previews.
