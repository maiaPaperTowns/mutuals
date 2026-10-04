> **Historical plan.** This was the original MHacks plan for an iMessage recruiter agent (Photon). The team
> pivoted to **mutuals**: the live map (`map/`) plus the FREE-WILi badge (`freewili/`). See [README.md](README.md)
> for what was built.

# MHacks 2026: plan & checkpoints

> A recruiter agent for your networking: iMessage onboarding from a resume, opt-in live map,
> double-yes intros, and a "was it worth it?" scoreboard.

## Who owns what

| Track | Owner | Folder | Sponsor / prize angle |
|---|---|---|---|
| Agents (concierge, onboarding, matcher, recruiter) | Ziquan | `agents/` | Fetch.ai: Agentverse + ASI:One, Innovation Lab badge |
| iMessage bridge + double-yes + UI/UX | Maia | `photon/` | Photon: agents in iMessage |
| Live map + demo personas | Terry | `map/` | SpacetimeDB |
| Scoreboard, Devpost, video, testing | Elena | `scoreboard/` | FREE-WILi, overall |

## How the pieces talk

```
iPhone ──iMessage──► Photon (spectrum-ts) ──POST AGENT_URL──► Concierge agent (Agentverse)
   ▲                     │  ▲                                     │ onboarding / matcher / recruiter
   │                     │  └──POST /offer {a, b, reasons}────────┘
   └──double-yes texts───┘          │
                                    ▼
                           SpacetimeDB: map presence + location, private ASI profiles/events/interactions/transcripts/plans/ROI
                                    ▲
                     React map (Terry) · Scoreboard (Elena)
```

## Step 0: shared schema (do this together first, ~30 min)

Use the field names from the shared Cursor prompt. The fields below are what the Photon side needs;
make sure the agreed schema has them (or tell Maia the real names).

- `person`: `id`, `name`, `imessage_id` (Spectrum DM space id), `open_to_meet` (bool)
- `profile`: `person_id`, `skills[]`, `projects[]`, `can_help_with[]`, `off_limits[]`
- `presence`: anonymous `participant_id`, `zone_id`, `is_demo_persona`; the map module keeps its SpacetimeDB owner identity in a private `participant_owner` table
- `match`: `id`, `a_id`, `b_id`, `reason_for_a`, `reason_for_b`, `a_yes`, `b_yes`, `status` (offered/accepted/declined/expired)
- `rating`: `match_id`, `person_id`, `worth_it` (bool)

## Checkpoints

### CP1: Saturday afternoon: every piece runs alone
- [ ] **Photon:** text the agent's number from a real iPhone and get a reply. *(Works in the terminal; needs Photon project creds.)*
- [ ] **Photon:** double-yes flow passes tests and a two-chat terminal demo. *(Done: `cd photon && npm test`.)*
- [ ] **Agents:** concierge registered on Agentverse; responds in ASI:One.
- [x] **Map:** React page with six schematic zones, opt-in dots, and 15 clearly labeled demo personas; local preview works without credentials.
- [ ] **Map live deployment:** publish the SpacetimeDB module, set frontend connection values, and verify two browsers receive the same opt-in/zone/opt-out changes.
- [ ] **Scoreboard:** thumbs up/down writes to `rating`, page shows real counts.

### CP2: Saturday night: the key checkpoint ⭐
One resume goes in → a profile comes out → one match is found → an iMessage reply comes back.
- [ ] Concierge exposes HTTP; bridge `AGENT_URL` points at it.
- [ ] Resume PDF sent by iMessage reaches the onboarding agent (bridge sends it base64).
- [ ] Matcher calls the bridge's `POST /offer`; two real phones do double-yes.
- [ ] **Photon go/no-go:** if real iMessage isn't working by Saturday evening, tell the team and switch to the fallback (below).

### CP3: Sunday morning: everything connected
- [ ] Map live from Spacetime; open-to-meet toggle hides the dot instantly.
- [ ] `match` table updated by the bridge, so the map can show "matched" state.
- [ ] After a reveal, the bridge asks "Was it worth it? 👍/👎" and writes to `rating`.
- [ ] Fetch/ASI:One flow works end to end; README has agent names + addresses.

### CP4: Sunday before the deadline: freeze & ship
- [ ] Feature freeze. Record the 3–5 min Fetch demo + 90-second backup recording.
- [ ] Rehearse the 2-minute demo twice (P1 narrator, P2 phone, P3 second phone, P4 backup).
- [ ] Devpost: real numbers only, tag Photon + Spacetime, credit Klick. Submit early.

## How to hit each track

**Photon (Maia).** Requirement: must integrate Spectrum ✅. Promo `HACKWITHPHOTON` = 1 month Pro free
(Pro is still the shared number pool: DMs only, no group chats). Prize: $400 + $300 credits + interview fast-track.

| Judging | How we score it |
|---|---|
| Vision: hybrid intelligence | The agent suggests, people decide: double-yes is human-in-the-loop by design |
| Craft: cohesive, tasteful | Typing indicator (done), 👍 tapback on resume, short texts, 🎉 effect on reveal, one nudge max |
| Depth: real-world edge cases | Decline/timeout without leaking identity (done), STOP/delete/off-limits, agent-down fallback reply (done), quiet once matched |
| Traction: real users tomorrow | Zero install, just text a number; real ratings from real people at MHacks |

"What great looks like" checklist:
- [ ] **Context that persists**: the agent remembers your profile and needs across texts (stored in Spacetime, not in memory).
- [ ] **Delightful default**: it texts only when it has a real intro, never spam. After a reveal: one "worth it?" follow-up, then quiet.
- [ ] **Safety and fallbacks that earn trust**: "what do you know about me?", "delete X", "stop" all work; nothing is revealed without two yeses.
- [ ] **Human-to-human**: after both say yes, hand off ("Text them at …" or a contact card via Spectrum `contact` content), then step back.

**Fetch.ai (Ziquan).** Agents on Agentverse, discoverable and usable in ASI:One, a public README with
names, addresses and the Innovation Lab badge. Demo video must show the ASI:One flow.

**SpacetimeDB (Terry).** Live shared map state is the point: opted-in dots, zone changes, and opt-outs update
without refresh. Show two screens updating at once. The current `map/spacetimedb` module is a standalone map+database for the MVP; when other modules need one shared database, merge its `presence` and private+`participant_owner` tables/reducers into the team's module rather than publishing a second module over it.
ASIone persistence now shares that map module; see [`agents/README.md`](agents/README.md) for schema deployment and the private gateway.

**Overall / FREE-WILi (Elena).** Real-phone testing, a bug list, and an honest ROI measure
(intros → meetings → % worth it). Never state a number we didn't measure.

## Fallbacks

| If… | Then… |
|---|---|
| Photon cloud iMessage won't connect | `@spectrum-ts/imessage-local` on a Mac signed into iMessage (same code, swap the provider) |
| iMessage is slow on stage | Mirror the phone, talk over the delay; 90-second recording ready |
| Agentverse is down | Bridge fallback replies + a local matcher call |
| Few real sign-ups | Seeded "demo persona" profiles |
