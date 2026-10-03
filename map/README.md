# MHacks Live Map

A mobile-friendly 2D OpenStreetMap centered on the Duderstadt Center. A participant can explicitly share their device's current GPS position; opted-in positions are synchronized live through SpacetimeDB.

## Location and privacy behavior

- Sharing is off by default. The browser asks for location permission only after the participant turns sharing on.
- While sharing, the device reports its latest latitude, longitude, and accuracy to the public `live_location` table. Everyone who opens this public map can see those exact coordinates and accuracy circles. The map shows no names or profile information.
- Turning sharing off deletes the participant's location row. SpacetimeDB also removes the row when that client disconnects. The table stores only the latest position, not a location history.
- GPS can be inaccurate inside the Duderstadt Center. The accuracy circle is shown; a location outside the accepted 10 km accuracy range is not published. This is a live GPS map, not an indoor positioning system.
- The location point can be spoofed by a modified client. Treat this as a voluntary event coordination tool, not a security or safety system.
- OpenStreetMap tiles include required attribution in the map. Tile service availability is best effort; see [the tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## Demo account

The `Sign in` control creates a clearly labeled demo profile saved in the current browser's local storage. Its display name and optional, unverified email are not sent to SpacetimeDB or Google and are not synced across devices. This is a UI prototype, not authentication. It does not change the map's anonymous participant identity or location-sharing state.

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
```

Run `npm run dev` and open the page in two browsers to see opted-in location updates. Geolocation requires HTTPS in production (localhost is allowed by browsers). The Vercel project should use this `map` directory as its root and expose only the two public `VITE_` settings. Never add an admin token to Vercel's frontend environment.

## Vercel

Configure the Vercel project with root directory `map`, framework preset `Vite`, build command `npm run build`, output directory `dist`, and install command `npm ci`. Add the two environment variables above for Production and Preview, then deploy.

## Verification

```powershell
npm run build
npm run stdb:build
```
