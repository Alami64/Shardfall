# Shardfall

A browser-based, turn-based tactical MMORPG on an isometric grid, built with Phaser 3 and TypeScript. The full design lives in [docs/design.md](docs/design.md).

This repository has finished **milestone M0 (Foundations)** (the isometric renderer, map pipeline and click-to-move exploration) and the build of **M1 (offline combat prototype)**: on Brightmoor Meadow you can attack a group of monsters and fight it turn by turn with a party of three heroes (Vanguard, Longshot, Mender) against the monster AI. Next is the M1 gate: playtesting and balance.

## Quick start

Requires Node 20+ (tested on Node 22) and Python 3 with Pillow (only to regenerate placeholder art).

```bash
npm install          # an .npmrc sets legacy-peer-deps to sidestep an npm workspace bug
npm run dev          # http://localhost:5173
npm test             # rules tests: grid, pathfinding, line of sight, fights, spells, formulas, AI
npm run typecheck
npm run build        # one self-contained file: packages/client/dist/index.html
```

### Controls

The status bar along the bottom holds the message log (left), your party and the active hero's life orb with AP and MP (middle), and the menus, spell slots and fight buttons (right).

| Input | Action |
| --- | --- |
| Click or tap a tile | Walk there (path preview on hover) |
| Click an obstacle | Walk up next to it |
| Click an amber edge tile | Walk off the map into the neighbouring one |
| `R` | Show the cells reachable with 3 MP (combat movement rules) |
| `D` | Show the cell grid: ids, unwalkable cells (red), sight blockers (dark outline) |
| Click the monster group | Walk up to it and start the fight |
| A hero in the party list | Pick whose life orb, spell slots and windows show |
| `C` or the Characteristics button | Open the hero's characteristics: HP, AP, MP, characteristics and what they do, combat stats, resistances (live values with buffs in a fight) |
| `S` or the Spells button, or a spell slot | Open the spell window: cost, range, conditions and every effect of each spell in plain words |
| `Esc` or × | Close the windows |

In a fight you play all three heroes, one turn each:

| Input | Action |
| --- | --- |
| Placement: click a hero (on the map or in the party list), then a blue cell | Move that hero to that start cell (onto an ally: swap) |
| `Enter` or **Ready** | Start the fight (it also starts when the 30 s placement timer runs out) |
| Click a green cell | Walk there (path preview on hover; walking away from an adjacent enemy costs tackle) |
| `1`–`6` or a spell slot | Pick a spell: castable cells light up, the area shows under the cursor (a slot on cooldown shows the turns left) |
| Click a lit cell | Cast the spell there |
| `Esc` or right-click | Put the spell away |
| `Space` or **End turn** | End the turn (it also ends when the 30 s turn timer runs out) |
| **Flee** | The active hero leaves the fight; if all three do, the fight is lost |
| Hover a fighter | Show its HP, AP, MP, buffs and shield in the card at the top right |

Add `?seed=N` to the URL to replay the same fight, and `?speed=N` to play its animations and timers N times faster.
## Layout

```
shardfall/
  docs/                design document
  packages/
    shared/   grid math, A* pathfinding, line of sight, map types, fight engine, monster AI (+ tests)
    client/   Phaser scenes, HUD, Vite single-file build
    tools/    test-map generator, Tiled -> game map converter, placeholder art
    server/   empty until M2 (Colyseus rooms)
  content/maps/        Tiled maps (.tmj) and the converted world.json
  content/spells/      spell data, one JSON file per class, and the validated spells.json
  content/monsters/    monster data and the validated monsters.json
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

A map needs two tile layers, `ground` and `objects`, and the map properties `id`, `name`, `worldX`, `worldY`. The optional string properties `startA` and `startB` list each team's fight start cells as comma-separated cell ids (walkable, no cell in both); the generator picks six per team near the road. Every tile carries `key`, `walkable` and `blocksLos` properties; a cell is walkable when its ground is and its object (if any) is. Maps are linked by world coordinates: walking off the east edge of `[0, 0]` leads to `[1, 0]`. The converter warns when a neighbour exists but the shared edge has no walkable cell.

Object sprites in Tiled are aligned approximately (Tiled anchors tiles bottom-left); the game places them exactly using the anchors in `assets/tiles/manifest.json`.

## Spell content

Spells are data: `content/spells/<class>.json` holds a list of spells in the format described in [docs/design.md](docs/design.md#data-model). `npm run spells:build` validates every file and writes `content/spells/built/spells.json`; `npm run build` runs it too, so a typo or an impossible value (min range above max range, a damage effect with no element) fails the build.

Monsters work the same way: `content/monsters/*.json`, checked by `npm run monsters:build` (also part of `npm run build`) against the built spells.

## Placeholder art

`npm run art` redraws every sprite with Pillow: ground tiles, map objects, the explorer, one figure per launch class (`vanguard_*`, `longshot_*`, `mender_*`) and the meadow monsters (`boar_*`, `wisp_*`). Replace any PNG with real art under the same key and update its anchor in `manifest.json` (the pixel that sits on the cell centre).

## M1, combat prototype

Built:

- Fight engine in `shared`: placement, initiative, turns, AP/MP, spells, effects, tackle (`fight.ts`, `engine.ts`, `formulas.ts`).
- The first three spell pairs of Vanguard, Longshot and Mender (`content/spells/`), and the Thornback Boar and Dewdrop Wisp (`content/monsters/`).
- Monster AI by utility scoring (`ai.ts`).
- The fight in the client: `packages/client/src/scenes/FightScene.ts`.

Launch scope: 3 classes, 3 regions (Brightmoor Isle, Gildhaven, Thornwild Forest), level cap 60; see [docs/design.md](docs/design.md#overview).

Next: the M1 gate (playtest: do people ask to fight again?), balance from those playtests, then M2 (online fights).
