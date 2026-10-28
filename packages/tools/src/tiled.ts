/**
 * The subset of the Tiled JSON map format (.tmj) Shardfall uses, with a zod
 * schema so the converter fails loudly on maps it cannot read.
 * Reference: https://doc.mapeditor.org/en/stable/reference/json-map-format/
 */
import { z } from 'zod';

const property = z.object({
  name: z.string(),
  type: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const tile = z.object({
  id: z.number().int().nonnegative(),
  image: z.string(),
  imagewidth: z.number(),
  imageheight: z.number(),
  properties: z.array(property).optional(),
});

const tileset = z.object({
  firstgid: z.number().int().positive(),
  name: z.string(),
  tilewidth: z.number(),
  tileheight: z.number(),
  tilecount: z.number().int(),
  columns: z.literal(0, { message: 'only "collection of images" tilesets are supported' }),
  tiles: z.array(tile),
  tileoffset: z.object({ x: z.number(), y: z.number() }).optional(),
});

const tileLayer = z.object({
  id: z.number(),
  name: z.string(),
  type: z.literal('tilelayer'),
  width: z.number(),
  height: z.number(),
  data: z.array(z.number().int().nonnegative()),
  visible: z.boolean().optional(),
  opacity: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const tiledMapSchema = z.object({
  type: z.literal('map'),
  orientation: z.literal('staggered'),
  staggeraxis: z.literal('y'),
  staggerindex: z.literal('odd'),
  width: z.literal(14),
  height: z.literal(40),
  tilewidth: z.literal(86),
  tileheight: z.literal(43),
  infinite: z.literal(false),
  layers: z.array(tileLayer),
  tilesets: z.array(tileset),
  properties: z.array(property),
});

export type TiledMap = z.infer<typeof tiledMapSchema>;
export type TiledTileset = z.infer<typeof tileset>;
export type TiledProperty = z.infer<typeof property>;

/** Tiled stores flip/rotation flags in the top bits of a gid. */
export const GID_MASK = 0x1fffffff;

export function prop(props: TiledProperty[] | undefined, name: string): string | number | boolean | undefined {
  return props?.find((p) => p.name === name)?.value;
}
