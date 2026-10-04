# mutuals on FREE-WILi

The mutuals badge: a pocket-sized networking companion on the FREE-WILi OG. It tells you when someone is nearby
(from the mutuals map, or directly by radio badge-to-badge) and when you've found them. It keeps your points and
level, and comes in a Cute (pixel pup) or Formal style. Teammates: start with
[TEAMMATE_SETUP.md](TEAMMATE_SETUP.md).

FREE-WILi parts used: the 320×240 display, 5 buttons, 7 RGB LEDs, the I2S speaker, both CC1101 sub-GHz radios, the
inter-CPU link, and USB (Web Serial to the website).

## Run it

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
- **Cute / Formal:** the website's switch sends `T C` / `T F`. Formal is white/navy line icons, professional
  wording, Tier 1–5 and soft chimes (recruiting events). Cute is the pixel pup (clubs, mixers).
- **Practice mode** (no website): quiet match prompts, YES to catch (+10). Practice pauses after 2 misses.
  Points sync both ways (the higher total wins).
- **Sounds** (`native/make_sounds.py`): chiptune effects + synthesized puppy noises, 8 kHz like the OG's I2S
  driver. A voice line is available (`SPEAK = True`).

**Buttons** (labels on the screen, right above each button):

| Button | Map mode (website connected) | Practice (no website) |
|---|---|---|
| **MENU** (gray) | stats: people met, matches, points, level, radio | same |
| **BACK** (yellow) | close stats | close stats |
| **YES** (green) | turn location sharing on | catch a match / say hi |
| **NEXT** (blue) | on stats: flip to your connections (names) | on stats: connections; otherwise the next practice match |
| **NO** (red) | turn sharing off (radio goes silent) | skip a match. Holding it 6 s powers the badge off |

**Code** (`native/`):

```
native/
  photon/display/main.c       display CPU: screens, text, points/levels, map link (USB), radio view, sounds, LEDs
  photon/main/main.c          main CPU: CC1101 beacons + listening, reports nearby badges over the inter-CPU link
  photon/common/mutuals_link.h  the beacon and inter-CPU message formats
  make_assets.py              screens: one background per style + pup sprites / formal icons + fonts → C arrays
  make_sounds.py              chiptune + puppy noises + formal chimes (8 kHz) → C arrays (+ .wav previews)
  build.sh / setup_toolchain.sh   fetch wiliOGbsp, build photon_main.uf2 (the app keeps its original target name)
../tools/cut_mutuals.py       cuts the logo and the Lv 1–5 pups out of assets/source/mutuals-board.webp
```

Build and flash (from `freewili/`):

```bash
native/setup_toolchain.sh                                    # once: Arm GCC + Pico SDK 2.3.0 + ninja
native/build.sh                                              # → native/out/photon_main.uf2
cd native/.bsp && ../../.venv/bin/python tools/fw.py flash photon_main   # over USB, no buttons
```

Or without a toolchain, using the released UF2
([mutuals-badge-v1](https://github.com/maiaPaperTowns/mhacks-2026/releases/tag/mutuals-badge-v1)):

- **Windows:** FREE-WILi's [OG App Explorer](https://github.com/freewili/fwOGAppExplorer/releases/latest).
  1. Put the UF2 in its `catalog` folder (the 📁 button opens it).
  2. Restart it, then select **mutuals** → **Flash**.
- **FreeWili GUI** ([releases](https://github.com/freewili/freewili-gui/releases)):
  1. Copy the UF2 into its catalog folder (Mac: `FreeWili GUI.app/Contents/MacOS/catalog/`).
  2. Setup → FreeWili OG updater → Apps → select it → **Flash** (scroll down in the right panel).

After a flash, the main CPU updates the screen CPU by itself (about 30 s). The standard firmware (Firmware →
Stable) brings back `main.py` / `pet_game.py`: the badge runs one or the other.

**Testing together** (each person: a laptop with Chrome + a badge running mutuals):
1. Open the live map: the shared `https://….trycloudflare.com` link, a deployed site, or `cd map && npm run dev`
   with `map/.env.local` (see [map/README.md](../map/README.md)).
2. Sign in, then **Profile**: your name, headline, and *show on map*. Your name is what the other badge shows.
3. Click **Connect** in the badge box and pick *FWOG display photon*. Press **YES** on the badge to share.
4. When you're near each other on the map: "someone's nearby!" (+10). Within 25 m: "you found them!" (+50).

Solo demo: `http://localhost:5173/?demo` in the local preview adds two pretend people who walk up to you.

## Earlier prototype: Photon companion (Python, paused)

Before mutuals, this folder drove the badge from a laptop with the official OG firmware (OneWili over USB): text,
LEDs and speech for the Photon iMessage agent. It's kept for reference. It needs the standard firmware
(GUI → Firmware → Stable), not the mutuals app.

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

**With the real backend** (the Photon bridge in `photon/` running on this laptop):

```bash
.venv/bin/python main.py --phone "+1 555 010 0001"            # the wearer's number (as in Photon → Users)
.venv/bin/python main.py --phone "+1 ..." --radio             # radio proximity: two badges, both running this
```

**Tests:** `.venv/bin/python -m unittest discover -s tests` (state machine, privacy, buttons, rendering, .fwi
encoding, proximity, transport against a mock bridge).

### Prototype setup (once)

The FREE-WILi OG must run the **official OG firmware v024+**. MHacks kits ship with a demo app ("wilidoro") that
ignores USB commands: FREE-WILi GUI → Setup → FreeWili OG updater → Firmware → Stable → *Update and verify*.

```bash
brew install uv                                   # Homebrew's python@3.12 is broken on macOS 26.2 (pyexpat)
git clone https://github.com/freewili/onewili ~/onewili
cd freewili && uv venv --python 3.12 .venv && uv pip install --python .venv -e ~/onewili/python pillow
.venv/bin/python tools/probe.py                   # text, LEDs, speech, buttons, IR → all Ok
.venv/bin/python tools/radio_probe.py             # radio packet calls → all Ok
```

### Prototype buttons

| Button | Short press | Long press (1 s) |
|---|---|---|
| GREEN | Select / **YES** to an intro | toggle **open to meet** |
| RED | **NO** / decline | go **offline** (not discoverable) |
| YELLOW / BLUE | previous / next page (idle) | |
| GRAY | back | |

A button that's already held when the badge starts is ignored until it's released, so a resting thumb or a stale
report can never trigger an action.

### Privacy: double consent in hardware

- Before a double yes the badge shows only the **reason** ("also working with SpacetimeDB"), never a name or zone.
  The state machine only stores `person` from a `double_yes` event and only reveals it in DOUBLE_YES / NAVIGATING /
  FOUND (`Machine.visible_person`). Tests check this.
- Radio proximity **starts only in NAVIGATING** (after a double yes). Both badges derive the same 8-byte token from
  the shared match id (`PH` + 6 bytes of SHA-256); that token is the *only* thing broadcast. No name, phone or
  persistent device id ever goes over the air.
- When the match ends (found, declined, offline) the match id and the token are wiped.
- Long-press RED (or the `offline` event): nothing is broadcast and intros are paused in the backend.

### Architecture

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

#### Event contract

Incoming: `searching`, `match_found {matchId, reason}`, `waiting`, `double_yes {matchId, person {firstName, zone}}`,
`meeting`, `offline`, `online`, `idle`. Outgoing: `accept_match {matchId}`, `decline_match {matchId}`,
`presence {open}`, `matched_device_detected {matchId}`.

`BridgeTransport` maps these onto the Photon bridge's badge API (`photon/src/index.ts`):
`GET /badge/<id>/state` (phases idle · searching · offer · waiting · matched · rate/met · offline) and
`POST /badge/<id>/answer | presence | found`. Only the first name crosses to the badge.

### Why Python on the laptop (not a C++/WASM app on the badge)

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

#### What we tried for pixel art on the badge screen

- `gui.show_fwi_image`: firmware answers *"file-backed images are not supported on FreeWili OG"*.
- Panels / picture / shape / text controls and message boxes: *Failed* on OG v024.
- A WASM app on the badge (built on a Mac with the clang + wasm-ld bundled in the FREE-WILi GUI): OG v024 apps
  use the single `ow_call` import (OneWili), not the old drawing imports Wili Pass used, so the same image limits apply.
- Built-in images (`gui.show_image_asset_by_id`, ids 0–39) do display, but they're FREE-WILi's own assets.

So in companion mode (OG firmware + `main.py`) the badge shows text, LEDs and voice, and the pixel UI lives on
the laptop mirror. To get the pixels onto the badge anyway, we wrote a **native display app** with wiliOGbsp
(`native/`, see Run it). It draws straight to the ST7789 and plays audio through the I2S speaker.

## Status

**mutuals badge app**

- ✅ Native app on the badge's own screen (wiliOGbsp): Cute and Formal styles, points / levels / stats, sounds,
  LEDs, practice mode.
- ✅ Map mode over Web Serial: synced with the website (who's near, sharing on/off with YES/NO, points both ways,
  style).
- ✅ Badge-to-badge radio proximity (CC1101, 433.92 MHz): runs on hardware. Two-badge "you found them" distance
  (`RADIO_CLOSE_DBM = -50`) still needs calibrating with real readings.
- ✅ Flashed and running on two badges (Mac via `fw.py`, Windows via the OG App Explorer).

**Earlier Python prototype (paused)**

- ✅ Photon Pup mini-game: Python version (badge face + LED meters + voice, pixel mirror; tests).
- ✅ State machine, event contract, privacy rules, buttons (short/long, stuck-button guard), LEDs, speech, pixel UI +
  mirror, .fwi export, bridge + mock transports, mock server, one-command demo: built and tested (34 tests).
- ✅ On hardware: text, LEDs, speech, buttons, IR, radio calls.
- ⏳ Token-based radio proximity in Python: implemented, superseded by the native app's radio.
