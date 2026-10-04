"""End card for the demo video: logo, tagline and three QR codes (GitHub, Devpost, live site), 1920x1080.

  .venv/bin/python tools/end_card.py --devpost https://devpost.com/software/...   → assets/end_card.png

QR codes are generated straight from the URLs (no QR-shortener redirect that can expire or show ads).
"""
import argparse
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw

import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from photon_fw.display import font  # noqa: E402  (Arial Rounded Bold, same as the badge)

W, H = 1920, 1080
MINT, LAVENDER = (214, 240, 228), (232, 226, 250)
NAVY, MUTED = (36, 40, 74), (104, 102, 136)
SPRITES = ROOT / "assets" / "sprites"


def gradient() -> Image.Image:
    im = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(round(MINT[i] * (1 - t) + LAVENDER[i] * t) for i in range(3)))
    return im


def qr(url: str, size: int) -> Image.Image:
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2, box_size=10)
    q.add_data(url)
    q.make(fit=True)
    img = q.make_image(fill_color=NAVY, back_color="white").convert("RGB")
    return img.resize((size, size), Image.NEAREST)


def sprite(name: str, height: int) -> Image.Image:
    sp = Image.open(SPRITES / f"{name}.png").convert("RGBA")
    sp = sp.crop(sp.getbbox())
    return sp.resize((round(sp.width * height / sp.height), height), Image.LANCZOS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--github", default="https://github.com/maiaPaperTowns/mutuals")
    ap.add_argument("--devpost", default="")
    ap.add_argument("--site", default="https://mutuals.tech")
    ap.add_argument("--out", default=str(ROOT / "assets" / "end_card.png"))
    args = ap.parse_args()

    im = gradient()
    d = ImageDraw.Draw(im)

    # logo + tagline
    logo = Image.open(SPRITES / "mutuals_word.png").convert("RGBA")
    logo = logo.resize((logo.width * 2, logo.height * 2), Image.NEAREST)
    im.paste(logo, ((W - logo.width) // 2, 70), logo)
    tag = "people find people"
    f = font(44)
    d.text(((W - d.textlength(tag, font=f)) / 2, 250), tag, font=f, fill=NAVY)

    # three QR cards
    cards = [("GitHub", "code + badge firmware", args.github), ("Devpost", "our story", args.devpost),
             ("Live site", "try it now", args.site)]
    card_w, card_h, qr_size, gap = 450, 540, 330, 80
    x0 = (W - (3 * card_w + 2 * gap)) // 2
    y0 = 340
    for i, (title, sub, url) in enumerate(cards):
        x = x0 + i * (card_w + gap)
        d.rounded_rectangle([x + 6, y0 + 10, x + card_w + 6, y0 + card_h + 10], 36, fill=(205, 205, 228))  # soft shadow
        d.rounded_rectangle([x, y0, x + card_w, y0 + card_h], 36, fill="white", outline=(214, 212, 236), width=3)
        qx, qy = x + (card_w - qr_size) // 2, y0 + 40
        if url:
            im.paste(qr(url, qr_size), (qx, qy))
        else:  # placeholder until the link is known
            d.rounded_rectangle([qx, qy, qx + qr_size, qy + qr_size], 20, outline=MUTED, width=4)
            ph = "link coming soon"
            d.text((qx + (qr_size - d.textlength(ph, font=font(28))) / 2, qy + qr_size / 2 - 16), ph, font=font(28), fill=MUTED)
        ft, fs, fu = font(46), font(28), font(21)
        d.text((x + (card_w - d.textlength(title, font=ft)) / 2, qy + qr_size + 28), title, font=ft, fill=NAVY)
        d.text((x + (card_w - d.textlength(sub, font=fs)) / 2, qy + qr_size + 86), sub, font=fs, fill=MUTED)
        short = url.replace("https://", "").replace("www.", "") if url else ""
        while short and d.textlength(short, font=fu) > card_w - 40:
            short = short[:-2] + "…" if not short.endswith("…") else short[:-2] + "…"
        if short:
            d.text((x + (card_w - d.textlength(short, font=fu)) / 2, qy + qr_size + 128), short, font=fu, fill=(130, 128, 160))

    # pups on the corners: the hand-drawn character
    left, right = sprite("lv3", 165), sprite("lv5", 165)
    im.paste(left, (28, H - left.height - 24), left)
    im.paste(right, (W - right.width - 28, H - right.height - 24), right)

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    im.save(args.out)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
