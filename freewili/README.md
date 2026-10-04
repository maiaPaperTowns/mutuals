# Photon on FREE-WILi

The physical companion for Photon, the AI networking agent in your iMessage. A tiny pixel mascot shows what your
agent is doing (looking, match found, waiting, double yes) and, only after **both** people say yes, helps you find
each other in the room with radio proximity: *getting warmer… they're close! you found them!*

Target prize: **Best FREE-WILi + AI**. FREE-WILi parts used: display, 5 buttons, 7 RGB LEDs, speaker
(text-to-speech), CC1101 sub-GHz radio (proximity), plus the Photon backend over USB.

## Run it

**60-second demo, works with no network** (real badge if plugged in, otherwise terminal mock):

```bash
cd freewili
.venv/bin/python mock/demo_sequence.py          # press GREEN on the badge when "match found!" appears
open mirror/index.html                          # live pixel UI next to the badge
```

`0 s IDLE → 2 s SEARCHING → 5 s MATCH FOUND → (GREEN) WAITING → DOUBLE YES → NAVIGATING (getting warmer… they're
close!) → YOU FOUND TERRY! Zone B`. Without hardware: `python3 mock/demo_sequence.py --mock` and type `a` for YES.

**Photon Pup mini-game** (a networking Tamagotchi):

```bash
.venv/bin/python pet_game.py        # badge: animated face + LED meters + voice; laptop: pixel pup (mirror/index.html)
```

Catch match prompts with GREEN for a double yes (+1 social, score spoken), YELLOW = coffee, BLUE = nap,
GRAY = quit. Social fades when you miss matches; LEDs show social (pink) and energy (green).

**mutuals badge app: the pup on the badge's own screen, synced with the mutuals map website.**
OG firmware can't show images over USB, so this is a real display-CPU app built with FREE-WILi's
[wiliOGbsp](https://github.com/freewili/wiliOGbsp) (`native/`).

- **Screen:** the mutuals logo, the pup, a title, ★ points · Lv · progress bar, and MENU BACK YES NEXT NO
  labels right above the five buttons. Your home-screen pup grows up with your level (Lv 1–5, from the design board).
- **Map mode:** the website (`map/`, Chrome or Edge) connects over USB with Web Serial.
  - The badge shows whether you're discoverable, who's near you on the map (name + distance) and "you found them!".
  - YES / NO turn location sharing on / off.
  - Points: +10 when someone new is nearby, +50 when you find them. Levels at 50 / 100 / 200 / 400. MENU = stats.
- **Radio** (no website needed): badges beacon to each other on the main CPU's CC1101 (433.92 MHz). That gives
  "someone's nearby!" with their name, and "you found them!" when the signal is strong (> -50 dBm, tune
  `RADIO_CLOSE_DBM`). +10 / +50 pts per new badge. Not discoverable = no beacon. MENU shows the radio status.
- **Practice mode** (no website): quiet match prompts, YES to catch (+10). Practice pauses after 2 misses.
  Points sync both ways (the higher total wins).
- **Sounds** (`native/make_sounds.py`): chiptune effects + synthesized puppy noises, 8 kHz like the OG's I2S
  driver. A voice line is available (`SPEAK = True`).

Build and flash (from `freewili/`):

```bash
native/setup_toolchain.sh                                    # once: Arm GCC + Pico SDK 2.3.0 + ninja
native/build.sh                                              # → native/out/photon_main.uf2
cd native/.bsp && ../../.venv/bin/python tools/fw.py flash photon_main   # over USB, no buttons
```

Or with the FREE-WILi GUI:
1. Copy the UF2 into `FreeWili GUI.app/Contents/MacOS/catalog/`.
2. Setup → FreeWili OG updater → Apps → select it → **Flash** (scroll down in the right panel).

After a flash, the main CPU updates the screen CPU by itself (about 30 s). The standard firmware (Firmware →
Stable) brings back `main.py` / `pet_game.py`: the badge runs one or the other.

**Testing together** (each person: a laptop with Chrome + a badge running mutuals):
1. Open the live map, either the deployed site or `cd map && npm run dev`. It needs `map/.env.local` with
   `VITE_SPACETIMEDB_URI`, `VITE_SPACETIMEDB_DATABASE` and the public `VITE_CLERK_PUBLISHABLE_KEY`.
2. Sign in, then **Profile**: your name, headline, and *show on map*. Your name is what the other badge shows.
3. Click **Connect** in the badge box and pick *FWOG display photon*. Press **YES** on the badge to share.
4. When you're near each other on the map: "someone's nearby!" (+10). Within 25 m: "you found them!" (+50).

Solo demo: `http://localhost:5173/?demo` in the local preview adds two pretend people who walk up to you.

**With the real backend** (the Photon bridge in `photon/` running on this laptop):

```bash
.venv/bin/python main.py --phone "+1 555 010 0001"            # the wearer's number (as in Photon → Users)
.venv/bin/python main.py --phone "+1 ..." --radio             # radio proximity: two badges, both running this
```

**Tests:** `.venv/bin/python -m unittest discover -s tests` (state machine, privacy, buttons, rendering, .fwi
encoding, proximity, transport against a mock bridge).

## Setup (once)

The FREE-WILi OG must run the **official OG firmware v024+**. MHacks kits ship with a demo app ("wilidoro") that
ignores USB commands: FREE-WILi GUI → Setup → FreeWili OG updater → Firmware → Stable → *Update and verify*.

```bash
brew install uv                                   # Homebrew's python@3.12 is broken on macOS 26.2 (pyexpat)
git clone https://github.com/freewili/onewili ~/onewili
cd freewili && uv venv --python 3.12 .venv && uv pip install --python .venv -e ~/onewili/python pillow
.venv/bin/python tools/probe.py                   # text, LEDs, speech, buttons, IR → all Ok
.venv/bin/python tools/radio_probe.py             # radio packet calls → all Ok
```

## Buttons

| Button | Short press | Long press (1 s) |
|---|---|---|
| GREEN | Select / **YES** to an intro | toggle **open to meet** |
| RED | **NO** / decline | go **offline** (not discoverable) |
| YELLOW / BLUE | previous / next page (idle) | |
| GRAY | back | |

A button that's already held when the badge starts is ignored until it's released, so a resting thumb or a stale
report can never trigger an action.

## Privacy: double consent in hardware

- Before a double yes the badge shows only the **reason** ("also working with SpacetimeDB"), never a name or zone.
  The state machine only stores `person` from a `double_yes` event and only reveals it in DOUBLE_YES / NAVIGATING /
  FOUND (`Machine.visible_person`). Tests check this.
- Radio proximity **starts only in NAVIGATING** (after a double yes). Both badges derive the same 8-byte token from
  the shared match id (`PH` + 6 bytes of SHA-256); that token is the *only* thing broadcast. No name, phone or
  persistent device id ever goes over the air.
- When the match ends (found, declined, offline) the match id and the token are wiped.
- Long-press RED (or the `offline` event): nothing is broadcast and intros are paused in the backend.

## Architecture

```
freewili/
  main.py                    real badge + Photon bridge
  src/photon_fw/
    events.py                the JSON event contract (below)
    state_machine.py         BOOT IDLE SEARCHING MATCH_FOUND WAITING DOUBLE_YES NAVIGATING FOUND OFFLINE ERROR
    input.py                 button reports → short / long presses
    display.py               render_state() → 320×240 pixel UI (Pillow), .fwi encoder, device text, laptop mirror
    leds.py                  LED pattern per state; warmer = more active
    proximity.py             ephemeral token, RadioProximity (CC1101 packets + RSSI), MockProximity
    transport.py             BridgeTransport (Photon bridge), MockTransport (offline)
    device.py                FREE-WILi over USB (OneWili) + MockDevice
    app.py                   wires it together, ~10 Hz loop
  mock/demo_sequence.py      one-command 60 s demo
  mock/mock_server.py        fake bridge for offline testing
  assets/sprites/            state sprites cut from assets/source/ui-concept-board.png (tools/make_assets.py)
  tools/                     hardware probes, asset cutter
```

```
IDLE ─searching→ SEARCHING ─match_found→ MATCH_FOUND ─GREEN→ WAITING ─double_yes→ DOUBLE_YES ─3 s→ NAVIGATING
NAVIGATING ─matched device detected / meeting→ FOUND ─15 s / GREEN→ IDLE        MATCH_FOUND ─RED→ IDLE
any ─offline / long RED→ OFFLINE ─online / long GREEN→ IDLE        transport down → ERROR → next event resumes
```

### Event contract

Incoming: `searching`, `match_found {matchId, reason}`, `waiting`, `double_yes {matchId, person {firstName, zone}}`,
`meeting`, `offline`, `online`, `idle`. Outgoing: `accept_match {matchId}`, `decline_match {matchId}`,
`presence {open}`, `matched_device_detected {matchId}`.

`BridgeTransport` maps these onto the Photon bridge's badge API (`photon/src/index.ts`):
`GET /badge/<id>/state` (phases idle · searching · offer · waiting · matched · rate/met · offline) and
`POST /badge/<id>/answer | presence | found`. Only the first name crosses to the badge.

## Why Python on the laptop (not a C++/WASM app on the badge)

We studied the reference projects:

- **Wili Pass** (GrizzHacks 7 FREE-WILi winner) is a C++ app compiled to WASM and run on the badge
  (`application.cpp`, `fwwasm.h`). It shows `.fwi` images with `addPanel` + `addControlPictureFromFile` and does
  proximity by sending `.sub` radio files and treating any RSSI > -80 dBm as "nearby".
- **Wattson** (MHacks 2025 Best Use of FREE-WILi) drove the badge from Python and pushed Pillow-rendered images.

What we verified on our OG (firmware v024, OneWili API over USB, macOS):

| Works | Doesn't (OG, over USB) |
|---|---|
| `gui.show_text`, `gui.set_led_color`, `io.audio.speak`, button stream, IR send/receive | `gui.show_fwi_image` (NotSupported on OG), `gui.panels` / picture controls (Failed), `gui.screenshot` |
| file upload (a 320×240 image in 1.5 s), `wireless.radio.packet_send / packet_rx / packet_read` (+RSSI) | the WASM C toolchain (`wiliclang`) ships for Windows only |

So: **Python + OneWili on the laptop** is the path that works today on a Mac, keeps the hardware code testable,
and talks to the Photon backend directly. The badge shows **text, LEDs and speech**; the full **pixel UI** is
rendered with Pillow (`display.render_state`) and mirrored live on the laptop (`mirror/index.html`). We also encode
real `.fwi` files (24-byte `FW01IMG` header + big-endian RGB565, verified against Wili Pass's assets), so the same
renders can go on-screen as soon as image display is available (a WASM app or a FREE-WILi 2).

Proximity differs from Wili Pass on purpose: only packets carrying **our match's ephemeral token** count (a strong
signal from anyone else is ignored), and RSSI is smoothed into FAR / NEAR / FOUND. `proximity.classify` is the single
place to swap in better ranging later. Thresholds (`FOUND_DBM = -45`, `NEAR_DBM = -70`) need a quick calibration
with two badges; one badge alone can't hear itself.

### What we tried for pixel art on the badge screen

- `gui.show_fwi_image`: firmware answers *"file-backed images are not supported on FreeWili OG"*.
- Panels / picture / shape / text controls and message boxes: *Failed* on OG v024.
- A WASM app on the badge (built on a Mac with the clang + wasm-ld bundled in the FREE-WILi GUI): OG v024 apps
  use the single `ow_call` import (OneWili), not the old drawing imports Wili Pass used, so the same image limits apply.
- Built-in images (`gui.show_image_asset_by_id`, ids 0–39) do display, but they're FREE-WILi's own assets.

So in companion mode (OG firmware + `main.py`) the badge shows text, LEDs and voice, and the pixel UI lives on
the laptop mirror. To get the pixels onto the badge anyway, we wrote a **native display app** with wiliOGbsp
(`native/`, see Run it). It draws straight to the ST7789 and plays audio through the I2S speaker.

## Status

- ✅ Photon Pup mini-game: Python version (badge face + LED meters + voice, pixel mirror; tests).
- ✅ State machine, event contract, privacy rules, buttons (short/long, stuck-button guard), LEDs, speech, pixel UI +
  mirror, .fwi export, bridge + mock transports, mock server, one-command demo: built and tested (34 tests).
- ✅ On hardware: text, LEDs, speech, buttons, IR, radio calls.
- ⏳ Radio proximity between **two** badges: implemented, calibration pending a second kit (the demo simulates it).
- ✅ Pixel UI on the badge screen itself: native Photon Pup app (`native/`), with sounds, puppy noises and voice.
