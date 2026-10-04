# mutuals map

The mutuals website: a mobile-friendly 2D OpenStreetMap centered on the Duderstadt Center. A participant can
explicitly share their device's current GPS position; opted-in positions are synchronized live through SpacetimeDB.
It also connects to the **mutuals FREE-WILi badge**, keeps **points and levels**, and has a **Cute / Formal**
switch.

## Event demo at `/events`

An administrator selects an event and uses Pre, During or Post to set its persisted phase. Pre freezes the joined roster and prepares every participant's complete private list, storing Fit, ROI and reasons in SpacetimeDB. During reads those saved scores without recomputing ROI.

Opening During requests browser location permission automatically. With fresh accurate positions, eligible free participants within 100 m receive a website popup containing the saved match reason and conversation topics. No area, status or check-in selection is required. Accepting a request makes both participants busy; either can tap **End chat** to restore free status and resume nearby notifications. Location can be stopped, and expires after two minutes without updates. GPS, event membership, profile snapshots and saved scores use the same authenticated participant ID.

Administrator controls include editing metadata and deleting the selected event. During/Post require prepared lists. Leaving During removes its shared positions; the server also enforces phase restrictions for assistant tools. Event deletion clears its event namespace and related records while preserving personal profiles and other events. Post can draft a follow-up for a completed chat.

Tests cover duplicate requests, overlapping acceptance with three participants, ending and renewed notifications, location expiry/disconnection, phase changes during model calls, admin authorization and deletion isolation. `agents/spacetime-gateway` also provides `npm run test:networking`, which runs four SDK clients against an isolated actual SpacetimeDB with synthetic external providers. The demo uses one active pair per person; group chat and notifications after closing the website are outside this implementation.

The public map at `/` has the separate location behavior described below.

### Event areas and map reset

On `/events`, an administrator can use **Draw event area**, click 3–50 boundary points in order, undo points and save. Each event keeps its own public shaded boundary. Everyone can view the area before joining; During also shows it alongside member-only GPS pins. **Reset view** fits the complete activity area. On `/`, it fits all saved event areas with space for the map controls. Drawing does not change GPS sharing or matching eligibility.

Areas are saved by the admin-only `set_networking_event_area` reducer and read through the public `networking_event_areas` view. An empty boundary clears the area; deleting an event clears its area too. Existing event rows and invitation contracts are preserved. The open MHacks invitation uses an approximate North Campus boundary around Duderstadt/Pierpont, adjustable by an administrator.

## mutuals features

### FREE-WILi badge (`src/badge.ts`)

The **Connect** box links the badge over USB with **Web Serial**. That needs Chrome or Edge on a computer, over https
or localhost. The badge runs the app in [`freewili/native`](../freewili/README.md). Once connected:

- The map sends the badge one line a second:
  - `M <state> <nearby> <meters> <points> <met> <name>`: state is H not discoverable, A sharing with nobody near,
    N someone within 150 m, C someone within 25 m.
  - `N <first name>`: what the badge broadcasts on radio while you're sharing.
  - `T C|F`: the style.
  - `C a,b,c`: your connections' first names, newest first (the badge's MENU → NEXT page).
- The badge sends back:
  - its buttons: `B green` (YES) turns sharing on, `B red` (NO) turns it off;
  - its own points: `P <points> <caught> <met>` (practice and radio finds; the higher total wins);
  - other badges its radio hears: `R <count> <rssi> <name>`;
  - people its radio found: `F <id> <name>` (added to your connections list).
- The badge box shows the badge's state, the last button press and what the website did with it, what the radio
  hears, and when you need to sign in first.

### Points and levels (`src/points.ts`)

+10 the first time someone new is near you on the map, +50 the first time you're within 25 m of them; practice and
radio points come from the badge. Levels at 50 / 100 / 200 / 400 pts (Lv 1–5, or Tier 1–5 in Formal). Points and the
**connections list** (who you found, via the map or the badge's radio, and when) are kept in the browser
(`localStorage`), per device.

### Cute / Formal

The switch in the top bar (saved per browser) restyles the site and sends `T C` / `T F` to the badge:

- **Cute** (clubs, mixers): pixel logo and pups (`public/mutuals/`).
- **Formal** (recruiting events): white/navy, tier badge, professional wording.

### Solo demo

In local preview (no `.env.local`), open `http://localhost:5173/?demo`: after you share, two pretend people (Sam and
Alex) appear near you and Alex walks up over ~40 s, so the badge goes "someone's nearby!" → "you found them!".

### Sharing a laptop's copy with teammates

USB and location need https on other machines. `vite.config.ts` allows `*.trycloudflare.com`:

```bash
npm run build && npx vite preview --port 4173
cloudflared tunnel --url http://localhost:4173
```

The link lasts as long as the laptop and both commands keep running. For a permanent link, deploy to Vercel (below).

## Location and privacy behavior

- Sharing is off by default. The browser asks for location permission only after the participant turns sharing on.
- While sharing, the device reports its latest latitude, longitude, and accuracy to the public `live_location` table. Everyone who opens this public map can see those exact coordinates and accuracy circles. The map shows no names or profile information.
- Turning sharing off deletes the participant's location row. SpacetimeDB also removes the row when that client disconnects. The table stores only the latest position, not a location history.
- GPS can be inaccurate inside the Duderstadt Center. The accuracy circle is shown; a location outside the accepted 10 km accuracy range is not published. This is a live GPS map, not an indoor positioning system.
- The location point can be spoofed by a modified client. Treat this as a voluntary event coordination tool, not a security or safety system.
- OpenStreetMap tiles include required attribution in the map. Tile service availability is best effort; see [the tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## Accounts and profiles

The map stays viewable without an account, but only signed-in users can publish their own live location or save a personal profile. Anonymous visitors can still see live map pins. Profile cards appear when hovering a pin only when its owner has enabled `Show this profile when people hover over my live map dot`; the public view exposes the display name, headline, and interests only while that user is sharing a live location. Email and passwords are never stored in SpacetimeDB or shown on the map.

Clerk handles username/password authentication and recovery. SpacetimeDB validates the Clerk OIDC token, stores each user's profile in a private `user_profile` table keyed by the authenticated SpacetimeDB identity, and exposes only the explicit map-card fields through a filtered public view. The profile row cannot be read or changed by another user. Location and profile writes also reject anonymous connections on the server.

### Configure Clerk

1. Create a Clerk application and enable username and password sign-up/sign-in. Configure account recovery in Clerk; a verified email or phone may be needed for password reset.
2. Create a Clerk JWT template named `spacetimedb` with audience `mhacks-live-map`.
3. Copy the exact `iss` value from that template's token. Replace `CLERK_ISSUER` in `spacetimedb/src/index.ts` with that issuer URL. Keep `CLERK_AUDIENCE` equal to `mhacks-live-map`.
4. Set `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local` and in Vercel Production/Preview environment variables. It is a public frontend key; never place a Clerk secret key in a `VITE_` variable.
5. Build, publish the SpacetimeDB module, regenerate bindings, and deploy the Vercel frontend:

```powershell
npm run stdb:build
npm run stdb:generate
npm run stdb:publish
npm run build
```

The issuer is configured (`https://novel-griffon-9073.clerk.accounts.dev`) and the module is published to maincloud as
`mhacks-live-map`. The matching public publishable key is
`pk_test_bm92ZWwtZ3JpZmZvbi05MDczLmNsZXJrLmFjY291bnRzLmRldiQ=`.

## Local preview

### Profile intake page

Open `/chat`, or choose `My profile` on the map. Signed-in participants can submit an introduction, a PDF/UTF-8 text resume (up to 10 MiB), or both. Saved profile facts appear beside the conversation and restore on return. Failed requests keep the current draft and attachment. The page collects profile inputs for matching; it does not start a match or check anyone into an event.

Set `VITE_ASI_API_URL` to the public HTTPS address of the existing pre-event Python API. For local development use `http://localhost:8101`. Configure that service's `WEB_ALLOWED_ORIGINS` with the exact frontend origins, including ports (for example `http://localhost:5173,http://127.0.0.1:5173`). Follow [`../agents/README.md`](../agents/README.md) for its ASI key, Clerk JWT validation, SpacetimeDB gateway and service identity configuration. Production needs the updated database module as well as the API and frontend deployments.

The frontend requests a fresh Clerk `spacetimedb` JWT for each API request and creates a private default account profile for new users. The API resolves the account ID, extracts structured facts and saves through the existing SpacetimeDB adapter. Raw resume files are not retained. Intake does not change public map visibility; existing nonempty map names/headlines/interests take precedence. Empty map fields allow private extracted facts to survive without publishing them.

`npm test` runs account bootstrap and intake/transport regressions. `/test/profile-chat-preview.html` is a Vite development-only visual fixture with synthetic data; it is outside the production entry point and does not persist to a server.

```powershell
npm ci
npm run dev
```

Without SpacetimeDB environment variables, the page runs in local preview. If location sharing is enabled, the user's GPS appears only in that browser and is not sent to anyone.

## Publish the SpacetimeDB module

Prerequisites: Node.js 20.19+ and the SpacetimeDB CLI 2.x. Authenticate with `spacetime login`.

```powershell
npm ci
npm ci --prefix spacetimedb
npm run stdb:build
npm run stdb:publish
npm run stdb:generate
```

The ASIone backend also uses this database module. Publish the updated schema and regenerate bindings before starting `agents/spacetime-gateway`; configure the gateway service identity in the private `agent_service` allowlist. Follow [`../agents/README.md`](../agents/README.md) for backend-only credentials and JSON migration. Do not put service tokens in `map/.env.local` or frontend deployment settings.

The existing `presence` table and participant-owner bindings are retained. `live_location` is a separate public table. Its two reducers enforce the existing owner identity, validate coordinate ranges, and let a participant update or remove only their own row. `clientDisconnected` removes that participant's latest location on disconnect.

Create `.env.local` from `.env.example`:

```env
VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DATABASE=mhacks-live-map
VITE_CLERK_PUBLISHABLE_KEY=pk_test_bm92ZWwtZ3JpZmZvbi05MDczLmNsZXJrLmFjY291bnRzLmRldiQ=
```

Run `npm run dev` and open the page in two browsers to see opted-in location updates. Geolocation requires HTTPS in production (localhost is allowed by browsers). The Vercel project should use this `map` directory as its root and expose only the public `VITE_` settings. Never add a Clerk secret key or SpacetimeDB admin token to Vercel's frontend environment.

## Vercel

Configure the Vercel project with root directory `map`, framework preset `Vite`, build command `npm run build`, output directory `dist`, and install command `npm ci`. Add the two environment variables above for Production and Preview, then deploy.

## Verification

```powershell
npm run build
npm run stdb:build
```
