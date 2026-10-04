# UI follow-up implementation plan

**Goal:** Apply the user clarification to demo content, fixed recommendation pages and per-agent chat retention.

**Architecture:** Reuse the existing event UI, private message view and message writers. Use the current demo event ID for presentation content; no table migration.

**Tech stack:** React, CSS, TypeScript, SpacetimeDB.

**Spec:** docs/superpowers/specs/2026-10-04-ui-follow-up-design.md

- [ ] Write and run failing page replacement/global Fit ordering and 50-message isolation tests.
- [ ] Implement fixed five-person pages and server ordering; cap the private message view and trim all message writers.
- [ ] Add one official MHacks image and introduction to the known demo only; verify Cute/Formal and page geometry.
- [ ] Run website/module/gateway checks, actual local SDK integration and live cloud validation. Recheck Figma connection if school login succeeds.
- [ ] Review, commit/push, publish without data deletion, deploy Preview and record results/remaining blockers.
