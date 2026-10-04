# mutuals

**People find people.** A live map of who's open to meet at an event, personal AI assistants that pick who you
should meet, and a pocket-sized FREE-WILi badge that tells you when they're nearby, and when you've actually found them.

**Live site: [mutuals.tech](https://mutuals.tech)** · [Events & assistants](https://mutuals.tech/events) · [My profile](https://mutuals.tech/chat) · [Badge app download](https://github.com/maiaPaperTowns/mutuals/releases/tag/mutuals-badge-v1) · [Devpost](https://devpost.com/software/mutuals-tech)

![SpacetimeDB](https://img.shields.io/badge/live%20map-SpacetimeDB-6b4fbb)
![FREE-WILi](https://img.shields.io/badge/badge-FREE--WILi%20OG-e5484d)
![ASI:One](https://img.shields.io/badge/AI-ASI%3AOne-111111)
![Clerk](https://img.shields.io/badge/accounts-Clerk-6c47ff)
![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

> Built at MHacks 2026.

## The problem

There are about a thousand hackers in this building, and you'll talk to maybe five of them. The person who
already fixed your exact bug is probably two tables away. Event apps give you a directory nobody opens. mutuals
shows who's actually around and worth meeting right now, and nudges you to go say hi.

## What it does

1. **Personal AI assistants, before, during and after an event** ([mutuals.tech/events](https://mutuals.tech/events)).
   Upload your resume or write an intro, join an event, and your assistants take it from there:
   - **Pre** compares everyone on the frozen roster (Pinecone similarity, goals, complementary skills) and gives
     you a ranked personal interest list with a reason for each person.
   - **During** watches live event GPS and alerts you when someone on your list is nearby and free to talk, with
     what to talk about. You request a connection; they accept.
   - **Post** prepares private follow-up drafts for the people you met.
2. **Opt-in live map** ([mutuals.tech](https://mutuals.tech)). Sign in, set a short profile and turn on location
   sharing: your dot and your name appear on the shared venue map. Turning sharing off removes your dot.
3. **A badge that finds people for you** ([`freewili/`](freewili/)). The FREE-WILi OG runs our own firmware: a
   hand-drawn pixel pup (or a clean formal look) on its screen, with sounds, LEDs and five buttons.
   - **On the map:** it shows who's near you with their name and distance. YES shares your location, NO makes you
     private.
   - **At an event:** the AI's nearby alerts and connection requests appear on the badge ("Alex is nearby: talk
     about Rust"; "Terry wants to meet!"). Answer with YES or NO.
   - **Badge to badge:** badges find each other directly by radio (433 MHz, no internet or GPS): "someone's
     nearby!", then "you found them!" when you're within a couple of metres.
4. **Points, levels and your connections.** +10 when someone new is nearby, +50 when you find them or connect.
   Levels go Lv 1 → Lv 5 (at 50 / 100 / 200 / 400 pts), and your badge's pup grows up with you. Everyone you've met
   is listed by name on the website and on the badge (MENU → NEXT).
5. **Cute or Formal.** One switch restyles the website and the badge:
   - **Cute** for clubs and university mixers: pastel pixel pup, puppy noises.
   - **Formal** for recruiting events: white/navy icons, "Contact nearby" / "Connection made", Tier 1–5, soft chimes.

## How it works

```
 Badge (FREE-WILi OG)                       Laptop: Chrome / Edge                        Cloud
┌──────────────────────┐   USB (Web Serial) ┌────────────────────────────┐  WebSocket  ┌─────────────────────────┐
│ display CPU: screen,  │◄──────────────────►│ mutuals.tech (map/, React)  │◄──────────►│ SpacetimeDB module       │
│ buttons, LEDs, sound  │ who's near, AI tip,│ live map, events & AI       │            │ profiles, live locations,│
│        ▲ link         │ points, style ◄────│ assistants, points, badge   │            │ events, matches, alerts  │
│ main CPU: CC1101 radio│      buttons       └────────────────────────────┘            │  ├─ ASI:One (assistants) │
└──────────▲───────────┘                                                               │  └─ Pinecone (matching)  │
           │ 433.92 MHz beacons (random id + first name while sharing; silent when private)
┌──────────▼───────────┐                                          Fetch.ai Agentverse: mutuals Networking agent (ACP)
│ another mutuals badge │
└──────────────────────┘
```

| Folder | What | Owner |
|---|---|---|
| [`map/`](map/) | mutuals.tech: live OpenStreetMap on SpacetimeDB, Clerk accounts and profiles, events and AI assistants, badge connection, points and levels, Cute/Formal | Terry · Maia |
| [`freewili/`](freewili/) | The mutuals badge app for the FREE-WILi OG (native C, wiliOGbsp): screens, sounds, radio proximity, plus the setup guide for teammates | Maia · Elena |
| [`agents/`](agents/) | Python agents, private SpacetimeDB gateway and backend verification; the deployed website uses native SpacetimeDB procedures for profiles, events and assistants | Ziquan · Terry |

## Current cloud deployment

The [profile page](https://mutuals.tech/chat) and [events and assistants](https://mutuals.tech/events) use Clerk
login and native SpacetimeDB procedures/reducers. Terry's provisioned administrator account can publish invitations
and lock the participant roster by starting an event. Pre compares the frozen members using Pinecone and stores
complete personal interest lists, initially displayed five or ten at a time. During manages favorites, voluntary
event GPS, nearby notifications and connection requests. Post prepares private follow-up drafts. Each assistant has
its own policy, permitted tools and personal stage history; all chat calls the ASI:One API from SpacetimeDB.

The separate mutuals Networking ACP entry point runs on Agentverse Hosted, with verified live routing isolation and
one-time website account binding. Browser notifications require permission and an open page; durable notifications
stay in the private website inbox. Follow-up drafts are copied and sent manually. See the
[Chinese implementation and acceptance guide](docs/活动与站内助手实施说明.md) for the current data contracts, operating
steps and verification scope. Older reports describe their original release only.

Completed changes must be committed, pushed and deployed to affected cloud targets under the standing instructions in
[AGENTS.md](AGENTS.md).

## Fetch.ai Pre/Post agent

**mutuals Networking** (`agent1q0jxrkgqv7qw75w0z3taze7dl05cpe0s6xcl0ddw0l0vkhvgxr8eccl74h2`) exposes the existing
native Pre/Post assistants through signed ACP on Agentverse Hosted. Website users authorize a chat with a five-minute
single-use code; permissions expire after 24 hours and can be revoked. Pre can save favorites, and Post can consult
event roles and save private follow-up drafts. During continues on the website with GPS. The public ACP entry point
is one Agent; the three native roles are not separately published agents.

See [setup, tests, demo and submission checklist](docs/FETCH_SUBMISSION.md). Live ASI:One routing, two-account
session separation, website binding and Pre recommendation/favorite persistence are verified; private access is
enabled for authorized chats. Public shared chat, video, live Post draft demonstration and actual entry submission
still need completion.

## Quick start

**Use it:** open [mutuals.tech](https://mutuals.tech) in Chrome or Edge, sign up and set your profile.

**With a badge** (full steps for Windows and Mac: [freewili/TEAMMATE_SETUP.md](freewili/TEAMMATE_SETUP.md)):

1. **Get the badge app.** Download it from the
   [mutuals-badge-v1 release](https://github.com/maiaPaperTowns/mutuals/releases/tag/mutuals-badge-v1) and flash
   it with FREE-WILi's [OG App Explorer](https://github.com/freewili/fwOGAppExplorer/releases/latest) (Windows) or the
   [FreeWili GUI](https://github.com/freewili/freewili-gui/releases).
2. **Connect.** On mutuals.tech, click **Connect** in the badge box and pick *FWOG display mutuals*. Press **YES** on
   the badge to share your location. After the first time, the badge reconnects on its own on every page.

**Run the website locally:**

```bash
cd map
npm ci
npm run dev        # http://localhost:5173 (add ?demo in local preview for two pretend people walking up to you)
```

For the shared live data, create `map/.env.local` (see [map/README.md](map/README.md)):

```
VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DATABASE=mhacks-live-map
VITE_CLERK_PUBLISHABLE_KEY=pk_test_bm92ZWwtZ3JpZmZvbi05MDczLmNsZXJrLmFjY291bnRzLmRldiQ=
```

**Build the badge app** (macOS/Linux), see [freewili/README.md](freewili/README.md):

```bash
cd freewili
native/setup_toolchain.sh      # once: Arm GCC + Pico SDK + ninja
native/build.sh                # → native/out/photon_main.uf2 (the mutuals app; the build target keeps its old name)
```

The agents backend stores its private data collections and matching presence in the same SpacetimeDB module as the
map. Python services connect through a server-only TypeScript gateway. See [`agents/README.md`](agents/README.md) for
schema-first deployment, environment setup, account linking, and JSON migration.

## Privacy, by design

- **Opt-in only.** Location sharing is off until you turn it on (YES on the badge or the website switch) and allow
  location in the browser. While you share, your dot and profile name are visible on the map. Turning it off (NO)
  deletes your dot. The map keeps only your latest position, never a history.
- **Your resume stays private.** Event members see your name and headline for recommendations; the resume itself is
  never shown. Email and passwords stay with Clerk.
- **Radio is quiet when you are.** While you're private, your badge broadcasts nothing. While you're sharing, it
  broadcasts a random per-boot id and your first name, nothing else.
- **Points stay local.** Your points and connections list live in your browser and on your badge. Nothing is
  ranked or listed publicly.

## Built with

[SpacetimeDB](https://spacetimedb.com) · [ASI:One](https://asi1.ai) · [Fetch.ai Agentverse](https://agentverse.ai) ·
[Pinecone](https://www.pinecone.io) · [Clerk](https://clerk.com) · React · TypeScript · Leaflet / OpenStreetMap ·
[FREE-WILi OG](https://github.com/freewili) + [wiliOGbsp](https://github.com/freewili/wiliOGbsp) (C, Raspberry Pi
Pico SDK) · Web Serial

## Team

Maia · Ziquan · Terry · Elena
