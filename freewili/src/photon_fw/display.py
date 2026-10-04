"""Pixel UI: render_state(machine, now) → 320×240 image, plus the short text the FREE-WILi screen shows.

Palette: cream, mint, lavender, coral, yellow, dark navy outlines. Sprites are cut from the UI concept board
(tools/make_assets.py). Images can also be encoded as FREE-WILi .fwi (header + big-endian RGB565).
"""
from __future__ import annotations

import math
import struct
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .state_machine import Machine, S

W, H = 320, 240
CREAM = (252, 251, 241)
MINT = (205, 238, 224)
LAVENDER = (232, 224, 251)
CORAL = (240, 112, 122)
YELLOW = (248, 205, 79)
NAVY = (36, 40, 74)
MUTED = (110, 108, 140)
WORD = [("p", (134, 207, 160)), ("h", (147, 189, 233)), ("o", (248, 205, 79)), ("t", (243, 162, 168)), ("o", (184, 164, 227)), ("n", (139, 150, 212))]

ROOT = Path(__file__).resolve().parents[2]
SPRITES = ROOT / "assets" / "sprites"
FONT_PATHS = ["/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf", "/Library/Fonts/Arial Rounded Bold.ttf"]

SPRITE_FOR = {
    S.BOOT: "idle", S.IDLE: "idle", S.SEARCHING: "searching", S.MATCH_FOUND: "match", S.WAITING: "waiting",
    S.DOUBLE_YES: "double_yes", S.NAVIGATING: "navigating", S.FOUND: "found", S.OFFLINE: "offline", S.ERROR: "offline",
}

_fonts: dict[int, ImageFont.ImageFont] = {}
_sprites: dict[str, Image.Image] = {}


def font(size: int) -> ImageFont.ImageFont:
    if size not in _fonts:
        for p in FONT_PATHS:
            if Path(p).exists():
                _fonts[size] = ImageFont.truetype(p, size)
                break
        else:
            _fonts[size] = ImageFont.load_default(size)
    return _fonts[size]


def sprite(name: str, height: int) -> Image.Image:
    key = f"{name}@{height}"
    if key not in _sprites:
        im = Image.open(SPRITES / f"{name}.png").convert("RGBA")
        w = round(im.width * height / im.height)
        _sprites[key] = im.resize((w, height), Image.NEAREST)  # keep the pixels crisp
    return _sprites[key]


def first_name(m: Machine) -> str:
    return m.visible_person().get("firstName", "")


def caption(m: Machine) -> tuple[str, str]:
    """(title, subtitle) for a state. Uses names/zones only after a double yes."""
    c, p = m.ctx, m.visible_person()
    name, zone = p.get("firstName", ""), p.get("zone", "")
    if m.state == S.BOOT:
        return "photon", "people find people"
    if m.state == S.IDLE:
        if c.page == 1:
            return "my status", "open to meet" if c.open else "not discoverable"
        if c.page == 2:
            return "photon", "AI networking agent in your iMessage"
        return "ready to meet?", "text photon what you're looking for"
    if m.state == S.SEARCHING:
        return "looking...", "finding people for you"
    if m.state == S.MATCH_FOUND:
        return "match found!", f"“{c.reason}”" if c.reason else "someone nearby fits"
    if m.state == S.WAITING:
        return "waiting for them...", "no names until you both say yes"
    if m.state == S.DOUBLE_YES:
        return "double yes!", "it's a match"
    if m.state == S.NAVIGATING:
        cue = {0: "head over!", 1: "getting warmer...", 2: "they're close!"}.get(c.proximity, "head over!")
        return f"meet {name}", f"{zone} - {cue}" if zone else cue
    if m.state == S.FOUND:
        return f"you found {name}!", "say hi!"
    if m.state == S.OFFLINE:
        return "not discoverable", "hold GREEN to be open to meet"
    return "reconnecting...", c.error or "check the bridge"


def hints(m: Machine) -> list[tuple[tuple[int, int, int], str]]:
    if m.state == S.MATCH_FOUND:
        return [((60, 190, 110), "yes"), ((235, 80, 80), "no")]
    if m.state == S.IDLE:
        return [((248, 205, 79), "prev"), ((70, 150, 255), "next")]
    if m.state == S.FOUND:
        return [((60, 190, 110), "done")]
    return []


def render_state(m: Machine, now: float = 0.0) -> Image.Image:
    im = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(im)
    # soft mint → lavender gradient
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(round(MINT[i] * (1 - t) + LAVENDER[i] * t) for i in range(3)))
    _status_bar(d, m)

    title, sub = caption(m)
    if m.state == S.BOOT:
        _wordmark(d, 70, 54)
        sp = sprite("idle", 90)
        im.paste(sp, ((W - sp.width) // 2, 110), sp)
        _center(d, 206, sub, 14, MUTED)
        return im

    # sprite with a gentle bob (faster when something is happening)
    speed = {S.SEARCHING: 6, S.MATCH_FOUND: 8, S.DOUBLE_YES: 10, S.FOUND: 10}.get(m.state, 3)
    bob = 0 if m.state in (S.OFFLINE, S.ERROR) else round(3 * math.sin(now * speed))
    name = "nearby" if m.state == S.NAVIGATING and m.ctx.proximity >= 2 else SPRITE_FOR[m.state]
    sp = sprite(name, 112)
    im.paste(sp, ((W - sp.width) // 2, 30 + bob), sp)

    if m.state == S.NAVIGATING:
        _warmth(d, m.ctx.proximity)
    _center(d, 160, title, 22, NAVY, heart=m.state in (S.IDLE, S.MATCH_FOUND, S.DOUBLE_YES, S.FOUND))
    for i, line in enumerate(textwrap.wrap(sub, 36)[:2]):
        _center(d, 190 + i * 16, line, 13, MUTED)
    x = 8
    for col, label in hints(m):
        d.ellipse([x, H - 16, x + 10, H - 6], fill=col, outline=NAVY)
        d.text((x + 14, H - 18), label, font=font(11), fill=NAVY)
        x += 20 + d.textlength(label, font=font(11)) + 8
    return im


BOARD_MAX = 8  # the OG's show_text uses a huge font: about 8 characters fit on one line


def device_text(m: Machine) -> str:
    """One short word for the FREE-WILi screen (show_text). The full UI is the pixel mirror."""
    name = m.visible_person().get("firstName", "").upper()
    fit = lambda w, fallback: w if 0 < len(w) <= BOARD_MAX else fallback  # noqa: E731
    if m.state == S.IDLE:
        return ["READY?", "OPEN" if m.ctx.open else "CLOSED", "PHOTON"][m.ctx.page]
    if m.state == S.NAVIGATING:
        return fit(name, "GO!") if m.ctx.proximity < 2 else "CLOSE!"
    if m.state == S.FOUND:
        return fit(f"{name}!", "FOUND!")
    return {
        S.BOOT: "PHOTON", S.SEARCHING: "LOOKING", S.MATCH_FOUND: "MATCH!", S.WAITING: "WAITING",
        S.DOUBLE_YES: "YES YES!", S.OFFLINE: "OFFLINE", S.ERROR: "NO LINK",
    }[m.state]


# -- drawing helpers ----------------------------------------------------------------------------

def _center(d: ImageDraw.ImageDraw, y: int, text: str, size: int, fill, heart: bool = False) -> None:
    f = font(size)
    w = d.textlength(text, font=f)
    x = (W - w) / 2 - (8 if heart else 0)
    d.text((x, y), text, font=f, fill=fill)
    if heart:
        _heart(d, int(x + w + 6), y + size // 3, 10, CORAL)


def _heart(d: ImageDraw.ImageDraw, x: int, y: int, s: int, col) -> None:
    h = s // 2
    d.rectangle([x, y, x + h, y + h], fill=col)
    d.rectangle([x + h, y, x + s, y + h], fill=col)
    d.polygon([(x, y + h), (x + s, y + h), (x + h, y + s)], fill=col)


def _wordmark(d: ImageDraw.ImageDraw, x: int, y: int) -> None:
    for ch, col in WORD:
        d.text((x, y), ch, font=font(44), fill=col)
        x += d.textlength(ch, font=font(44))


def _status_bar(d: ImageDraw.ImageDraw, m: Machine) -> None:
    # signal bars (proximity while navigating), discoverable dot, battery
    level = m.ctx.proximity if m.state == S.NAVIGATING else 3
    for i in range(3):
        top = 14 - 4 * i
        d.rectangle([8 + i * 6, top, 11 + i * 6, 16], fill=NAVY if i < max(level, 1) else (190, 190, 205))
    d.ellipse([32, 7, 41, 16], fill=(60, 190, 110) if m.ctx.open else (170, 170, 185), outline=NAVY)
    d.rectangle([W - 30, 7, W - 10, 16], outline=NAVY, width=2)
    d.rectangle([W - 9, 10, W - 7, 13], fill=NAVY)
    d.rectangle([W - 27, 10, W - 14, 13], fill=NAVY)


def _warmth(d: ImageDraw.ImageDraw, level: int) -> None:
    """Three hearts filling up as the matched badge gets closer."""
    for i in range(3):
        _heart(d, W - 66 + i * 18, 40, 12, CORAL if i < level else (210, 205, 220))


# -- FREE-WILi image format -----------------------------------------------------------------------

def to_fwi(im: Image.Image) -> bytes:
    """FREE-WILi .fwi: b'FW01IMG\\0', frames=1, pixels, width, height, 4 pad bytes, then big-endian RGB565."""
    im = im.convert("RGB")
    if im.size != (W, H):
        im = im.resize((W, H))
    raw = im.tobytes()
    px = bytearray(W * H * 2)
    for i in range(W * H):
        r, g, b = raw[3 * i], raw[3 * i + 1], raw[3 * i + 2]
        v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
        px[2 * i], px[2 * i + 1] = v >> 8, v & 0xFF
    return b"FW01IMG\0" + struct.pack("<IIHH", 1, W * H, W, H) + b"\0" * 4 + bytes(px)


def from_fwi(data: bytes) -> Image.Image:
    if data[:8] != b"FW01IMG\0":
        raise ValueError("not a FREE-WILi image")
    _, n, w, h = struct.unpack("<IIHH", data[8:20])
    vals = struct.unpack(f">{w * h}H", data[24 : 24 + 2 * w * h])
    im = Image.new("RGB", (w, h))
    im.putdata([(((v >> 11) & 31) * 255 // 31, ((v >> 5) & 63) * 255 // 63, (v & 31) * 255 // 31) for v in vals])
    return im


class Mirror:
    """Live pixel-UI mirror on the laptop: writes mirror/screen.png + an auto-refreshing mirror/index.html."""

    def __init__(self, folder: str | Path) -> None:
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        (self.folder / "index.html").write_text(
            "<!doctype html><meta charset=utf-8><title>photon on FREE-WILi</title>"
            "<body style='margin:0;background:#24284a;display:grid;place-items:center;height:100vh'>"
            "<img id=s src=screen.png style='width:640px;image-rendering:pixelated;border-radius:18px;"
            "box-shadow:0 0 0 14px #111,0 20px 60px #0008'>"
            "<script>setInterval(()=>{s.src='screen.png?'+Date.now()},300)</script>"
        )

    def show(self, im: Image.Image) -> None:
        tmp = self.folder / "screen.tmp.png"
        im.save(tmp)
        tmp.replace(self.folder / "screen.png")


def compose(sprite_name: str, title: str, sub: str = "", hints_: list | None = None, bob: int = 0,
            heart: bool = False) -> Image.Image:
    """A free-form screen in the same style (used for the on-badge game's frames)."""
    im = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(round(MINT[i] * (1 - t) + LAVENDER[i] * t) for i in range(3)))
    x = 8
    for ch, col in WORD:  # small wordmark
        d.text((x, 4), ch, font=font(16), fill=col)
        x += d.textlength(ch, font=font(16))
    sp = sprite(sprite_name, 112)
    im.paste(sp, ((W - sp.width) // 2, 30 + bob), sp)
    _center(d, 160, title, 22, NAVY, heart=heart)
    for i, line in enumerate(textwrap.wrap(sub, 36)[:2]):
        _center(d, 190 + i * 16, line, 13, MUTED)
    x = 8
    for col, label in hints_ or []:
        d.ellipse([x, H - 16, x + 10, H - 6], fill=col, outline=NAVY)
        d.text((x + 14, H - 18), label, font=font(11), fill=NAVY)
        x += 20 + d.textlength(label, font=font(11)) + 8
    return im
