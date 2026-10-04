# Map Interaction Implementation Plan

> **For agentic workers:** Execute these small tasks in this session; use superpowers:executing-plans for native execution and one final independent review.

**Goal:** Make people and MHacks easier to inspect on the live map.

**Architecture:** Keep the existing Leaflet maps and cloud projections. Reuse saved profile headlines and the existing admin boundary reducer.

**Tech Stack:** React, Leaflet 1.9.4, SpacetimeDB 2.x.

**Spec:** `docs/superpowers/specs/2026-10-04-map-interaction-design.md`

## Global Constraints

- No changes to Pre/Post or ASI workflows; preserve visibility and event membership filters.
- Max zoom 23; native tiles 19; 6px dots with 20px transparent hit targets.
- Preserve current branch and all cloud data; deploy module with `--delete-data=never`.

## Review Focus

- A tiny boundary still centers without the old level-17 cap.
- Desktop and mobile overlays do not cover the fitted boundary.
- Center remains effective after participant focus.
- Profiles without AI headlines keep manual headlines or anonymous fallbacks.
- Public map profiles retain explicit opt-in; event profile details remain member scoped.

### Task 1: Map rendering and viewport

**Files:** `map/src/App.tsx`, `EventGpsMap.tsx`, `EventAreaMap.tsx`, `styles.css`; `map/test/event-area-map.test.tsx`.

- [ ] Update viewport tests to require different initial/Center padding, fractional zoom, maxZoom 23, and mobile overlay clearance; observe failure.
- [ ] Replace circles with centered dots, raise zoom limits, and fit Center against 80% of the remaining viewport.
- [ ] Verify using the website tests/build and browser inspection.

### Task 2: Saved headline and cloud synchronization

**Files:** `map/spacetimedb/src/index.ts`, `map/spacetimedb/src/mapProfile.ts`, generated client bindings; `map/test/map-profile.test.ts`; boundary change evidence in `reports/2026-10-04-map-interaction.md`.

- [ ] Add tests for saved AI headline fallback, missing/malformed profile data and a 140-character bound; observe failure.
- [ ] Reuse the headline in both existing profile projections; preserve visibility/membership checks.
- [ ] Build module and regenerate bindings; run website checks and one independent review.
- [ ] Commit/push, publish Maincloud without deleting data, update only the confirmed MHacks boundary, and deploy existing Vercel project.
- [ ] Verify remote SHA, deployment READY, desktop/mobile Center, dot/tooltip behavior and cloud counts; record evidence.
