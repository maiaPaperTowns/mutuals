# Mutual Badge (FREE-WILi OG)

A FREE-WILi OG on the watch strap becomes Mutual's body in the room. The AI matches people (ASI:One), the
double yes happens in iMessage (Photon) **or on the badge**, and the badge proves the two people actually met.

| Moment | Badge |
|---|---|
| Intro arrives | LEDs pulse lavender, speaks "Someone nearby wants to meet", reason on screen (no names). **GREEN** = yes, **RED** = not now |
| Waiting | "You said yes! Waiting on them…" |
| Double yes | Both badges glow in the **pair's color**, speak "Double yes! Find Elena at the Workshop Zone" |
| **IR high-five** | Point the badges at each other. Each beams its code; the bridge only accepts **your match's** code (your own reflection doesn't count) → *met in person* is logged |
| Worth it? | Asked right after the high-five: **GREEN** / **RED** |
| Met | Rainbow LEDs, "Nice to meet you!" |
| Idle | Live scoreboard: intros · met · % worth it (real counts only) |

Target prize: **Best FREE-WILi + AI**. FREE-WILi parts used: 320×240 display, 5 buttons, 7 RGB LEDs, speaker
(text-to-speech), IR TX/RX.

## How it fits

```
ASI:One agent ──match──► Photon bridge (photon/) ──iMessage──► phones
                              ▲  GET /badge/<id>/state, POST answer / rate / ir
                              │
                    freewili/badge.py (this folder, one per badge, on the laptop)
                              │  OneWili API over USB
                              ▼
                        FREE-WILi OG badge
```

The bridge must be running (see `photon/README.md`). The badge talks to it on `http://localhost:8787`.

## Run without hardware (mock mode)

```bash
python3 badge.py --phone "+1 555 010 0001" --mock
```

The screen, LEDs and speech print to the terminal. Type `g` (GREEN) or `r` (RED). When matched, the mock prints
its IR code; type `ir <code>` in the *other* badge's terminal to simulate the high-five.

## Run on a FREE-WILi OG

1. Python **3.10+** (OneWili needs it; macOS ships 3.9): `brew install python@3.12`
2. Install OneWili, the official FREE-WILi API (the old `freewili` pip package is deprecated):
   ```bash
   git clone https://github.com/freewili/onewili && pip3 install -e onewili/python
   ```
3. Plug in the badge (USB-C) and run:
   ```bash
   python3.12 badge.py --phone "+1 555 010 0001"
   ```
   Two badges on one laptop: `python3 -c "import onewili; print([d.serial for d in onewili.find_devices()])"`,
   then pass `--serial <serial>` to each.

The phone must be the wearer's number (the same one added under Photon → Users).

### Tune on the device (first time)

Run with `--debug` to print raw events, then check:

- **Buttons:** `dev.gui.stream_io(100)` should emit `button` events (gray yellow green blue red, 1 = pressed).
  If not, try another rate value.
- **IR:** `dev.wireless.ir.enable_ir_stream(1)` → `irrx` events with the code in hex. Badges must face each other,
  about 0.5–2 m apart.
- **LEDs:** `set_led_color(i, r, g, b, duration, mode)`; `LED_DURATION` (units) is a guess, adjust in `FreeWili`.

## Bridge API used by the badge

| Call | What |
|---|---|
| `POST /badge/register {badge, phone}` | Links a badge to its wearer |
| `GET /badge/<badge>/state` | `{phase, reason, otherName?, otherZone?, color?, myIrCode?, stats}`. Names, zone, color and IR code appear only after a double yes |
| `POST /badge/<badge>/answer {yes}` | GREEN/RED on an intro |
| `POST /badge/<badge>/ir {code}` | A received IR code; counts only if it's the match's code |
| `POST /badge/<badge>/rate {worthIt}` | GREEN/RED on "worth it?" |
