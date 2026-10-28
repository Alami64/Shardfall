# Shardfall

A browser-based, turn-based tactical MMORPG on an isometric grid, built with Phaser 3 and TypeScript. The full design lives in [docs/design.md](docs/design.md).

This repository is at **milestone M0 (Foundations)**: the isometric renderer, map pipeline and click-to-move exploration. Combat starts in M1.

## Quick start

Requires Node 20+ (tested on Node 22) and Python 3 with Pillow (only to regenerate placeholder art).

```bash
npm install          # an .npmrc sets legacy-peer-deps to sidestep an npm workspace bug
npm run dev          # http://localhost:5173
npm test             # grid, pathfinding and line-of-sight tests
npm run typecheck
npm run build        # one self-contained file: packages/client/dist/index.html
```

### Controls

| Input | Action |
| --- | --- |
| Click or tap a tile | Walk there (path preview on hover) |
| Click an obstacle | Walk up next to it |
| Click an amber edge tile | Walk off the map into the neighbouring one |
| `R` | Show the cells reachable with 3 MP (combat movement rules) |
| `D` | Show the cell grid: ids, unwalkable cells (red), sight blockers (dark outline) |

## Layout

```
shardfall/
  docs/                design document
  packages/
    shared/   grid math, A* pathfinding, line of sight, map types (+ tests)
    client/   Phaser scenes, HUD, Vite single-file build
    tools/    test-map generator, Tiled -> game map converter, placeholder art
    server/   empty until M2 (Colyseus rooms)
  content/maps/        Tiled maps (.tmj) and the converted world.json
  assets/tiles/        sprites + manifest.json (anchor point of every sprite)
```

## The grid

Each map is a staggered isometric grid: **14 cells across and 40 staggered lines = 560 cells**, numbered left to right, top to bottom. Odd lines are shifted half a tile right. Tiles are 86 × 43 px diamonds.

Gameplay code never uses screen positions. It uses diamond **grid coordinates** (`cellToGrid`), where `+x` is one step down-right and `+y` one step up-right on screen:

- **Orthogonal steps** change x or y by 1. Combat movement, ranges and areas use these; distance is Manhattan distance.
- **Diagonal steps** change both (screen-horizontal or screen-vertical moves). They are allowed only while exploring, never through a corner between two blocked cells, and cost their on-screen length (horizontal ≈ 1.79, vertical ≈ 0.89 orthogonal steps).

`screenToCell` inverts the projection for mouse picking; `hasLineOfSight` walks the cells under the line between two cell centres and treats a line that grazes an exact corner as blocked only when both corner cells block.

## Map pipeline

1. `npm run maps:generate` writes the two test maps to `content/maps/*.tmj`. Open them in [Tiled](https://www.mapeditor.org/) (staggered, stagger axis Y, odd index) to edit.
2. `npm run maps:build` validates every `.tmj` and writes `content/maps/built/world.json`. `npm run build` runs this first.

A map needs two tile layers, `ground` and `objects`, and the map properties `id`, `name`, `worldX`, `worldY`. Every tile carries `key`, `walkable` and `blocksLos` properties; a cell is walkable when its ground is and its object (if any) is. Maps are linked by world coordinates: walking off the east edge of `[0, 0]` leads to `[1, 0]`. The converter warns when a neighbour exists but the shared edge has no walkable cell.

Object sprites in Tiled are aligned approximately (Tiled anchors tiles bottom-left); the game places them exactly using the anchors in `assets/tiles/manifest.json`.

## Placeholder art

`npm run art` redraws every sprite with Pillow. Replace any PNG with real art under the same key and update its anchor in `manifest.json` (the pixel that sits on the cell centre).

## Next: M1, combat prototype

- Fight state machine in `shared`: placement, initiative order, turns, AP/MP.
- Spell data model and the first kits for Vanguard, Longshot, Mender and Warden.
- Damage, tackle and line-of-sight rules from the design doc, with tests.
- Monster AI by utility scoring; one monster group on Brightmoor Meadow to fight.
