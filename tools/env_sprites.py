"""Copies an environment art pack into assets/env.

    python3 tools/env_sprites.py <pack folder>

The pack holds sprites-3x/*.png, assets.json and sources/. The 3x sprites are copied with their
alpha cleaned (nearly opaque pixels become opaque, faint haze becomes transparent), assets.json
becomes manifest.json, and the masters go to assets/env/sources (kept for edits, not bundled).
"""
import json, os, shutil, sys
from PIL import Image

pack = sys.argv[1]
out = 'assets/env'
os.makedirs(f'{out}/sources', exist_ok=True)
manifest = json.load(open(f'{pack}/assets.json'))
for name in manifest['assets']:
    im = Image.open(f'{pack}/sprites-3x/{name}.png').convert('RGBA')
    a = im.split()[3].point(lambda v: 255 if v >= 240 else (0 if v < 8 else v))
    im.putalpha(a)
    im.save(f'{out}/{name}.png', optimize=True)
    print(name, im.size, os.path.getsize(f'{out}/{name}.png'), 'bytes')
for f in os.listdir(f'{pack}/sources'):
    shutil.copy(f'{pack}/sources/{f}', f'{out}/sources/{f}')
json.dump(manifest, open(f'{out}/manifest.json', 'w'), indent=2)
shutil.copy(f'{pack}/grid-preview.png', f'{out}/sources/grid-preview.png')
