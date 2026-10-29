/**
 * Validates every monster file in content/monsters/*.json against the built
 * spell catalogue (run spells:build first) and writes them together to
 * content/monsters/built/monsters.json.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Monster, MonsterCatalogue, SpellCatalogue } from '@shardfall/shared';
import { checkMonsters, monsterFileSchema } from './monsters.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MONSTERS_DIR = join(ROOT, 'content/monsters');
const SPELLS_FILE = join(ROOT, 'content/spells/built/spells.json');
const OUT_FILE = join(MONSTERS_DIR, 'built/monsters.json');

function main() {
  const { spells } = JSON.parse(readFileSync(SPELLS_FILE, 'utf8')) as SpellCatalogue;
  const files = readdirSync(MONSTERS_DIR).filter((f) => f.endsWith('.json')).sort();
  const monsters: Monster[] = [];
  for (const file of files) {
    const parsed = monsterFileSchema.safeParse(JSON.parse(readFileSync(join(MONSTERS_DIR, file), 'utf8')));
    if (!parsed.success) {
      throw new Error(`${file}: invalid monsters:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
    }
    monsters.push(...parsed.data);
  }
  const errors = checkMonsters(monsters, spells);
  if (errors.length) throw new Error(`invalid monsters:\n${errors.map((e) => `  ${e}`).join('\n')}`);

  const catalogue: MonsterCatalogue = { monsters };
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(catalogue, null, 2) + '\n');
  console.log(`validated ${monsters.length} monster(s) from ${files.length} file(s) -> ${relative(ROOT, OUT_FILE)}`);
}

main();
