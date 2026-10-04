# mutuals

**People find people.** A live map of who's open to meet at an event, plus a pocket-sized FREE-WILi badge
companion that tells you when someone is nearby, and when you've actually found them.

**Personal networking assistants before, during and after an event.**
Upload your resume, join an event, find your best matches and chat with your assistants on the website.
Discoverable participants show their names and areas; accepting a request establishes a connection.

![SpacetimeDB](https://img.shields.io/badge/live%20map-SpacetimeDB-6b4fbb)
![FREE-WILi](https://img.shields.io/badge/badge-FREE--WILi%20OG-e5484d)
![Clerk](https://img.shields.io/badge/accounts-Clerk-6c47ff)
![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

> Built at MHacks 2026.

## Current cloud deployment

The [profile page](https://mhacks-live-map.vercel.app/chat) and [events and assistants](https://mhacks-live-map.vercel.app/events) use Clerk login and native SpacetimeDB procedures/reducers. Terry's provisioned administrator account can publish invitations and lock the participant roster by starting an event. Pre compares the frozen members using Pinecone and stores complete personal interest lists, initially displayed five or ten at a time. During manages favorites, voluntary event GPS, nearby notifications and connection requests. Post prepares private follow-up drafts. Each assistant has its own policy, permitted tools and personal stage history; all chat calls the ASI:One API from SpacetimeDB.

The retained Photon/iMessage prototype is a separate integration path. Photon/Agentverse transport, recording and automatic outbound delivery remain unconnected to the website. Browser notifications require permission and an open page; durable notifications stay in the private website inbox. Follow-up drafts are copied and sent manually. See the [Chinese implementation and acceptance guide](docs/活动与站内助手实施说明.md) for the current data contracts, operating steps and verification scope. Older reports describe their original release only.

Completed changes must be committed, pushed and deployed to affected cloud targets under the standing instructions in [AGENTS.md](AGENTS.md).

## Fetch.ai Pre/Post agent

**mutuals Networking** (`agent1qt6xhqsn53g4fj4w35d45avhlzns79t6qujx2cupyqxjncyp96prc60nfsn`) exposes the existing native Pre/Post assistants through signed ACP and Agentverse Mailbox. Website users authorize a chat with a five-minute single-use code; permissions expire after 24 hours and can be revoked. Pre can save favorites, and Post can consult event roles and save private follow-up drafts. During continues on the website with GPS. The public ACP entry point is one Agent; the three native roles are not separately published agents.

See [setup, tests, demo and submission checklist](docs/FETCH_SUBMISSION.md). Agentverse connection and live ASI:One routing must be verified before private backend access is enabled. The local test suite alone does not prove discovery, a shared chat, or a submitted entry.

## The problem

There are about a thousand hackers in this building, and you'll talk to maybe five of them. The person who
already fixed your exact bug is probably two tables away. Event apps give you a directory nobody opens. mutuals
shows who's actually around and open to meet right now, and nudges you to go say hi.

## What it does

1. **Opt-in live map** (`map/`). Sign in, set a short profile (name, headline, interests), and turn on location
   sharing. You appear on a shared map of the venue; others see your dot and, if you allow it, your profile card.
   Turning sharing off removes your dot.
2. **A badge that finds people for you** (`freewili/`). The FREE-WILi OG runs the mutuals app: a pixel pup (or a
   clean formal look) on its screen, with sounds and LEDs.
   - Plugged into a laptop with the map open, it shows who's near you on the map, with their name and distance.
     Its YES / NO buttons turn your sharing on and off.
   - Badges also **find each other directly by radio** (433 MHz, no internet or GPS needed): "someone's nearby!",
     then "you found them!" when you're within a couple of metres.
3. **Points, levels and your connections.** +10 when someone new is nearby, +50 when you find them. Levels go
   Lv 1 → Lv 5 (at 50 / 100 / 200 / 400 pts), and your badge's pup grows up with you. Everyone you've found is
   listed by name on the website and on the badge (MENU → NEXT).
4. **Cute or Formal.** One switch restyles the website and the badge:
   - **Cute** for clubs and university mixers: pastel pixel pup, puppy noises.
   - **Formal** for recruiting events: white/navy icons, "Contact nearby" / "Connection made", Tier 1–5, soft chimes.

## How it works

```
 Badge (FREE-WILi OG)                       Laptop: Chrome / Edge                       Cloud
┌──────────────────────┐   USB (Web Serial) ┌───────────────────────────┐  WebSocket  ┌──────────────────┐
│ display CPU: screen,  │◄──────────────────►│ mutuals map (map/, React)  │◄──────────►│ SpacetimeDB       │
│ buttons, LEDs, sound  │  who's near, pts,  │ Leaflet map, points card,  │            │ live_location,    │
│        ▲ link         │  style ◄── buttons │ Cute/Formal, badge connect │            │ profiles (Clerk   │
│ main CPU: CC1101 radio│                    └───────────────────────────┘            │ sign-in)          │
└──────────▲───────────┘                                                              └──────────────────┘
           │ 433.92 MHz beacons (random id + first name while sharing; silent when hidden)
┌──────────▼───────────┐
│ another mutuals badge │
└──────────────────────┘
```

| Folder | What | Owner |
|---|---|---|
| [`map/`](map/) | The mutuals website: live OpenStreetMap of the Duderstadt Center on SpacetimeDB, Clerk accounts and profiles, badge connection, points and levels, Cute/Formal switch | Terry · Maia |
| [`freewili/`](freewili/) | The mutuals badge app for the FREE-WILi OG (native C, wiliOGbsp): screens, sounds, radio proximity, plus the setup guide for teammates | Maia · Elena |
| [`agents/`](agents/) | Python agents, private SpacetimeDB gateway and backend verification; the deployed website uses native SpacetimeDB procedures for profiles, events and assistants | Ziquan · Terry |
| `photon/` | Earlier iMessage-agent prototype (Photon Spectrum). Paused: not part of mutuals | Maia |

## Quick start

**Use it (teammates):** follow [freewili/TEAMMATE_SETUP.md](freewili/TEAMMATE_SETUP.md). Short version:

1. **Get the badge app.** Download it from the
   [mutuals-badge-v1 release](https://github.com/maiaPaperTowns/mutuals/releases/tag/mutuals-badge-v1) and flash
   it with FREE-WILi's [OG App Explorer](https://github.com/freewili/fwOGAppExplorer/releases/latest) (Windows) or the
   [FreeWili GUI](https://github.com/freewili/freewili-gui/releases).
2. **Open the map.** In Chrome, sign up and set your profile (tick *show on map*).
3. **Connect.** Click **Connect** in the badge box and press **YES** on the badge.

**Run the website locally:**

```bash
cd map
npm ci
npm run dev        # http://localhost:5173 (add ?demo in local preview for two pretend people walking up to you)
```

For the shared live map, create `map/.env.local` (see [map/README.md](map/README.md)):

```
VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DATABASE=mhacks-live-map
VITE_CLERK_PUBLISHABLE_KEY=pk_test_bm92ZWwtZ3JpZmZvbi05MDczLmNsZXJrLmFjY291bnRzLmRldiQ=
```

**Share your laptop's copy with the team** over https (needed for USB and location in other browsers):

```bash
cd map && npm run build && npx vite preview --port 4173
cloudflared tunnel --url http://localhost:4173      # prints a https://….trycloudflare.com link
```

**Build the badge app** (macOS/Linux): see [freewili/README.md](freewili/README.md):

```bash
cd freewili
native/setup_toolchain.sh      # once
native/build.sh                # → native/out/photon_main.uf2
```

The ASIone backend stores its six private data collections and matching presence in the same SpacetimeDB module as the map. Python services connect through a server-only TypeScript gateway. See [`agents/README.md`](agents/README.md) for schema-first deployment, environment setup, account linking, and JSON migration.

## Privacy, by design

- **Opt-in only.** Location sharing is off until you turn it on (YES on the badge or the website switch) and allow
  location in the browser. Turning it off (NO) deletes your dot. The map keeps only your latest position, never a
  history.
- **Profiles are yours.** Your profile card shows only while you're sharing and only if you ticked *show on map*.
  Email and passwords stay with Clerk, never in the database or on the map.
- **Radio is quiet when you are.** While you're not discoverable, your badge broadcasts nothing. While you're
  sharing, it broadcasts a random per-boot id and your first name, nothing else.
- **Points stay local.** Your points and connections list live in your browser and on your badge. Nothing is
  ranked or listed publicly.

## Built with

[SpacetimeDB](https://spacetimedb.com) · [Clerk](https://clerk.com) · React · TypeScript · Leaflet /
OpenStreetMap · [FREE-WILi OG](https://github.com/freewili) + [wiliOGbsp](https://github.com/freewili/wiliOGbsp) (C, Pico SDK) ·
Web Serial

## Team

Maia · Ziquan · Terry · Elena
