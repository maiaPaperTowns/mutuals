# Figma UI migration verification

## Scope and source

Canonical repository: `maiaPaperTowns/mutuals`. Branch: `feat/figma-ui-migration`, starting from `origin/main` at `10f350a06ed1cd9db78f753625d1987b7e6b9815`. The user selected a separate Vercel Preview, without merging or switching the production UI.

Figma: https://www.figma.com/design/T9gwgiWFWFmgf48D4xF7Yp?node-id=0-1

Retrieved design context and screenshots for home `16:2`, profile `14:2`, event `83:373` and accordions `68:52`. Four original SVG assets are stored in `map/public/redesign`. No dependencies were added. The Figma Starter MCP quota prevented inspecting the separate expanded People component and further variants.

## Requirements mapped to code

| Requirement | Implementation and evidence |
| --- | --- |
| Left Events, real individual event configuration | `HomePanels.tsx` links actual invitations to `/events?event=...`; `NetworkingWorkspace.tsx` separates the directory and detail layout. Existing join, admin, area and phase operations remain. |
| Event information left, people ranked right | `NetworkingWorkspace.tsx` uses the existing metadata/area map and sorts saved Fit descending. Stars, pagination, connections and proximity controls retain existing procedures. |
| Unified persistent agents | `/assistant` lists joined or saved-history events and all three roles. URL stage survives phase changes. Existing private message tables persist histories. Chat and read-only consultation phase locks were removed; membership, ownership, retry and action phase checks remain. |
| Account Profile dropdown / Logout / profile builder | `App.tsx` uses saved map-profile fields and existing SignOut. Build my profile links to `/chat`; Edit map profile retains the original editor. |
| Profile left, smaller upload/chat right | `ProfileChat.tsx` changes DOM order; `redesign.css` uses a 7:3 layout. Existing intake, resume parsing/upload, validation and save operations remain. Empty profile prompts fill the existing composer. |
| Cute/Formal | Existing StyleContext and toggle are reused. |
| Home People across events | `HomePanels.tsx` deduplicates starred target IDs, retains their event links, and highlights members of actual `during` events. It also checks ongoing joined rosters when the star was created in an earlier event. Names use member-scoped interest lists. State is cleared/scoped across account changes. |
| During agent GPS | The existing EventGpsMap remains available through an Event GPS disclosure on the assistant page whenever the selected event is actually During. Choosing Pre/Post does not interrupt location publishing. No server presence guards were loosened. |

## Verification

- Website: 42 tests passed across 10 files; TypeScript and Vite production build passed. Existing large-chunk warning remains.
- Gateway/module: 58 tests passed; typecheck passed. Real module build and binding generation passed; generated public contracts did not change.
- Actual isolated SpacetimeDB + SDK: PASS with three synthetic participants and one outsider. Verified historical Pre chat during Post, saved-history privacy, duplicate request replay, phase action guards, connections, GPS expiry/disconnect and existing deletion semantics. Provider responses are synthetic; real cloud providers are checked separately. The test fixture was repaired to include the already-existing mapProfile module dependency.
- Browser: local live home connected to SpacetimeDB and listed real invitations; real event detail rendered its existing data. Desktop profile and 390px mobile layout checked using a synthetic Alex Chen fixture, without committing private screenshots/data.
- Read-only review found dropdown stacking and assistant GPS lifecycle regressions; both were fixed. GPS regression now verifies an active watcher through role changes and cleanup on unmount.

## Deferred items for user review

Subsequent clarifications are tracked in `reports/2026-10-04-ui-follow-up.md`. The user has resolved the Event person-card click: clicking the card body must do nothing, as currently implemented.

1. Event image and Other information: no corresponding event fields exist. Existing area map and known event metadata remain; no new storage was invented.
2. People Reserved button and person-profile links: no confirmed existing operation. These actions were omitted.
3. Mascot checkbox: its exact purpose was not identifiable. Existing points, mascot, badge and Cute/Formal controls remain.
4. Expanded People, Formal and mobile visual variants: high-fidelity context was unavailable after the Figma quota. Requested data behavior is implemented; these visual variants need comparison with the design.
5. Admin event deletion currently deletes its chats. Persistence across phase changes is implemented; changing retention after administrative deletion requires a separate confirmed policy. Leaving an event retains existing messages, but sending still requires membership.

## Deployment

Website target is Vercel Preview on the existing mhacks-live-map project. The compatible chat module targets the existing Maincloud mhacks-live-map database with --delete-data=never; Preview therefore shares its existing backend, rather than receiving an isolated database. No table schema or matching algorithm changes.

- Implementation commit: `13641625c3c46de529594df78496710189ef6912`; pushed branch SHA verified equal to local HEAD before deployment.
- Preview: https://mhacks-live-po8jiu6dc-terryzhu2024-8185.vercel.app
- Vercel deployment `dpl_C7pT7fKbHK6AdFvKbXcsFsyFhKBW`: READY, Preview target; no production alias assigned.
- Existing production `mutuals.tech` still points to READY deployment `dpl_CFLWpVNtdpF64HtjeFBL8ZDJfkmD` from 09:45 EDT.
- Maincloud publication succeeded, with an empty database migration plan and --delete-data=never.
- Real cloud probe: ASI true; embedding dimension 1024; Pinecone write/fetch/query true; probe cleanup verified.
- Live Preview browser: homepage Live sync, actual three invitations, signed-out People privacy guidance and event navigation verified. The selected MHacks event renders the real information/area and People columns. Authenticated profile/star/agent behavior was exercised with synthetic automated fixtures and the actual isolated SDK test; this browser session was signed out.
- Public signed-out homepage screenshot saved outside Git in the task visualization folder. No private profile screenshots or deployment credentials were committed.
