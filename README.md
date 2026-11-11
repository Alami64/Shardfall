# Shardfall

A browser-based, turn-based tactical RPG on an isometric grid. You play a Runeblade who sets out from the village of Emberhollow, fights monster groups across ten maps, levels up, collects equipment and finally faces Thornmaw, the Rootbound King.

The world, names and art are original. All art is drawn in code; there are no image files.

## Play

```bash
npm install
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # one self-contained file: dist/index.html (open it directly in a browser)
```

Progress is saved in the browser (`localStorage`).

### Controls

| Where | Input | Action |
|---|---|---|
| Map | Click the ground | Walk there |
| Map | Click a monster | Walk up and attack its group |
| Map | Click a villager | Talk (shop, healer, quests) |
| Map | Click an edge cell with an arrow | Travel to the next map |
| Fight | Click a highlighted cell, then **Ready** (Space) | Choose your start cell |
| Fight | Click a green cell | Move (costs MP) |
| Fight | `1`–`9`, `0`, `-` or click a spell, then click a cell | Cast (costs AP) |
| Fight | Space or **End turn** | End your turn |
| Fight | Esc or right-click | Put the spell away |
| Anywhere | `C` `I` `S` `M` | Characteristics, inventory, spells, world map |

## What is in the game

- **One class, the Runeblade**: 10 spells unlocked from level 1 to 24, plus the attack of the equipped weapon. Three elements, each fed by a characteristic: physical (Strength), fire (Intellect), storm (Agility).
- **Character**: level cap 30; 5 characteristic points and 1 spell point per level; spells have 5 ranks.
- **Fights**: start-cell placement, initiative order, AP and MP, range and line of sight, area spells, cooldowns, critical hits, buffs and debuffs, poison, shields, pushback with collision damage, and locking (an adjacent enemy can hold you in place when you try to walk away).
- **10 maps**: Emberhollow (safe village), three meadows, two forest maps, two marsh maps, the Kessari Ruins and Thornmaw's Hollow. Monster levels run from 1 to 25.
- **10 monsters** with their own spells and behaviour (melee, ranged, support), in groups of 1 to 4 that wander and respawn.
- **Items**: 35 pieces of equipment in 8 slots with rolled stats, 4 sets with bonuses, 9 resources and 3 foods. A shop to buy and sell.
- **8 quests** from Old Tobin, ending with the boss.

Not in the game: multiplayer, crafting, summons, traps, sound.

## Code

- `src/core` holds the rules with no rendering: grid, paths and line of sight, content data, character, fights and monster AI, map generation. Randomness is always a seeded `Rng` passed in.
- `src/render` draws tiles, scenery, characters, monsters and icons on a canvas.
- `src/ui/hud.ts` is the DOM interface; `src/game.ts` is the controller.

## Checks

```bash
npm run typecheck
npm run sim              # plays fights through the engine and prints win rates per map
node tools/drive.mjs play   # after a build: plays the game in headless Chromium and checks it
node tools/drive.mjs tour   # screenshots of every map and window into shots/
```

`npm run sim` plays the hero with the same simple AI the monsters use, so a person does better than these numbers. With that AI, a group of three monsters at the low end of each map's level range is won almost every time in the meadows and forest and at least 80% of the time in the marsh (40–75% health left), and about half the time in the ruins at level 17; the boss falls about half the time at level 25.
