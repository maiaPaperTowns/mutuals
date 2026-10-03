# Photon bridge (Maia)

iMessage ⇄ agent, via [Photon Spectrum](https://photon.codes/docs/spectrum-ts/getting-started) (`spectrum-ts`, Stable docs).

What it does:
- **Bridge:** every text and resume PDF goes to the agent (`AGENT_URL`), and the reply comes back with a typing indicator.
  Resumes get a 👍 tapback so people know they landed.
- **Double-yes intros:** a plain-English reason with no names. Only when both say yes: names, zones, a 🎉 confetti
  effect, and each other's contact card. A no or a timeout (15 min) reveals nothing.
- **One "worth it? 👍/👎" follow-up** after each intro (`FOLLOW_UP_SECONDS`, default 45 min); a text reply or
  a tapback both count. Then quiet.
- **Privacy commands** handled by the bridge itself, so they work even if the agent is down:
  `STOP`, `START`, `DELETE ME`, `HELP`.

- **Resume reader** (no API key): Apple's on-device text recognition reads a resume photo/PDF section by section:
  experience timeline (role, company, dates, location), school, projects + stack, every skill, side quests, links.
  Uses Claude instead if `ANTHROPIC_API_KEY` is set; Ziquan's agent takes over when `AGENT_URL` is set.
- **Profile photo**: after the resume the agent asks for a selfie; "new pic" changes it.
- **Profile + intro pages** ("mini app"): text `profile` to get your page (delete any fact, pause, erase everything);
  intros come with a page with Yes / Not now buttons that turns into "🎉 Meet …". Links open in Safari by default;
  `CARD_STYLE=app` sends Photon mini app cards that open inside Messages instead (needs the free Spectrum iMessage app).
- **Zones**: "I'm in the lounge" sets your zone (same zone names as the live map); "map" sends `MAP_URL`.
- **Agent texts first**: `POST /welcome {phone, name}` so new users just reply (shared lines differ per person).
- **Saved state**: profiles, photos and links survive restarts (`photon/data/`, gitignored, never committed).

Texts people can send: `help`, `profile`, `map`, `I'm in the <zone>`, `new pic`, `STOP`, `START`, `DELETE ME`.

## Run

```bash
npm install
npm test          # double-yes, resume parser, zones, pages (19 tests)
npm start         # no creds → terminal chat; with creds → real iMessage
```

Real iMessage: copy `.env.example` → `.env`, fill `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET`
from <https://app.photon.codes> (project → Settings), then `node --env-file=.env --import tsx src/index.ts`.

## Terminal demo (no phone needed)

Run `npm start` in a real terminal. `Ctrl+N` opens a second chat = second person.

```
chat-1:  /iam Alice zone A
chat-2:  /iam Bob zone C
chat-1:  /match chat-2 You both work on Spacetime auth.
chat-1:  yes        → "waiting on the other person"
chat-2:  yes        → both get the name + zone
```

## Interfaces for the team

**Bridge → agents (Ziquan).** If `AGENT_URL` is set, every text and attachment is POSTed there:

```json
{ "userId": "any;-;+15551234567", "text": "stuck on spacetime auth" }
{ "userId": "...", "attachment": { "name": "resume.pdf", "mimeType": "application/pdf", "base64": "..." } }
```
Respond with `{ "reply": "..." }`. Yes/no answers to pending intros never reach the agent.

**Matcher/Spacetime → bridge.** Start an intro with:

```bash
curl -XPOST localhost:8787/offer -d '{"id":"m1",
  "a":{"id":"<a userId>","name":"Alice","zone":"Zone A"},
  "b":{"id":"<b userId>","name":"Bob","zone":"Zone C"},
  "reasonForA":"They solved Spacetime auth yesterday.",
  "reasonForB":"Someone is stuck on Spacetime auth, which you have solved."}'
```
`reasonForA/B` must not contain names; they are sent before anyone says yes.
If `phone` is omitted, it's taken from the iMessage `userId`. It's only shared after both say yes.
The response is a 500 error if either person has texted STOP.

`POST /send {to, text}` sends a plain text. `GET /stats` returns real counts for the scoreboard:
`{offered, accepted, declined, expired, ratings, worthIt}`.

When someone texts DELETE ME, the agent gets `{ "userId": "...", "event": "forget" }` and should drop their profile.
"What do you know about me?" and "delete X" are normal texts, so the agent answers those from the profile.

## Phones need a public URL for the pages

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8787   # copy the https://….trycloudflare.com link
```

Put it in `.env` as `PUBLIC_URL=…` and restart. The quick-tunnel link changes each time cloudflared restarts.
Through the tunnel only `/app/…` pages are public; `/offer`, `/send`, `/welcome`, `/stats`, `/profiles` need the
`x-bridge-key` header set to `BRIDGE_KEY` (ask Maia for it; it is not in the repo).

## Photon gotchas (from the docs)

- Free & Pro (our HACKWITHPHOTON promo) = **shared pool**: each user may see a different sender number. DMs work; **no group chats**.
- Quotas: 5,000 msgs/day, **50 new conversations per line per day**. Have people text the agent first
  (onboarding) instead of the agent cold-texting them.
- Keep the first messages short and conversational to avoid Apple spam filtering
  ([deliverability](https://photon.codes/docs/best-practices/imessage-deliverability.md)).
- Fallback if Photon fails: `@spectrum-ts/imessage-local` runs on a Mac signed into iMessage, same code,
  just change the provider. Last resort: the terminal provider + screen recording.
- **Each user gets their own "Texts on" number** on the shared pool (Users page), and a running bridge only sees a
  newly added user's line after a restart. Add all demo phones, then restart once.
