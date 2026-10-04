# UI follow-up implementation plan

**Goal:** Apply the user clarification to demo content, fixed recommendation pages and per-agent chat retention.

**Architecture:** Reuse the existing event UI, private message view and message writers. Use the current demo event ID for presentation content; no table migration.

**Tech stack:** React, CSS, TypeScript, SpacetimeDB.

**Spec:** docs/superpowers/specs/2026-10-04-ui-follow-up-design.md

- [x] Write and run failing page replacement/global Fit ordering and 50-message isolation tests.
- [x] Implement fixed five-person pages and server ordering; cap the private message view and trim all message writers.
- [x] Add one official MHacks image and introduction to the known demo only; verify Cute/Formal and page geometry.
- [x] Run website/module/gateway checks, actual local SDK integration and live cloud validation.
- [x] Review, commit/push, publish without data deletion, deploy Preview and record results/remaining blockers.
- [ ] Complete Figma school-account reauthorization and quota-blocked design comparison after manual login. Current connector still confirms Gmail Starter.
