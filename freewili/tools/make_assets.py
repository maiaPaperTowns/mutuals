"""Cut the state sprites out of the UI concept board → assets/sprites/<state>.png (transparent background).

  python3 tools/make_assets.py
"""
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BOARD = ROOT / "assets/source/ui-concept-board.png"
OUT = ROOT / "assets/sprites"

# (left, top, right, bottom) on the 1536×1024 board, one per UI state.
BOXES = {
    "idle": (466, 254, 618, 358),
    "searching": (676, 236, 838, 352),
    "match": (888, 222, 1040, 348),
    "waiting": (1098, 222, 1252, 345),
    "double_yes": (1298, 228, 1474, 348),
    "navigating": (462, 490, 612, 598),
    "nearby": (658, 494, 838, 606),
    "found": (878, 494, 1048, 602),
    "offline": (1100, 505, 1240, 612),
}


def knock_out(im: Image.Image, step: int = 14) -> Image.Image:
    """Make the soft gradient background transparent: grow from the border while colors change gently."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque((x, y) for x in range(w) for y in (0, h - 1))
    q.extend((x, y) for y in range(h) for x in (0, w - 1))
    for x, y in q:
        seen[y * w + x] = 1
    light = lambda c: sum(c[:3]) > 600  # background is pale; outlines and fur shading are darker  # noqa: E731
    while q:
        x, y = q.popleft()
        c = px[x, y]
        if not light(c):
            continue
        px[x, y] = (c[0], c[1], c[2], 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                n = px[nx, ny]
                if light(n) and sum(abs(n[i] - c[i]) for i in range(3)) <= step:
                    seen[ny * w + nx] = 1
                    q.append((nx, ny))
    return im


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    board = Image.open(BOARD).convert("RGB")
    for name, box in BOXES.items():
        knock_out(board.crop(box)).save(OUT / f"{name}.png")
    print(f"wrote {len(BOXES)} sprites to {OUT}")


if __name__ == "__main__":
    main()
