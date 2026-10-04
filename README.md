# mhacks-2026

**A recruiter agent for your networking, living in iMessage.**
Text it your resume, tell it what you need, and it finds the right person in the room.
Nothing is revealed until you both say yes.

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![Photon Spectrum](https://img.shields.io/badge/iMessage-Photon%20Spectrum-black)
![SpacetimeDB](https://img.shields.io/badge/live%20map-SpacetimeDB-6b4fbb)

> Built at MHacks 2026. Working name; the final name goes here once picked.

## The problem

There are about a thousand hackers in this building, and you'll talk to maybe five of them. The person
who already fixed your exact bug is probably two tables away. Event networking apps give you a directory and
an "87% match" that nobody opens and that doesn't tell you what to say.

## What it does

1. **Text a number. Nothing to install.** Send your resume PDF; the agent builds your profile in seconds.
   You can see everything it knows and delete any of it.
2. **Ask like you'd ask a recruiter.** "Stuck on Spacetime auth, anyone nearby solved it?" or "Find me a designer for tonight."
3. **Double yes.** The agent texts both people a plain-English reason, with no names. Only when **both** reply yes
   does it share names, zones and contact cards.
4. **Opt-in live map.** Participants can explicitly share anonymous device GPS positions; the latest location syncs live, and turning sharing off removes the point.
5. **Was it worth it?** One 👍/👎 after each intro. The scoreboard shows real counts only: intros, meetings,
   % rated worth it.

## How it works

```
iPhone ──iMessage──► Photon Spectrum bridge ──► Concierge agent (Fetch.ai Agentverse / ASI:One)
   ▲                  (photon/)                    ├─ onboarding: resume → profile
   │                     ▲                         ├─ matcher: who nearby fits this need
   └── double-yes ───────┘◄──── POST /offer ───────└─ recruiter: the plain-English "why"
                         │
                         ▼
          SpacetimeDB: person · profile · presence · match · rating
                         ▲
        Live venue map (map/)  ·  Worth-it scoreboard (scoreboard/)
```

| Folder | What | Owner |
|---|---|---|
| [`photon/`](photon/) | iMessage bridge on Photon Spectrum, double-yes intros, privacy commands, worth-it follow-up | Maia |
| `agents/` | Agentverse agents: concierge, onboarding, matcher, recruiter | Ziquan |
| [`map/`](map/) | React 2D OpenStreetMap centered on the Duderstadt Center, with opt-in anonymous GPS dots backed by SpacetimeDB | Terry |
| `scoreboard/` | Worth-it scoreboard, real counts only | Elena |

See [PLAN.md](PLAN.md) for checkpoints, the shared schema and fallbacks.

## Quick start

**iMessage bridge** (works with no credentials: it falls back to a chat in your terminal):

```bash
cd photon
npm install
npm test
npm start
```

To use real iMessage, put your Photon project keys in `photon/.env` (see [photon/README.md](photon/README.md)).

**Live venue map** (local preview works without cloud credentials):

```bash
cd map
npm install
npm run dev
```

The local preview shows the basemap and can display the current browser's GPS location locally. To enable shared live locations, publish the SpacetimeDB module and configure `map/.env.local`; see [map/README.md](map/README.md). For Vercel, set the public database URI and name in the project's environment settings. GPS sharing is off by default; when enabled, the latest exact coordinates are public to visitors of the map. The map does not store names, resumes, contact details, or a location history.

Other folders: see the README inside each one.

## Agents (Fetch.ai Agentverse)

| Agent | Role | Address |
|---|---|---|
| Concierge | Entry point; routes the conversation | `agent1q…` *(fill in)* |
| Onboarding | Resume → profile | `agent1q…` *(fill in)* |
| Matcher | Finds who nearby fits a need | `agent1q…` *(fill in)* |
| Recruiter | Writes the plain-English reason for an intro | `agent1q…` *(fill in)* |

## Privacy, by design

- **Opt-in only.** Location sharing is off until a participant enables it and grants browser location permission. Turning it off removes their published point.
- **Double yes.** No name, zone or number is shared until both people agree. A "no" or a timeout reveals nothing.
- **You're in control.** Text `STOP` to pause intros, `START` to resume, `DELETE ME` to erase everything,
  or ask "what do you know about me?"
- **Only what you give us:** a resume and a few answers. No scraping. Raw resumes aren't stored.
- **Quiet by default.** The agent only texts when it has a real intro, plus one follow-up.

## Built with

[Photon Spectrum](https://photon.codes/spectrum) (iMessage) ·
[Fetch.ai Agentverse & ASI:One](https://agentverse.ai) ·
[SpacetimeDB](https://spacetimedb.com) · React · TypeScript

## Team

Maia · Ziquan · Terry · Elena

## Credit

Inspired by **Klick** (HackMIT), which proved that this matters. We focused on zero-install iMessage
onboarding, an opt-in live map, and a transparent worth-it measure.
