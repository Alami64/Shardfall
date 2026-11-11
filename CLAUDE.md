# Shardfall

Browser-based, turn-based tactical RPG on an isometric grid. Vite + TypeScript, Canvas 2D, DOM HUD, no game framework. One class (Runeblade), 10 maps, level cap 30. Original world, names and art; all art is drawn in code.

## Commands

```bash
npm install
npm run dev         # Vite dev server on :5173
npm run typecheck   # tsc
npm run build       # typecheck, then dist/index.html (single self-contained file)
npm run sim         # fights through the engine, win rates per map (tools/sim.ts)
node tools/drive.mjs play   # needs a build: plays in headless Chromium, prints PASS/FAIL checks
node tools/drive.mjs tour   # screenshots of maps, a fight and the windows into shots/
node tools/drive.mjs poses  # shots/poses.png: every hero pose, front and back
```

Before finishing a change: `npm run build && node tools/drive.mjs play` must pass. Look at `shots/` after a visual change; after touching the hero, run the `poses` scenario and check that the pose at `t = 0` is still the clean rest pose.

## Layout

- `src/core` — rules with no rendering or I/O: `grid.ts` (cells, diamond coordinates, areas), `path.ts` (BFS paths, reachable cells, line of sight), `content.ts` (spells, monsters, items, sets, maps, shop, quests as data), `character.ts` (stats, XP, inventory, equipment), `fight.ts` (fight state, move/cast/end turn, effects, AI), `world.ts` (map generation, village, exits, monster groups), `rng.ts`.
- `src/render` — `sprites.ts` (tiles, scenery, hero, monsters; the hero is jointed parts posed by `heroPose`, with every timing and angle in `HERO_MOTION`), `icons.ts`, `view.ts` (frame drawing, depth sort, effects, actor movement).
- `src/ui/hud.ts` — bar, timeline, log, tooltips, windows. `src/state.ts` — shared client state `G`. `src/game.ts` — controller (input, exploring, fight flow, rewards, NPCs, save). In the browser `window.shardfall` exposes test hooks (`auto`, `speed`, `level`, `give`, `goto`, `fight`).

## Rules of the codebase

- Gameplay logic goes in `src/core` as deterministic code; randomness is an `Rng` from `createRng(seed)` passed in, never `Math.random`. The client renders and forwards input.
- A map is 14 columns x 31 staggered rows. Gameplay (distance, range, areas, paths, line of sight) uses diamond coordinates from `uv()`; screen pixels (`center()`) are for drawing only.
- Fight movement is orthogonal; diagonal steps are for exploring.
- Content is data in `content.ts`. Balance changes go there and are checked with `npm run sim`.
- Original IP only: no names, characters, art, interface layout or text copied from any existing game.
- Keep `README.md` accurate when commands or controls change.
