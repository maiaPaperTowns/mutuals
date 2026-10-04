"""mutuals badge screens for the native display app → native/photon/display/photon_assets.c (RGB565).

Layout (320×240, the OG's landscape LCD), matching the mutuals design board:
  status icons + pixel "mutuals" logo   (baked)
  the pup, bobbing                      (sprite tiles, blitted over the background)
  title / detail line                   (drawn by the badge with the fonts below)
  ★ points · Lv N · progress bar        (star + bar track baked, numbers and fill drawn by the badge)
  MENU BACK YES NEXT NO                 (baked, each label centred over its physical button)

Every screen shares ONE background; a scene is just a sprite (with bob offsets) placed on it. Text and numbers are
anti-aliased 4-bit glyphs blended onto that background by the badge, so names, points and levels can change live.

  .venv/bin/python native/make_assets.py        (from freewili/)
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from photon_fw.display import font  # noqa: E402

OUT = ROOT / "native" / "photon" / "display"
SPRITES = ROOT / "assets" / "sprites"
W, H = 320, 240
MINT, LAVENDER = (214, 240, 228), (228, 224, 248)
NAVY, MUTED, TRACK = (36, 40, 74), (110, 108, 140), (226, 228, 240)
BUTTONS = [("MENU", (170, 170, 185)), ("BACK", (248, 205, 79)), ("YES", (60, 190, 110)),
           ("NEXT", (70, 150, 255)), ("NO", (235, 80, 80))]
BUTTON_X = [32, 96, 160, 224, 288]      # centres, one per physical button under the screen
TILE = (84, 20, 152, 104)               # x, y, w, h: the pup area, any bob offset
SPRITE_H = 92
BAR = (56, 186, 264, 193)               # progress bar x0, y0, x1, y1 (the badge fills it)
STAR_XY = (54, 175)

# name: (sprite file, bob offsets). Order = photon_sprite_id_t in photon_assets.h.
SPRITE_SET = {
    "lv1": ("lv1", (3, 0, -3)), "lv2": ("lv2", (3, 0, -3)), "lv3": ("lv3", (3, 0, -3)),
    "lv4": ("lv4", (3, 0, -3)), "lv5": ("lv5", (3, 0, -3)),
    "looking": ("searching", (2, 0, -2)), "match": ("match", (0,)), "mutual": ("double_yes", (3, -3)),
    "miss": ("waiting", (0,)), "nearby": ("nearby", (3, 0, -3)),
    "offline": ("offline", (0,)), "blank": (None, (0,)),
}
FONTS = {"small": (13, 17), "large": (20, 26)}


def gradient() -> Image.Image:
    im = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(round(MINT[i] * (1 - t) + LAVENDER[i] * t) for i in range(3)))
    return im


def star(d: ImageDraw.ImageDraw, x: int, y: int, r: int = 7) -> None:
    import math
    pts = [(x + (r if k % 2 == 0 else r * 0.45) * math.sin(math.pi * k / 5),
            y - (r if k % 2 == 0 else r * 0.45) * math.cos(math.pi * k / 5)) for k in range(10)]
    d.polygon(pts, fill=(248, 205, 79), outline=(196, 140, 40))


def background() -> Image.Image:
    im = gradient()
    d = ImageDraw.Draw(im)
    # status bar: signal bars + a dot (left), battery (right), like the board's mock phone screens
    for i, h in enumerate((3, 5, 7)):
        d.rectangle([8 + i * 4, 12 - h, 10 + i * 4, 12], fill=NAVY)
    d.ellipse([22, 5, 29, 12], outline=NAVY, width=2)
    d.rounded_rectangle([291, 5, 309, 13], 2, outline=NAVY, width=2)
    d.rectangle([310, 7, 311, 11], fill=NAVY)
    d.rectangle([294, 8, 304, 10], fill=NAVY)
    # logo
    word = Image.open(SPRITES / "mutuals_word.png").convert("RGBA")
    word = word.resize((round(word.width * 17 / word.height), 17), Image.LANCZOS)
    im.paste(word, ((W - word.width) // 2, 2), word)
    # points row: star + bar track (numbers and fill are drawn live)
    star(d, *STAR_XY)
    d.rounded_rectangle(BAR, 3, fill=TRACK, outline=(200, 202, 222))
    # button row, each label over its button
    d.line([(10, 203), (W - 10, 203)], fill=(206, 204, 226))
    for (label, col), cx in zip(BUTTONS, BUTTON_X):
        d.ellipse([cx - 7, 208, cx + 7, 222], fill=col, outline=NAVY, width=1)
        f = font(10)
        d.text((cx - d.textlength(label, font=f) / 2, 225), label, font=f, fill=NAVY)
    return im


def sprite(name: str | None) -> Image.Image | None:
    if name is None:
        return None
    sp = Image.open(SPRITES / f"{name}.png").convert("RGBA")
    sp = sp.crop(sp.getbbox())
    scale = min(SPRITE_H / sp.height, (TILE[2] - 8) / sp.width)
    return sp.resize((max(1, round(sp.width * scale)), max(1, round(sp.height * scale))), Image.LANCZOS)


def rgb565(im) -> list[int]:
    return [((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3) for r, g, b in im.convert("RGB").getdata()]


def c_array(name: str, px: list[int]) -> str:
    rows = [", ".join(f"0x{v:04X}" for v in px[i : i + 16]) for i in range(0, len(px), 16)]
    return f"static const uint16_t {name}[{len(px)}] = {{\n" + ",\n".join(rows) + "\n};\n"


def font_c(name: str, size: int, height: int) -> str:
    """ASCII 32..126 as 4-bit alpha glyphs (two pixels per byte, high nibble first)."""
    f = font(size)
    offsets, widths, data = [], [], bytearray()
    for code in range(32, 127):
        ch = chr(code)
        w = max(1, round(f.getlength(ch)))
        im = Image.new("L", (w, height), 0)
        ImageDraw.Draw(im).text((0, 1), ch, font=f, fill=255)
        offsets.append(len(data)); widths.append(w)
        px = [v >> 4 for v in im.getdata()]
        if len(px) % 2:
            px.append(0)
        data += bytes((px[i] << 4) | px[i + 1] for i in range(0, len(px), 2))
    rows = [", ".join(f"0x{b:02X}" for b in data[i : i + 24]) for i in range(0, len(data), 24)]
    return (f"static const uint8_t font_{name}_data[{len(data)}] = {{\n" + ",\n".join(rows) + "\n};\n"
            f"static const uint32_t font_{name}_off[95] = {{{', '.join(map(str, offsets))}}};\n"
            f"static const uint8_t font_{name}_w[95] = {{{', '.join(map(str, widths))}}};\n"
            f"const photon_font_t photon_font_{name} = {{font_{name}_data, font_{name}_off, font_{name}_w, {height}}};\n")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    bg = background()
    parts = ["/* Generated by native/make_assets.py (mutuals screens). Do not edit. */",
             '#include "photon_assets.h"', "", c_array("background", rgb565(bg)).replace("static ", "", 1)
             .replace("uint16_t background", "uint16_t photon_background_px", 1)]
    total, table = W * H, []
    x, y, w, h = TILE
    for name, (file, bobs) in SPRITE_SET.items():
        sp = sprite(file)
        tiles = []
        for j, bob in enumerate(bobs):
            frame = bg.copy()
            if sp is not None:
                frame.paste(sp, (x + (w - sp.width) // 2, y + (h - sp.height) // 2 + bob), sp)
            parts.append(c_array(f"tile_{name}_{j}", rgb565(frame.crop((x, y, x + w, y + h)))))
            tiles.append(f"tile_{name}_{j}")
            total += w * h
        parts.append(f"static const uint16_t *const tiles_{name}[] = {{{', '.join(tiles)}}};\n")
        table.append(f"    {{tiles_{name}, {len(tiles)}}},  /* {name} */")
    parts.append("const photon_sprite_t photon_sprites[PHOTON_SPRITE_COUNT] = {\n" + "\n".join(table) + "\n};\n")
    for fname, (size, height) in FONTS.items():
        parts.append(font_c(fname, size, height))
    (OUT / "photon_assets.c").write_text("\n".join(parts) + "\n")
    bg.save(ROOT / "native" / "out" / "background.png") if (ROOT / "native" / "out").exists() else None
    print(f"{len(SPRITE_SET)} sprites, {total * 2 / 1024:.0f} KB of pixels → {OUT / 'photon_assets.c'}")


if __name__ == "__main__":
    main()
