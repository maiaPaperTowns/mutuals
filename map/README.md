# MHacks Live Map

A mobile-friendly 2D OpenStreetMap centered on the Duderstadt Center. A participant can explicitly share their device's current GPS position; opted-in positions are synchronized live through SpacetimeDB.

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
npm run stdb:publish
npm run stdb:generate
npm run build
```

The current source uses a placeholder issuer, so authenticated location/profile writes remain rejected until step 3 is completed and the module is published. The map remains read-only for visitors until the Clerk publishable key is configured.

## Local preview

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

The existing `presence` table and participant-owner bindings are retained. `live_location` is a separate public table. Its two reducers enforce the existing owner identity, validate coordinate ranges, and let a participant update or remove only their own row. `clientDisconnected` removes that participant's latest location on disconnect.

Create `.env.local` from `.env.example`:

```env
VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DATABASE=mhacks-live-map
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Run `npm run dev` and open the page in two browsers to see opted-in location updates. Geolocation requires HTTPS in production (localhost is allowed by browsers). The Vercel project should use this `map` directory as its root and expose only the public `VITE_` settings. Never add a Clerk secret key or SpacetimeDB admin token to Vercel's frontend environment.

## Vercel

Configure the Vercel project with root directory `map`, framework preset `Vite`, build command `npm run build`, output directory `dist`, and install command `npm ci`. Add the two environment variables above for Production and Preview, then deploy.

## Verification

```powershell
npm run build
npm run stdb:build
```
