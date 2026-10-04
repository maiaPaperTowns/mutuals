# Figma UI Migration Implementation Plan

**Goal:** Apply the supplied Figma redesign while preserving existing business operations and recording unresolved mappings.

**Architecture:** Reuse React components, CSS, private SpacetimeDB views and existing procedures. Add a small home-panel component; retain the event workspace's operations while separating event layout from the unified assistant route. Allow historical role conversations with existing membership and action safeguards.

**Tech stack:** React 19, TypeScript, CSS, Leaflet, Clerk, SpacetimeDB 2.

**Spec:** `docs/superpowers/specs/2026-10-04-figma-ui-migration-design.md`

## Constraints

- Work only in mutuals on the new branch; preserve main and deploy UI as Preview.
- No new dependencies, matching formula, profile schema or GPS permission changes.
- Do not implement the deferred mappings in the spec.

## Steps

- [x] Add behavioral regressions in `map/test/networking-workspace.test.tsx` for cross-phase selection/history, assistant route and sorted recommendations; add home-panel tests for deduplicated stars and ongoing status. Observe failures.
- [x] Implement `map/src/HomePanels.tsx` using `networkingInvitations`, `myNetworkingMemberships`, `myEventStars` and `getEventInterestList`. Wire into `App.tsx` and its existing style/account controls.
- [x] Adapt `ProfileChat.tsx` order/header and `NetworkingWorkspace.tsx` event/assistant layout; keep existing reducers and notification/connection logic. Use scoped CSS in `redesign.css`.
- [x] Add a module regression for a Pre conversation during Post, preserving During action gates. Remove only chat and read-only consultation phase checks in `map/spacetimedb/src/index.ts`.
- [x] Run website and gateway checks, real module build and browser desktop/mobile verification. Repair in-scope failures.
- [x] Record deferred mappings and evidence in `reports/2026-10-04-figma-ui-migration.md`; commit/push, verify SHA, publish compatible module with `--delete-data=never` and deploy a Vercel Preview. Verify both.

## Review focus

Account-owned data must not persist in component state across sign-out; repeated favorites must collapse while retaining all event links; assistant URL stage must survive event phase updates; recommendations must remain sorted when loading more pages; GPS must follow the actual During event phase on both event and assistant routes; changing the selected historical role must not start or stop presence.
