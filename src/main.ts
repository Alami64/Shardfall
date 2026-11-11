import { boot } from './game.js';
import { loadHeroSprite } from './render/heroSprite.js';

// The sprite sheet is loaded first so that portraits are never drawn blank.
void loadHeroSprite().then(boot);
