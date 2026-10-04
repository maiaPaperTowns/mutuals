# mutuals badge: setup for a teammate

You need: a **FREE-WILi OG** badge + its USB-C cable, a **laptop** (Windows or Mac) with **Google Chrome** (or
Microsoft Edge), and access to the GitHub repo `maiaPaperTowns/mhacks-2026` (ask Maia to add you as a collaborator if
links 404).

**On Windows:** everything works the same. You don't need Node, git or any drivers: the website is a link, and
Windows 10/11 recognises the badge's USB ports by itself.

## 1. Get a flashing app (once)

**Windows (easiest): FreeWili OG App Explorer.** This is FREE-WILi's official one-file app for loading apps onto
the OG badge.

1. Download **FwOGExplorerV2.zip**:
   <https://github.com/freewili/fwOGAppExplorer/releases/download/v2.0.0/FwOGExplorerV2.zip>
2. Unzip it and run **fwOGExp.exe**. There's nothing to install. If SmartScreen warns: **More info** → **Run anyway**.

**Or the full FreeWili GUI** (what Maia uses):

- Windows: <https://github.com/freewili/freewili-gui/releases/download/v0.4.0/fwcom-0.4.0.zip>
- Mac (Apple Silicon, macOS 26+): <https://github.com/freewili/freewili-gui/releases/tag/v0.4.2>
- All versions: <https://github.com/freewili/freewili-gui/releases>

## 2. Put the mutuals app on your badge

1. Download **mutuals.uf2** from
   <https://github.com/maiaPaperTowns/mhacks-2026/releases/tag/mutuals-badge-v1>.
2. Plug the badge into the laptop with USB-C and switch it on.

**With the App Explorer (Windows):**

3. Copy `mutuals.uf2` into the **`catalog`** folder next to `fwOGExp.exe` (from the zip), then start (or restart)
   `fwOGExp.exe`. **mutuals** appears in the **App Explorer** tab.
4. Select **mutuals** → **Flash**. The app finds the board and writes to the right chip by itself.
5. If the screen stays dark after flashing, the board is missing FREE-WILi's OG display bootloader. Fix it once: go to
   the **OG Bootloader Installer** tab → **Install FreeWili OG Bootloader**, then flash **mutuals** again.

**With the FreeWili GUI:**

3. Put `mutuals.uf2` in the GUI's **catalog** folder:
   - **Windows:** **Setup** → **FreeWili OG updater** → **Apps** tab → click the **folder button** (📁, next to
     *Online Update*). It opens the catalog folder. Copy the file in, then close and reopen the updater.
   - **Mac:** right-click **FreeWili GUI.app** → **Show Package Contents** → `Contents` → `MacOS` → `catalog`.
4. **Setup** → **FreeWili OG updater** → wait until **Device** shows your FREE-WILi → **Apps** tab.
5. Click **mutuals** (it may say *[Unlisted]*, that's fine). **Scroll down in the right-hand panel** and click
   **Flash**. Don't drag the file onto the GUI.

Either way: when it finishes, wait **about 30 seconds**: the badge updates its screen by itself. You'll see the
**mutuals** logo and a puppy, and hear a little yip.

If the badge seems stuck, or the computer shows two "RPI-RP2" drives: unplug it, wait 3 s, plug it back in, and
retry.

## 3. Open the mutuals map

**Option A: the shared link.** Open the link Maia sends (it looks like `https://….trycloudflare.com`) in
**Chrome**. Skip to step 4.

**Option B: run it on your laptop.** Only if the shared link isn't available. Needs [Node.js 20.19+](https://nodejs.org)
and git (on Windows, run these in **PowerShell**).

```bash
git clone https://github.com/maiaPaperTowns/mhacks-2026.git
cd mhacks-2026/map
npm ci
```

Create a file `map/.env.local` with these three lines (the Clerk key is a public key). On Windows, in Notepad
choose *Save as type: All files* so it isn't saved as `.env.local.txt`.

```
VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DATABASE=mhacks-live-map
VITE_CLERK_PUBLISHABLE_KEY=pk_test_bm92ZWwtZ3JpZmZvbi05MDczLmNsZXJrLmFjY291bnRzLmRldiQ=
```

```bash
npm run dev
```

Open **http://localhost:5173** in **Chrome**. The top right should say **Live sync**, not *Local preview*.

## 4. Sign in and set your profile

1. Click **Sign up / Log in** and make an account.
2. Click **Profile**:
   - Fill in your **name** (this is what other people's badges show when you're near them), a headline and
     interests.
   - Tick **show on map**, then save.

## 5. Connect your badge

1. Close the App Explorer / FREE-WILi GUI first: only one app can use the badge at a time.
2. In the white card on the left, find the 🐶 **mutuals FREE-WILi badge** box and click **Connect**.
3. Chrome lists **FWOG display mutuals 002** (on Windows it may add a port like *COM5*). Select it, then click
   **Connect**. If you see two FWOG entries, pick the one that says **display**.
4. The box says **mutuals badge connected**. The badge shows a sleeping pup: **not discoverable** (Formal style:
   a lock, **Private mode**). That just means you're not sharing yet.

## 6. Use it

| Button (labels are on the screen, above each button) | What it does |
|---|---|
| **YES** (green) | Share your location: you appear on the map. **You must be signed in** (step 4), or YES just opens the sign-in box. Chrome asks for location: click **Allow**. |
| **NO** (red) | Stop sharing: you disappear from the map and your badge stops broadcasting on radio (tap it; holding NO for 6 s turns the badge off). |
| **MENU** (gray) | Your stats: people met, matches caught, points, level, radio status. |
| **BACK** (yellow) | Close stats. |
| **NEXT** (blue) | On the stats screen: flip to **your connections** (names of the people you've met). In practice mode: call the next practice match. |

The badge reacts as soon as you press (for example "turning on sharing..."), and the website's badge box shows a
blue **"YES pressed on the badge → …"** line saying what happened. If YES doesn't turn sharing on, read that line:
it tells you whether you need to sign in or allow location.

Every button press clicks and shows a short message on the badge right away (for example "request sent!", "already
hidden", "MENU for stats"), so you always know it registered. On the stats screen, NEXT flips pages and any other
button closes it. In practice mode, any button skips the "it's mutual" / "too slow" screen.

What the badge shows (Cute wording; Formal in brackets):

- **looking...** [Searching nearby]: you're on the map, nobody near yet.
- **someone's nearby!** [Contact nearby]: someone is within 150 m on the map, with their name and distance.
  +10 pts the first time.
- **you found them!** [Connection made]: they're within 25 m. +50 pts the first time.
- **level up!** [Tier up]: Lv 1 → 2 → 3 → 4 → 5 at 50 / 100 / 200 / 400 pts. Your home-screen pup grows up.

Your points show on the badge and on the website's points card. **Your connections** (everyone you found, on the map
or by radio) are listed under the points card on the website, and on the badge under MENU → NEXT. Both are saved in
this browser.

## At an event (Events page)

The badge also works on the website's **Events & assistants** page during an event (the *During* stage). It connects
again on its own when you change pages, once you've connected it once. A badge box sits in the bottom-right corner:

- **AI nearby alert** (someone the AI picked for you is close and free): **someone's nearby!** with their name,
  distance and the AI's talking points. **YES** sends them a connection request, **NO** dismisses.
- **Someone wants to connect:** **"Alex wants to meet!"** with the AI's reason. **YES** accepts, **NO** declines.
- **Accepted:** **you found them!**, +50 pts, and they're added to your connections.

## Cute or Formal

Use the **✿ Cute | Formal** switch at the top of the website. It changes the website **and** the connected badge:

- **Cute** (clubs, university mixers): the pastel pixel pup, puppy noises, Lv 1–5.
- **Formal** (recruiting events): a clean white and navy look with simple icons instead of the pup, wording like
  "Contact nearby" and "Connection made", Tier 1–5 (Newcomer → Ambassador), and soft chimes.

## Badge-to-badge radio (no website needed)

Badges also find each other **directly over radio** (433.92 MHz). The OG has no Bluetooth, so this uses its sub-GHz
radio chip. It works without the website, GPS or Wi-Fi:

- Another mutuals badge in range → **someone's nearby!** with their first name (if they're signed in on the website)
  and the signal strength. **+10 pts** the first time.
- Very strong signal (badges within a couple of metres) → **you found them!** **+50 pts** the first time.
- Press **MENU** and look at **Radio**: *on · N badges near* means it's working.
- **NO** (not discoverable) makes your badge **stop broadcasting** completely.

## Without the website

Unplug the badge or close the tab: after 5 s it switches to **practice mode**. Quiet match prompts pop up; press
**YES** in time to catch them (+10 pts each). After 2 misses it waits for you; press **NEXT** for a match. Practice
points sync to the website the next time you connect.

## Testing together

- Both of you: steps 2–5 on your own laptop and badge, signed in with your own accounts, profiles set to **show on map**.
- Press **YES** on both badges. When you're near each other, both badges say **someone's nearby!** with the other
  person's name, then **you found them!** when you're close.
- Laptops guess location from Wi-Fi, so in the same room you'll usually jump straight to *you found them!*. To see
  it count down, one person can also open the map on their **phone** (same account), share location there, and walk
  toward the other badge.

## Troubleshooting

- **Windows: the badge doesn't show up anywhere:** try another USB-C cable (some only charge) and another USB
  port. In Device Manager → *Ports (COM & LPT)* you should see two USB serial devices while the badge is on.
- **Chrome lists "FWOG display photon 001" instead of mutuals:** that badge has an older build. It still works,
  but flash the latest mutuals.uf2 (step 2) to get all the features.
- **Chrome says "No compatible devices found":** the badge is still restarting after a flash. Wait 30 s, or unplug
  and replug it, then click Connect again.
- **"Couldn't open the badge":** the FREE-WILi GUI or another tab is using it. Close them and retry.
- **No Connect box on the website:** use Chrome or Edge on a laptop. Safari and phones can't talk to USB devices.
- **The map says Local preview:** `map/.env.local` is missing or wrong (Option B). Check the three lines and restart
  `npm run dev`.
- **The badge never left the old screen:** flash again (step 2) and wait the full 30 s afterwards.
