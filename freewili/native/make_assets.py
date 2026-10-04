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

FORMAL_ICONS = ["f_home", "f_looking", "f_match", "f_mutual", "f_miss", "f_nearby", "f_offline", "f_level"]

# name: (sprite file, bob offsets). Order = photon_sprite_id_t in photon_assets.h.
SPRITE_SET = {
    "lv1": ("lv1", (3, 0, -3)), "lv2": ("lv2", (3, 0, -3)), "lv3": ("lv3", (3, 0, -3)),
    "lv4": ("lv4", (3, 0, -3)), "lv5": ("lv5", (3, 0, -3)),
    "looking": ("searching", (2, 0, -2)), "match": ("match", (0,)), "mutual": ("double_yes", (3, -3)),
    "miss": ("waiting", (0,)), "nearby": ("nearby", (3, 0, -3)),
    "offline": ("offline", (0,)), "blank": (None, (0,)),
    **{name: (name, (0,)) for name in FORMAL_ICONS},  # formal style: static icons on the formal background
}
FONTS = {"small": (13, 17), "large": (20, 26)}

# ---- formal style (recruiting events): white/slate, navy type, line icons instead of the pup ----
F_TOP, F_BOTTOM = (250, 251, 253), (234, 238, 245)
F_NAVY, F_ACCENT, F_SOFT, F_OK = (22, 34, 64), (44, 98, 180), (196, 206, 224), (40, 150, 110)


def person(d: ImageDraw.ImageDraw, cx: int, cy: int, s: float, col) -> None:
    """A simple head-and-shoulders silhouette."""
    r = 9 * s
    d.ellipse([cx - r, cy - 22 * s - r, cx + r, cy - 22 * s + r], fill=col)
    d.chord([cx - 18 * s, cy - 8 * s, cx + 18 * s, cy + 26 * s], 180, 360, fill=col)


def formal_icon(name: str) -> Image.Image:
    """Line/flat icons on a transparent 140x96 canvas, drawn at 3x and scaled down for smooth edges."""
    S = 3
    W_, H_ = 140 * S, 96 * S
    im = Image.new("RGBA", (W_, H_), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = W_ // 2, H_ // 2 + 8 * S
    ring = lambda r, col, w: d.ellipse([cx - r, cy - 10 * S - r, cx + r, cy - 10 * S + r], outline=col, width=w)  # noqa: E731
    if name == "f_home":
        ring(40 * S, F_SOFT, 2 * S)
        person(d, cx, cy + 2 * S, S * 1.25, F_NAVY)
    elif name == "f_looking":
        for r in (16, 28, 40):
            ring(r * S, F_SOFT if r > 16 else F_ACCENT, 2 * S)
        d.line([cx, cy - 10 * S, cx + 30 * S, cy - 34 * S], fill=F_ACCENT, width=3 * S)
        d.ellipse([cx - 5 * S, cy - 15 * S, cx + 5 * S, cy - 5 * S], fill=F_ACCENT)
    elif name in ("f_match", "f_mutual", "f_nearby"):
        person(d, cx - 30 * S, cy + 2 * S, S * 1.05, F_NAVY)
        person(d, cx + 30 * S, cy + 2 * S, S * 1.05, F_ACCENT if name != "f_mutual" else F_NAVY)
        if name == "f_match":
            d.line([cx - 10 * S, cy - 18 * S, cx + 10 * S, cy - 18 * S], fill=F_ACCENT, width=3 * S)
            d.ellipse([cx - 5 * S, cy - 23 * S, cx + 5 * S, cy - 13 * S], outline=F_ACCENT, width=3 * S)
        elif name == "f_nearby":
            for r in (8, 15, 22):
                d.arc([cx - r * S, cy - 18 * S - r * S, cx + r * S, cy - 18 * S + r * S], 230, 310, fill=F_ACCENT, width=2 * S)
        else:
            d.ellipse([cx - 13 * S, cy - 40 * S, cx + 13 * S, cy - 14 * S], fill=F_OK)
            d.line([cx - 6 * S, cy - 27 * S, cx - 1 * S, cy - 21 * S, cx + 7 * S, cy - 33 * S], fill="white", width=3 * S)
    elif name == "f_miss":
        ring(30 * S, F_NAVY, 3 * S)
        d.line([cx, cy - 10 * S, cx, cy - 30 * S], fill=F_NAVY, width=3 * S)
        d.line([cx, cy - 10 * S, cx + 14 * S, cy - 4 * S], fill=F_NAVY, width=3 * S)
    elif name == "f_offline":
        d.rounded_rectangle([cx - 24 * S, cy - 18 * S, cx + 24 * S, cy + 18 * S], 6 * S, fill=F_NAVY)
        d.arc([cx - 16 * S, cy - 44 * S, cx + 16 * S, cy - 4 * S], 180, 360, fill=F_NAVY, width=5 * S)
        d.ellipse([cx - 5 * S, cy - 6 * S, cx + 5 * S, cy + 4 * S], fill="white")
    elif name == "f_level":
        d.polygon([(cx - 14 * S, cy + 8 * S), (cx - 24 * S, cy + 30 * S), (cx - 4 * S, cy + 22 * S)], fill=F_ACCENT)
        d.polygon([(cx + 14 * S, cy + 8 * S), (cx + 24 * S, cy + 30 * S), (cx + 4 * S, cy + 22 * S)], fill=F_ACCENT)
        ring(26 * S, F_NAVY, 0)
        d.ellipse([cx - 26 * S, cy - 36 * S, cx + 26 * S, cy + 16 * S], fill=F_NAVY)
        star(d, cx, cy - 10 * S, 15 * S)
    return im.resize((140, 96), Image.LANCZOS)


def background_formal() -> Image.Image:
    im = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(round(F_TOP[i] * (1 - t) + F_BOTTOM[i] * t) for i in range(3)))
    for i, h in enumerate((3, 5, 7)):
        d.rectangle([8 + i * 4, 12 - h, 10 + i * 4, 12], fill=F_NAVY)
    d.rounded_rectangle([291, 5, 309, 13], 2, outline=F_NAVY, width=2)
    d.rectangle([310, 7, 311, 11], fill=F_NAVY)
    d.rectangle([294, 8, 304, 10], fill=F_NAVY)
    f = font(15)
    word = "mutuals"
    d.text(((W - d.textlength(word, font=f)) / 2, 1), word, font=f, fill=F_NAVY)
    d.rectangle([STAR_XY[0] - 6, STAR_XY[1] - 6, STAR_XY[0] + 6, STAR_XY[1] + 6], fill=F_ACCENT)  # square bullet
    d.rounded_rectangle(BAR, 3, fill=(226, 231, 240), outline=F_SOFT)
    d.line([(10, 203), (W - 10, 203)], fill=F_SOFT)
    for (label, col), cx in zip(BUTTONS, BUTTON_X):
        d.ellipse([cx - 6, 209, cx + 6, 221], fill=col, outline=F_NAVY, width=1)
        f10 = font(10)
        d.text((cx - d.textlength(label, font=f10) / 2, 225), label, font=f10, fill=F_NAVY)
    return im


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
    if name.startswith("f_"):
        return formal_icon(name)
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
    bg, bg_formal = background(), background_formal()
    parts = ["/* Generated by native/make_assets.py (mutuals screens). Do not edit. */",
             '#include "photon_assets.h"', "",
             c_array("background_cute", rgb565(bg)), c_array("background_formal", rgb565(bg_formal)),
             "const uint16_t *const photon_backgrounds[2] = {background_cute, background_formal};\n"]
    total, table = 2 * W * H, []
    x, y, w, h = TILE
    for name, (file, bobs) in SPRITE_SET.items():
        sp = sprite(file)
        tiles = []
        for j, bob in enumerate(bobs):
            frame = (bg_formal if name.startswith("f_") else bg).copy()
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
    if (ROOT / "native" / "out").exists():
        bg.save(ROOT / "native" / "out" / "background.png")
        bg_formal.save(ROOT / "native" / "out" / "background_formal.png")
    print(f"{len(SPRITE_SET)} sprites, {total * 2 / 1024:.0f} KB of pixels → {OUT / 'photon_assets.c'}")


if __name__ == "__main__":
    main()
