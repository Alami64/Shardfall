import type { WorldData } from '@shardfall/shared';
import manifestJson from '../../../assets/tiles/manifest.json';
import worldJson from '../../../content/maps/built/world.json';

export interface SpriteInfo {
  kind: 'ground' | 'object' | 'character';
  width: number;
  height: number;
  /** Pixel inside the image that sits on the cell centre. */
  anchorX: number;
  anchorY: number;
}

export const manifest = manifestJson as Record<string, SpriteInfo>;
export const world = worldJson as unknown as WorldData;

// Vite turns each PNG into a URL (inlined as a data URI in the single-file build).
const urls = import.meta.glob('../../../assets/tiles/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const spriteUrls: { key: string; url: string }[] = Object.entries(urls).map(([path, url]) => ({
  key: path.slice(path.lastIndexOf('/') + 1, -'.png'.length),
  url,
}));

export function sprite(key: string): SpriteInfo {
  const info = manifest[key];
  if (!info) throw new Error(`unknown sprite "${key}"`);
  return info;
}
