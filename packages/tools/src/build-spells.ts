/**
 * Validates every spell file in content/spells/*.json and writes them together
 * to content/spells/built/spells.json.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Spell, SpellCatalogue } from '@shardfall/shared';
import { checkSpells, spellFileSchema } from './spells.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SPELLS_DIR = join(ROOT, 'content/spells');
const OUT_FILE = join(SPELLS_DIR, 'built/spells.json');

function main() {
  const files = readdirSync(SPELLS_DIR).filter((f) => f.endsWith('.json')).sort();
  const spells: Spell[] = [];
  for (const file of files) {
    const parsed = spellFileSchema.safeParse(JSON.parse(readFileSync(join(SPELLS_DIR, file), 'utf8')));
    if (!parsed.success) {
      throw new Error(`${file}: invalid spells:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
    }
    spells.push(...parsed.data);
  }
  const errors = checkSpells(spells);
  if (errors.length) throw new Error(`invalid spells:\n${errors.map((e) => `  ${e}`).join('\n')}`);

  const catalogue: SpellCatalogue = { spells };
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(catalogue, null, 2) + '\n');
  console.log(`validated ${spells.length} spell(s) from ${files.length} file(s) -> ${relative(ROOT, OUT_FILE)}`);
}

main();
