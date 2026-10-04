# Automatic During implementation plan

**Goal:** Demonstrate Pre-cached matching, automatic nearby alerts and connection-derived availability with administrator-controlled event phases.

**Architecture:** Extend existing native SpacetimeDB event handlers and React workspace. Add a private phase table so existing stored event rows do not require destructive migration. Preserve ASI chat and use deterministic reducers for immediate connection controls.

**Spec:** ../specs/2026-10-04-automatic-during-design.md

**Constraints:** Current feature branch; no secrets/private profiles in Git; preserve production data; 100m existing GPS threshold; completed chats remain eligible for Post; no group UI or closed-page push.

1. [x] Backend: write and run failing tests in `agents/spacetime-gateway/test/module.test.ts`; add phase/admin handlers and automatic GPS presence; reuse stored ROI in requests; implement atomic busy/end/free and notifications. Verify `npm.cmd test` and real module build.
2. [x] Website: failing behavior tests in `map/test/networking-workspace.test.tsx`; regenerate bindings; remove manual check-in; auto-start GPS; add nearby popup, direct accept/end controls and admin edit/delete/phase UI. Verify website suite and build.
3. [ ] Integration/review/release: three clients against isolated real SpacetimeDB, then independent review, focused commit/push, publish Maincloud with `--delete-data=never` and Vercel production, confirm URLs/deployment and cloud state.

Review focus: stale pending requests when one party gets busy; legacy accepted chats; stopping location while busy; phase switching during assistant operations; deletion while Pre is preparing. Backend tests must protect these cases or reject the conflicting operation explicitly.

Verified before release: 48 backend tests; 22 website tests; actual local SpacetimeDB with three members and one outsider; module/client builds. Independent review found and resolved legacy response bypass, phase bypass during model calls and stale GPS availability. Cloud synchronization is the remaining release step.
