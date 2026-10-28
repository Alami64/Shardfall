import Phaser from 'phaser';
import { spriteUrls } from '../assets';
import { GAME_H, GAME_W, START_MAP_ID } from '../config';

/** Loads every sprite, with a thin progress bar, then opens the starting map. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    const w = 320;
    const x = (GAME_W - w) / 2;
    const y = GAME_H / 2;
    const track = this.add.rectangle(x, y, w, 4, 0x2c4535).setOrigin(0, 0.5);
    const bar = this.add.rectangle(x, y, 0, 4, 0xf2a541).setOrigin(0, 0.5);
    this.load.on('progress', (p: number) => {
      bar.width = w * p;
    });
    this.load.on('complete', () => {
      track.destroy();
      bar.destroy();
    });
    for (const { key, url } of spriteUrls) this.load.image(key, url);
  }

  create() {
    this.scene.start('map', { mapId: START_MAP_ID });
  }
}
