# mutuals badge: setup for a teammate

You need: a **FREE-WILi OG** badge + its USB-C cable, a **laptop** (Mac or Windows) with **Google Chrome**, and access
to the GitHub repo `maiaPaperTowns/mhacks-2026` (ask Maia to add you as a collaborator if links 404).

## 1. Install the FREE-WILi GUI (once)

Get **FreeWili GUI** from the FREE-WILi website or the MHacks kit instructions (it's the same app Maia uses; she can
AirDrop it too). Unzip it and open it. On a Mac, if it says it can't be opened: right-click it → **Open** → **Open**.

## 2. Put the mutuals app on your badge

1. Download **mutuals.uf2** from
   <https://github.com/maiaPaperTowns/mhacks-2026/releases/tag/mutuals-badge-v1>.
2. Put it in the GUI's **catalog** folder:
   - **Mac:** in Finder, right-click **FreeWili GUI.app** → **Show Package Contents** → open `Contents` → `MacOS` →
     `catalog`, and drop `mutuals.uf2` in there.
   - **Windows:** the `catalog` folder inside the FREE-WILi GUI's install folder.
3. Plug the badge into the laptop with USB-C and switch it on.
4. In the GUI: **Setup** → **FreeWili OG updater** → wait until **Device** shows your FREE-WILi → **Apps** tab.
5. Click **mutuals** in the list (it may say *[Unlisted]*, that's fine). **Scroll down in the right-hand panel**
   and click **Flash**. Don't drag the file onto the GUI.
6. When it finishes, wait **about 30 seconds**: the badge updates its screen by itself. You'll see the pastel
   **mutuals** logo and a puppy, and hear a little yip.

If the GUI shows two "RPI-RP2" drives or the badge seems stuck: unplug it, wait 3 s, plug it back in, and retry.

## 3. Open the mutuals map

**Option A: the shared link.** Open the link Maia sends (it looks like `https://….trycloudflare.com`) in
**Chrome**. Skip to step 4.

**Option B: run it on your laptop.** Needs [Node.js 20.19+](https://nodejs.org) and git.

```bash
git clone https://github.com/maiaPaperTowns/mhacks-2026.git
cd mhacks-2026/map
npm ci
```

Create a file `map/.env.local` with these three lines (the Clerk key is a public key):

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

1. Close the FREE-WILi GUI first: only one app can use the badge at a time.
2. In the white card on the left, find the 🐶 **mutuals FREE-WILi badge** box and click **Connect**.
3. Chrome lists **FWOG display photon 001**. Select it, then click **Connect**.
4. The box says **mutuals badge connected**. The badge shows a sleeping pup: **not discoverable**.

## 6. Use it

| Button (labels are on the screen, above each button) | What it does |
|---|---|
| **YES** (green) | Share your location: you appear on the map. Chrome asks for location: click **Allow**. |
| **NO** (red) | Stop sharing: you disappear from the map (tap it; holding NO for 6 s turns the badge off). |
| **MENU** (gray) | Your stats: people met, matches caught, points, level. |
| **BACK** (yellow) | Close stats. |
| **NEXT** (blue) | Practice mode only: call the next practice match. |

What the badge shows:

- **looking...**: you're on the map, nobody near yet.
- **someone's nearby!**: someone is within 150 m on the map, with their name and distance. +10 pts the first time.
- **you found them!**: they're within 25 m. +50 pts the first time.
- **level up!**: Lv 1 → 2 → 3 → 4 → 5 at 50 / 100 / 200 / 400 pts. Your home-screen pup grows up.

Your points show on the badge and on the website's points card. They're saved in this browser.

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

- **Chrome says "No compatible devices found":** the badge is still restarting after a flash. Wait 30 s, or unplug
  and replug it, then click Connect again.
- **"Couldn't open the badge":** the FREE-WILi GUI or another tab is using it. Close them and retry.
- **No Connect box on the website:** use Chrome or Edge on a laptop. Safari and phones can't talk to USB devices.
- **The map says Local preview:** `map/.env.local` is missing or wrong (Option B). Check the three lines and restart
  `npm run dev`.
- **The badge never left the old screen:** flash again (step 2) and wait the full 30 s afterwards.
