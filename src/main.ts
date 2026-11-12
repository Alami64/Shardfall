import { boot } from './game.js';
import { loadEnvSprites } from './render/envSprites.js';
import { loadHeroSprite } from './render/heroSprite.js';

// Images are loaded first so that portraits and the first frame are never drawn blank.
void Promise.all([loadHeroSprite(), loadEnvSprites()]).then(boot);
