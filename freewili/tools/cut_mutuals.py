"""Cut the mutuals logo and the Lv 1-5 pups out of the design board (assets/source/mutuals-board.webp).

  .venv/bin/python tools/cut_mutuals.py   → assets/sprites/mutuals_word.png, lv1.png … lv5.png
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BOARD = ROOT / "assets" / "source" / "mutuals-board.webp"
OUT = ROOT / "assets" / "sprites"


def keyed(im: Image.Image, tol: int = 34) -> Image.Image:
    """Cream background → transparent (soft edge), cropped to the content."""
    im = im.convert("RGB")
    bg = im.getpixel((1, 1))
    out = Image.new("RGBA", im.size)
    px = []
    for p in im.getdata():
        d = max(abs(p[i] - bg[i]) for i in range(3))
        a = 0 if d < tol * 0.5 else 255 if d > tol else int(255 * (d - tol * 0.5) / (tol * 0.5))
        px.append((*p, a))
    out.putdata(px)
    return out.crop(out.getbbox())


def flood_keyed(im: Image.Image, tol: int = 30) -> Image.Image:
    """Background → transparent by flooding in from the edges, so cream fur inside the dark outline stays."""
    im = im.convert("RGB")
    w, h = im.size
    bg = im.getpixel((1, 1))
    src = im.load()
    out = im.convert("RGBA")
    dst = out.load()
    near = lambda p: max(abs(p[i] - bg[i]) for i in range(3)) < tol  # noqa: E731
    seen = bytearray(w * h)
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        if not (0 <= x < w and 0 <= y < h) or seen[y * w + x] or not near(src[x, y]):
            continue
        seen[y * w + x] = 1
        dst[x, y] = (0, 0, 0, 0)
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return out.crop(out.getbbox())


def split_columns(im: Image.Image, n: int) -> list[tuple[int, int]]:
    """Find the n widest runs of non-empty columns (sparkles merge into their pup)."""
    a = im.getchannel("A")
    w, h = im.size
    filled = [any(a.getpixel((x, y)) > 60 for y in range(h)) for x in range(w)]
    runs, start = [], None
    for x, f in enumerate(filled + [False]):
        if f and start is None:
            start = x
        elif not f and start is not None:
            runs.append([start, x]); start = None
    while len(runs) > n:  # merge the smallest run into its nearest neighbour
        i = min(range(len(runs)), key=lambda k: runs[k][1] - runs[k][0])
        j = i - 1 if i == len(runs) - 1 or (i > 0 and runs[i][0] - runs[i - 1][1] < runs[i + 1][0] - runs[i][1]) else i + 1
        lo, hi = sorted((i, j))
        runs[lo:hi + 1] = [[runs[lo][0], runs[hi][1]]]
    return [tuple(r) for r in runs]


def main() -> None:
    board = Image.open(BOARD)
    keyed(board.crop((44, 18, 456, 104))).save(OUT / "mutuals_word.png")
    pups = flood_keyed(board.crop((815, 728, 1290, 812)))
    for i, (x0, x1) in enumerate(split_columns(pups, 5), 1):
        part = pups.crop((x0, 0, x1, pups.height))
        part.crop(part.getbbox()).save(OUT / f"lv{i}.png")
    print("wrote mutuals_word.png, lv1-5.png")


if __name__ == "__main__":
    main()
