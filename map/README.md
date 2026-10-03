# MHacks Live Map

Anonymous, opt-in zone map for finding people who are open to meeting at MHacks. This project uses a simplified, not-to-scale venue diagram; it does not use GPS or expose names, resumes, or contact details.

## Run a local preview

```powershell
npm install
npm run dev
```

Without SpacetimeDB settings, the app runs in **Local preview** mode with 15 synthetic points marked `DEMO PERSONA`. The opt-in toggle is local to that browser and does not create shared state.

## Enable shared live state

Prerequisites: Node.js 20.19+ and the SpacetimeDB CLI 2.x. Install the CLI from [spacetimedb.com/install](https://spacetimedb.com/install), then authenticate with `spacetime login`.

1. Build and publish the database:

   ```powershell
   npm install
   npm run stdb:publish
   npm run stdb:generate
   ```

   The module init reducer seeds 15 anonymous demo persona pins. The `presence` table contains only an opaque participant ID, zone ID, and demo flag. A private table binds each real anonymous participant ID to the caller identity; reducers only let that caller update or remove their own pin.

2. Create `.env.local` from `.env.example` and set the public database connection values:

   ```env
   VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
   VITE_SPACETIMEDB_DATABASE=mhacks-live-map
   ```

3. Run `npm run dev`. Two browsers connected to the same published database should see opt-ins, zone changes, and opt-outs update live. The anonymous identity token is saved in local storage so a returning browser keeps its participant identity.

## Deploy the frontend to Vercel

Import this folder as a Vercel project. Set `VITE_SPACETIMEDB_URI` and `VITE_SPACETIMEDB_DATABASE` in the Vercel project settings, then deploy. The frontend only needs the public URI and database name; do not add a SpacetimeDB admin token to Vercel or commit one to this repository.

## Privacy and scope

- The floor plan is a clearly labeled zone-level schematic, not an organizer floor plan or precise location feed.
- The map never shows participant names or profile fields. Identity exchange after dual consent belongs to the separate recruiter flow.
- Demo records are fictional, synthetic, and permanently labeled in the UI. Do not count them as real usage or ROI.
- The map is useful independently: SpacetimeDB is the shared live backend for opt-in presence, zone updates, and removals.

## Useful commands

```powershell
npm run build
npm run stdb:build
npm run stdb:generate
npm run stdb:publish
```
