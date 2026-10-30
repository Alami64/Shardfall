"""Generate Shardfall placeholder art: ground tiles, map objects, the hero, the class
fighters and the monsters of Brightmoor, Gildhaven and Thornwild.

Everything is drawn at 4x and downsampled for smooth edges. Output goes to
assets/tiles/*.png plus assets/tiles/manifest.json, which records each sprite's
anchor (the pixel that sits on a cell centre) so the client and Tiled agree.

Run from the repo root:  python3 packages/tools/art/generate_placeholder_art.py
Replace these files with real art later; keep the same keys and anchors.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "assets" / "tiles"
S = 4  # supersampling factor

TILE_W, TILE_H = 86, 43
# Ground images are 2 px larger than the cell so neighbouring diamonds overlap
# and no hairline seams show between them.
GROUND_W, GROUND_H = TILE_W + 2, TILE_H + 2

manifest: dict[str, dict] = {}


def rgb(hex_: str) -> tuple[int, int, int]:
    hex_ = hex_.lstrip("#")
    return tuple(int(hex_[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def shade(c: tuple[int, int, int], f: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(v * f))) for v in c)  # type: ignore[return-value]


def save(img: Image.Image, key: str, size: tuple[int, int], anchor: tuple[float, float], kind: str) -> None:
    small = img.resize(size, Image.LANCZOS)
    small.save(OUT / f"{key}.png")
    manifest[key] = {
        "kind": kind,
        "width": size[0],
        "height": size[1],
        "anchorX": anchor[0],
        "anchorY": anchor[1],
    }


# ---------------------------------------------------------------- ground tiles


def diamond_mask() -> tuple[Image.Image, list[tuple[float, float]]]:
    w, h = GROUND_W * S, GROUND_H * S
    pts = [(w / 2, 0), (w, h / 2), (w / 2, h), (0, h / 2)]
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    return mask, pts


def inside(px: float, py: float) -> bool:
    w, h = GROUND_W * S, GROUND_H * S
    return abs(px - w / 2) / (w / 2) + abs(py - h / 2) / (h / 2) <= 0.92


def ground_tile(key: str, base: str, seed: int, detail) -> None:
    rnd = random.Random(seed)
    w, h = GROUND_W * S, GROUND_H * S
    tex = Image.new("RGBA", (w, h), rgb(base) + (255,))
    d = ImageDraw.Draw(tex)
    # Soft mottling so large fields don't look flat.
    for _ in range(140):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(6, 18)
        f = rnd.uniform(0.93, 1.07)
        d.ellipse([x - r, y - r * 0.5, x + r, y + r * 0.5], fill=shade(rgb(base), f) + (255,))
    tex = tex.filter(ImageFilter.GaussianBlur(5))
    d = ImageDraw.Draw(tex)
    detail(d, rnd)
    mask, _ = diamond_mask()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(tex, (0, 0), mask)
    save(out, key, (GROUND_W, GROUND_H), (GROUND_W / 2, GROUND_H / 2), "ground")


def grass_detail(tufts: int, flowers: list[str] | None = None):
    def draw(d: ImageDraw.ImageDraw, rnd: random.Random) -> None:
        for _ in range(tufts):
            x, y = rnd.uniform(0, GROUND_W * S), rnd.uniform(0, GROUND_H * S)
            if not inside(x, y):
                continue
            col = rnd.choice([rgb("#4f8f3a"), rgb("#5c9c41"), rgb("#8cc56a")])
            for k in range(3):
                dx = (k - 1) * 4
                d.line([x + dx, y, x + dx * 1.8 + rnd.uniform(-2, 2), y - rnd.uniform(8, 14)], fill=col, width=3)
        for col in flowers or []:
            for _ in range(5):
                x, y = rnd.uniform(0, GROUND_W * S), rnd.uniform(0, GROUND_H * S)
                if not inside(x, y):
                    continue
                for a in range(5):
                    ang = a * 2 * math.pi / 5
                    px, py = x + math.cos(ang) * 5, y + math.sin(ang) * 3
                    d.ellipse([px - 3.5, py - 3.5, px + 3.5, py + 3.5], fill=rgb(col))
                d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=rgb("#f2c94c"))

    return draw


def path_detail(d: ImageDraw.ImageDraw, rnd: random.Random) -> None:
    for _ in range(28):
        x, y = rnd.uniform(0, GROUND_W * S), rnd.uniform(0, GROUND_H * S)
        if not inside(x, y):
            continue
        r = rnd.uniform(3, 7)
        c = rnd.choice([rgb("#a9824f"), rgb("#d9bb85"), rgb("#9c9184")])
        d.ellipse([x - r, y - r * 0.6, x + r, y + r * 0.6], fill=c)


def water_detail(d: ImageDraw.ImageDraw, rnd: random.Random) -> None:
    for _ in range(9):
        x, y = rnd.uniform(0, GROUND_W * S), rnd.uniform(0, GROUND_H * S)
        if not inside(x, y):
            continue
        L = rnd.uniform(14, 30)
        d.arc([x - L, y - 6, x + L, y + 6], 200, 340, fill=rgb("#9fd3f0"), width=3)


def stone_detail(d: ImageDraw.ImageDraw, rnd: random.Random) -> None:
    w, h = GROUND_W * S, GROUND_H * S
    for row in range(-6, 8):
        for col in range(-2, 8):
            cx = col * 52 + (row % 2) * 26 + rnd.uniform(-3, 3)
            cy = row * 26 + rnd.uniform(-2, 2)
            if not inside(cx, cy):
                continue
            c = shade(rgb("#a7a49c"), rnd.uniform(0.9, 1.08))
            d.rounded_rectangle([cx - 22, cy - 10, cx + 22, cy + 10], radius=7, fill=c, outline=rgb("#7f7b72"), width=2)


# ---------------------------------------------------------------- objects


def blob(d: ImageDraw.ImageDraw, cx: float, cy: float, rx: float, ry: float, fill, outline=None) -> None:
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill, outline=outline, width=4 if outline else 0)


def shadow(d: ImageDraw.ImageDraw, cx: float, cy: float, rx: float) -> None:
    d.ellipse([cx - rx, cy - rx * 0.42, cx + rx, cy + rx * 0.42], fill=(20, 40, 20, 70))


def tree_oak() -> None:
    w, h = 104, 146
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fx, fy = w * S / 2, (h - 14) * S  # foot point = cell centre
    shadow(d, fx, fy, 36 * S)
    d.polygon([(fx - 7 * S, fy), (fx - 5 * S, fy - 50 * S), (fx + 5 * S, fy - 50 * S), (fx + 7 * S, fy)], fill=rgb("#6b4a2f"))
    d.line([(fx + 2 * S, fy - 4 * S), (fx + 3 * S, fy - 44 * S)], fill=rgb("#82603f"), width=2 * S)
    rnd = random.Random(7)
    leaves = [rgb("#2f6b35"), rgb("#3d8240"), rgb("#4f9a4a")]
    clusters = [(0, -86, 34), (-24, -70, 24), (24, -72, 25), (-14, -104, 22), (16, -102, 22), (0, -60, 22)]
    for i, col in enumerate(leaves):
        for (dx, dy, r) in clusters:
            off = (2 - i) * 3
            blob(d, fx + (dx - off * 0.4) * S, fy + (dy + off) * S, (r - i * 4) * S, (r - i * 4) * 0.9 * S, col)
    for _ in range(14):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(6, 26)
        blob(d, fx + (math.cos(a) * r - 6) * S, fy + (-92 + math.sin(a) * r * 0.7) * S, 4 * S, 3 * S, rgb("#7cbf62"))
    save(img, "tree_oak", (w, h), (w / 2, h - 14), "object")


def tree_pine() -> None:
    w, h = 84, 158
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fx, fy = w * S / 2, (h - 14) * S
    shadow(d, fx, fy, 28 * S)
    d.rectangle([fx - 5 * S, fy - 26 * S, fx + 5 * S, fy], fill=rgb("#5e4029"))
    tiers = [(-22, 36), (-52, 30), (-80, 24), (-104, 17), (-124, 10)]
    for i, (dy, half) in enumerate(tiers):
        top = fy + (dy - 36 + i * 2) * S
        base = fy + dy * S
        d.polygon([(fx - half * S, base), (fx, top), (fx + half * S, base)], fill=rgb("#255a3a"))
        d.polygon([(fx - half * 0.15 * S, base), (fx, top), (fx + half * S, base)], fill=rgb("#2f7047"))
    save(img, "tree_pine", (w, h), (w / 2, h - 14), "object")


def rock() -> None:
    w, h = 72, 56
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fx, fy = w * S / 2, (h - 14) * S
    shadow(d, fx, fy, 28 * S)
    body = [(-26, 2), (-22, -18), (-6, -30), (14, -27), (26, -12), (24, 4), (4, 9), (-16, 8)]
    d.polygon([(fx + x * S, fy + y * S) for x, y in body], fill=rgb("#8e8a83"))
    lit = [(-22, -18), (-6, -30), (14, -27), (6, -14), (-10, -10)]
    d.polygon([(fx + x * S, fy + y * S) for x, y in lit], fill=rgb("#b3afa6"))
    d.line([(fx + 2 * S, fy - 12 * S), (fx + 10 * S, fy + 2 * S)], fill=rgb("#6f6b64"), width=2 * S)
    save(img, "rock", (w, h), (w / 2, h - 14), "object")


def bush() -> None:
    w, h = 72, 54
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fx, fy = w * S / 2, (h - 14) * S
    shadow(d, fx, fy, 28 * S)
    for col, k in [(rgb("#2f6b35"), 0), (rgb("#46914a"), 3)]:
        for dx, dy, r in [(-14, -12, 15), (12, -12, 15), (0, -22, 16), (0, -6, 16)]:
            blob(d, fx + dx * S, fy + (dy - k) * S, (r - k) * S, (r - k) * 0.85 * S, col)
    for dx, dy in [(-12, -20), (8, -26), (14, -14), (-4, -10)]:
        blob(d, fx + dx * S, fy + dy * S, 3 * S, 3 * S, rgb("#e05a5a"))
    save(img, "bush", (w, h), (w / 2, h - 14), "object")


# ---------------------------------------------------------------- hero


# Cloak, cloak shadow and scarf per figure. "hero" is the explorer; the others are fighters.
PALETTES = {
    "hero": ("#2a8c8c", "#1d6666", "#f2a541"),
    "vanguard": ("#b5532f", "#86391f", "#e8c35a"),  # rust and brass: melee, Earth and Air
    "longshot": ("#3f7d3a", "#2b5a28", "#d9e4a8"),  # forest green: ranged
    "mender": ("#e8dcc0", "#bfae8a", "#3fa7c9"),  # cream and sky blue: healer
}


def hero(view: str, frame: int, key: str = "hero") -> None:
    """An original placeholder adventurer: hooded cloak and scarf, coloured per figure."""
    w, h = 52, 84
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fx, fy = w * S / 2, (h - 8) * S
    shadow(d, fx, fy, 15 * S)
    cloak_hex, dark_hex, scarf_hex = PALETTES[key]
    cloak, cloak_dark = rgb(cloak_hex), rgb(dark_hex)
    skin, scarf = rgb("#f1c9a5"), rgb(scarf_hex)
    step = 3 if frame else -3
    # legs
    d.rounded_rectangle([fx - 8 * S, fy - 20 * S + step * S * 0.3, fx - 2 * S, fy - 1 * S - (step if step > 0 else 0) * S], radius=2 * S, fill=rgb("#3b2f2a"))
    d.rounded_rectangle([fx + 2 * S, fy - 20 * S - step * S * 0.3, fx + 8 * S, fy - 1 * S - (-step if step < 0 else 0) * S], radius=2 * S, fill=rgb("#3b2f2a"))
    # cloak body
    d.polygon([(fx - 16 * S, fy - 14 * S), (fx - 10 * S, fy - 46 * S), (fx + 10 * S, fy - 46 * S), (fx + 16 * S, fy - 14 * S)], fill=cloak)
    d.polygon([(fx + 2 * S, fy - 46 * S), (fx + 10 * S, fy - 46 * S), (fx + 16 * S, fy - 14 * S), (fx + 6 * S, fy - 14 * S)], fill=cloak_dark)
    d.rectangle([fx - 13 * S, fy - 24 * S, fx + 13 * S, fy - 21 * S], fill=rgb("#5a3d2b"))
    # head and hood
    hx, hy = fx, fy - 56 * S
    blob(d, hx, hy, 14 * S, 14 * S, cloak_dark)
    if view == "front":
        blob(d, hx, hy + 2 * S, 10 * S, 9.5 * S, skin)
        blob(d, hx - 4 * S, hy + 2 * S, 1.8 * S, 2.2 * S, rgb("#2b2b2b"))
        blob(d, hx + 4 * S, hy + 2 * S, 1.8 * S, 2.2 * S, rgb("#2b2b2b"))
        d.arc([hx - 14 * S, hy - 14 * S, hx + 14 * S, hy + 14 * S], 190, 350, fill=cloak, width=5 * S)
        d.polygon([(fx - 11 * S, fy - 45 * S), (fx + 11 * S, fy - 45 * S), (fx + 6 * S, fy - 39 * S), (fx - 6 * S, fy - 39 * S)], fill=scarf)
        d.polygon([(fx + 4 * S, fy - 40 * S), (fx + 9 * S, fy - 40 * S), (fx + 11 * S, fy - 28 * S), (fx + 6 * S, fy - 29 * S)], fill=scarf)
    else:
        blob(d, hx, hy, 13 * S, 13 * S, cloak)
        d.polygon([(hx - 3 * S, hy + 8 * S), (hx + 3 * S, hy + 8 * S), (hx, hy + 18 * S)], fill=cloak_dark)
        d.polygon([(fx - 11 * S, fy - 45 * S), (fx + 11 * S, fy - 45 * S), (fx + 9 * S, fy - 41 * S), (fx - 9 * S, fy - 41 * S)], fill=scarf)
    save(img, f"{key}_{view}_{frame}", (w, h), (w / 2, h - 8), "character")


# ---------------------------------------------------------------- monsters


def boar(frame: int) -> None:
    """Thornback Boar: a stocky boar with a ridge of bramble spines, facing down-right."""
    w, h = 76, 64
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fx, fy = w * S / 2, (h - 10) * S
    shadow(d, fx, fy, 26 * S)
    bob = (1 if frame else 0) * S
    hide, hide_dark = rgb("#7a5236"), rgb("#5a3a25")
    # legs
    for lx in (-16, -6, 8, 18):
        d.rounded_rectangle([fx + (lx - 3) * S, fy - 14 * S, fx + (lx + 3) * S, fy - 1 * S], radius=2 * S, fill=hide_dark)
    # body and head
    blob(d, fx - 2 * S, fy - 22 * S - bob, 24 * S, 14 * S, hide)
    blob(d, fx + 18 * S, fy - 18 * S - bob, 11 * S, 10 * S, hide)
    blob(d, fx + 26 * S, fy - 14 * S - bob, 5 * S, 4 * S, rgb("#c98f73"))  # snout
    blob(d, fx + 20 * S, fy - 22 * S - bob, 1.8 * S, 1.8 * S, rgb("#1e1e1e"))  # eye
    # tusks
    d.polygon([(fx + 22 * S, fy - 12 * S - bob), (fx + 30 * S, fy - 20 * S - bob), (fx + 25 * S, fy - 11 * S - bob)], fill=rgb("#f3ead2"))
    # bramble ridge
    for i, sx in enumerate(range(-20, 14, 6)):
        top = fy - (38 + (i % 2) * 4) * S - bob
        d.polygon([(fx + (sx - 3) * S, fy - 31 * S - bob), (fx + sx * S, top), (fx + (sx + 3) * S, fy - 31 * S - bob)], fill=rgb("#3f6b2e"))
    save(img, f"boar_{frame}", (w, h), (w / 2, h - 10), "character")


def wisp(frame: int) -> None:
    """Dewdrop Wisp: a floating drop of water with a soft glow and two dark eyes."""
    w, h = 48, 72
    base = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    fx, fy = w * S / 2, (h - 8) * S
    lift = (4 if frame else 0) * S
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    # Small enough that the blur fades out well inside the image (no visible box edge).
    ImageDraw.Draw(glow).ellipse([fx - 13 * S, fy - 50 * S - lift, fx + 13 * S, fy - 20 * S - lift], fill=(120, 200, 255, 110))
    base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(3 * S)))
    d = ImageDraw.Draw(base)
    shadow(d, fx, fy, 12 * S)
    cy = fy - 30 * S - lift
    d.polygon([(fx, cy - 26 * S), (fx - 12 * S, cy - 2 * S), (fx + 12 * S, cy - 2 * S)], fill=rgb("#5fb4e6"))
    blob(d, fx, cy, 12 * S, 12 * S, rgb("#5fb4e6"))
    blob(d, fx - 4 * S, cy - 6 * S, 4 * S, 5 * S, rgb("#bfe6ff"))  # highlight
    blob(d, fx - 4 * S, cy + 2 * S, 1.8 * S, 2.4 * S, rgb("#123048"))
    blob(d, fx + 4 * S, cy + 2 * S, 1.8 * S, 2.4 * S, rgb("#123048"))
    save(base, f"wisp_{frame}", (w, h), (w / 2, h - 8), "character")


def sentry(frame: int) -> None:
    """Rustpike Sentry: an old clockwork guard of Gildhaven, rust-red plates and a long pike."""
    w, h = 64, 104
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fx, fy = w * S / 2, (h - 8) * S
    shadow(d, fx, fy, 18 * S)
    bob = (1 if frame else 0) * S
    plate, plate_dark, rust = rgb("#8d7a68"), rgb("#5f5247"), rgb("#b4562e")
    # legs
    for lx in (-7, 7):
        d.rounded_rectangle([fx + (lx - 4) * S, fy - 22 * S, fx + (lx + 4) * S, fy - 1 * S], radius=2 * S, fill=plate_dark)
    # body: a barrel of plates with rust patches
    d.rounded_rectangle([fx - 15 * S, fy - 54 * S - bob, fx + 15 * S, fy - 20 * S - bob], radius=6 * S, fill=plate)
    for rx, ry in ((-8, -44), (6, -30), (-2, -26)):
        blob(d, fx + rx * S, fy + ry * S - bob, 4 * S, 3 * S, rust)
    d.line([fx - 15 * S, fy - 38 * S - bob, fx + 15 * S, fy - 38 * S - bob], fill=plate_dark, width=2 * S)
    # head: a helmet with a glowing slit
    blob(d, fx, fy - 63 * S - bob, 11 * S, 10 * S, plate)
    d.rectangle([fx - 7 * S, fy - 65 * S - bob, fx + 7 * S, fy - 62 * S - bob], fill=rgb("#f2a541"))
    # pike, held on the right
    d.line([fx + 20 * S, fy - 4 * S, fx + 20 * S, fy - 86 * S - bob], fill=rgb("#6b4a2b"), width=3 * S)
    d.polygon([(fx + 16 * S, fy - 84 * S - bob), (fx + 20 * S, fy - 94 * S - bob), (fx + 24 * S, fy - 84 * S - bob)], fill=rgb("#cfd3d6"))
    blob(d, fx + 17 * S, fy - 40 * S - bob, 4 * S, 4 * S, plate_dark)  # hand
    save(img, f"sentry_{frame}", (w, h), (w / 2, h - 8), "character")


def moth(frame: int) -> None:
    """Coinmoth: a fat moth with gilded wings that shed glittering dust."""
    w, h = 64, 72
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fx, fy = w * S / 2, (h - 8) * S
    shadow(d, fx, fy, 12 * S)
    lift = (3 if frame else 0) * S
    cy = fy - 34 * S - lift
    span = 26 if frame else 22
    gold, gold_dark = rgb("#e8c35a"), rgb("#b08a2e")
    for side in (-1, 1):
        d.polygon([(fx, cy - 4 * S), (fx + side * span * S, cy - 18 * S), (fx + side * (span - 4) * S, cy + 4 * S)], fill=gold, outline=gold_dark)
        d.polygon([(fx, cy + 2 * S), (fx + side * 16 * S, cy + 8 * S), (fx + side * 8 * S, cy + 16 * S)], fill=gold_dark)
        blob(d, fx + side * 14 * S, cy - 8 * S, 3.5 * S, 3.5 * S, rgb("#fff3c4"))  # coin spot
    blob(d, fx, cy + 2 * S, 6 * S, 12 * S, rgb("#6e5a3c"))
    blob(d, fx, cy - 10 * S, 6 * S, 6 * S, rgb("#7d6846"))
    blob(d, fx - 2.5 * S, cy - 11 * S, 1.6 * S, 1.6 * S, rgb("#1e1e1e"))
    blob(d, fx + 2.5 * S, cy - 11 * S, 1.6 * S, 1.6 * S, rgb("#1e1e1e"))
    for ax in (-1, 1):
        d.line([fx + ax * 2 * S, cy - 15 * S, fx + ax * 7 * S, cy - 23 * S], fill=rgb("#6e5a3c"), width=S)
    rnd = random.Random(frame)
    for _ in range(6):
        x, y = fx + rnd.uniform(-20, 20) * S, cy + rnd.uniform(10, 26) * S
        blob(d, x, y, 1.2 * S, 1.2 * S, rgb("#ffe58a"))
    save(img, f"moth_{frame}", (w, h), (w / 2, h - 8), "character")


def stalker(frame: int) -> None:
    """Bramble Stalker: a lean forest hunter woven of vines and thorns, facing down-right."""
    w, h = 84, 68
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fx, fy = w * S / 2, (h - 10) * S
    shadow(d, fx, fy, 28 * S)
    bob = (1 if frame else 0) * S
    vine, vine_dark, bark = rgb("#4f7a35"), rgb("#2f4f22"), rgb("#6b4a2b")
    for lx, lean in ((-20, -3), (-10, 2), (10, -2), (20, 3)):
        d.line([fx + lx * S, fy - 18 * S - bob, fx + (lx + lean) * S, fy - 1 * S], fill=bark, width=4 * S)
    blob(d, fx - 2 * S, fy - 26 * S - bob, 26 * S, 11 * S, vine)
    for i, sx in enumerate(range(-22, 18, 5)):
        d.line([fx + sx * S, fy - 22 * S - bob, fx + (sx + 4) * S, fy - 30 * S - bob], fill=vine_dark, width=2 * S)
        top = fy - (40 + (i % 2) * 5) * S - bob
        d.polygon([(fx + (sx - 2) * S, fy - 34 * S - bob), (fx + sx * S, top), (fx + (sx + 2) * S, fy - 34 * S - bob)], fill=rgb("#8a5a35"))
    # head with a long muzzle
    blob(d, fx + 24 * S, fy - 30 * S - bob, 10 * S, 8 * S, vine)
    d.polygon([(fx + 28 * S, fy - 34 * S - bob), (fx + 40 * S, fy - 26 * S - bob), (fx + 28 * S, fy - 23 * S - bob)], fill=vine_dark)
    blob(d, fx + 26 * S, fy - 33 * S - bob, 2 * S, 2 * S, rgb("#f2d14b"))  # eye
    d.polygon([(fx + 18 * S, fy - 36 * S - bob), (fx + 21 * S, fy - 46 * S - bob), (fx + 25 * S, fy - 37 * S - bob)], fill=vine_dark)  # ear
    # tail
    d.line([fx - 26 * S, fy - 28 * S - bob, fx - 38 * S, fy - 40 * S - bob], fill=vine_dark, width=3 * S)
    save(img, f"stalker_{frame}", (w, h), (w / 2, h - 10), "character")


def mirecap(frame: int) -> None:
    """Mirecap: a squat swamp mushroom with a dripping cap and sleepy eyes."""
    w, h = 60, 72
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fx, fy = w * S / 2, (h - 8) * S
    shadow(d, fx, fy, 18 * S)
    squash = (2 if frame else 0) * S
    stem, cap, cap_dark = rgb("#e8dcc0"), rgb("#4a8c84"), rgb("#2f5e58")
    d.rounded_rectangle([fx - 11 * S, fy - 42 * S + squash, fx + 11 * S, fy - 2 * S], radius=8 * S, fill=stem)
    blob(d, fx - 4 * S, fy - 27 * S + squash, 1.8 * S, 1.2 * S, rgb("#3b3328"))
    blob(d, fx + 4 * S, fy - 27 * S + squash, 1.8 * S, 1.2 * S, rgb("#3b3328"))
    d.pieslice([fx - 26 * S, fy - 60 * S + squash, fx + 26 * S, fy - 18 * S + squash], 180, 360, fill=cap)
    d.rectangle([fx - 26 * S, fy - 40 * S + squash, fx + 26 * S, fy - 37 * S + squash], fill=cap_dark)
    for sx, sy, r in ((-12, -48, 4), (6, -52, 3), (14, -44, 3.5), (-2, -44, 2.5)):
        blob(d, fx + sx * S, fy + sy * S + squash, r * S, r * S, rgb("#a9d6c4"))
    for dx in (-20, 18):
        blob(d, fx + dx * S, fy - 33 * S + squash + (2 * S if frame else 0), 1.8 * S, 2.6 * S, rgb("#7fc2e0"))  # drips
    save(img, f"mirecap_{frame}", (w, h), (w / 2, h - 8), "character")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ground_tile("grass_1", "#79b456", 1, grass_detail(10))
    ground_tile("grass_2", "#73ad52", 2, grass_detail(6))
    ground_tile("grass_3", "#80ba5b", 3, grass_detail(14))
    ground_tile("flowers", "#79b456", 4, grass_detail(6, ["#ffffff", "#f7a8c4"]))
    ground_tile("path", "#c8a56f", 5, path_detail)
    ground_tile("water", "#3f86c2", 6, water_detail)
    ground_tile("stone", "#9c998f", 7, stone_detail)
    tree_oak()
    tree_pine()
    rock()
    bush()
    for key in PALETTES:
        for view in ("front", "back"):
            for frame in (0, 1):
                hero(view, frame, key)
    for frame in (0, 1):
        boar(frame)
        wisp(frame)
        sentry(frame)
        moth(frame)
        stalker(frame)
        mirecap(frame)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(manifest)} sprites to {OUT}")


if __name__ == "__main__":
    main()
