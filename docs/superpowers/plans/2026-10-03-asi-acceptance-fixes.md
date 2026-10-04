# ASI Acceptance Fixes Implementation Plan

**Goal:** Fix the five defects from the acceptance review and verify the approved integration with regression tests and a local database.

**Spec:** `../specs/2026-10-03-asi-spacetimedb-integration-design.md`

**Constraints:** Preserve the current checkout and existing edits, API paths and response models. Use synthetic test data only. Do not publish to production or push commits. Legacy account ownership must be verified by an operator; a browser-supplied ID cannot select an account.

- [x] Add and run failing Python presence tests; serialize uAgents messages through the existing JSON conversion and verify restore/expiry.
- [x] Add and run failing database tests for legacy account mapping, canonical map profiles, and orphan deletion. Keep the verified mapping on subsequent identity resolution, expose explicit migration only through the internal gateway, and prevent replacing an account that already has data.
- [x] Make map profile fields canonical for linked ASI reads/writes; preserve unlinked legacy payloads until ownership is verified.
- [x] Cascade interaction deletion and clean orphan plans/transcripts/ROI on account deletion while preserving peer profiles.
- [x] Run the failing gateway type check, fix its collection key narrowing, regenerate module bindings, and run Node/Python regression suites and builds.
- [x] Exercise persistence, migration retries, permissions and deletion against an isolated local SpacetimeDB instance; report any remaining environment limits.

## Verification results

- Python: `agents/.venv/Scripts/python.exe -m pytest --basetemp=.pytest-tmp -q` — 123 passed, 0 skipped. `pip check` — no broken requirements.
- Gateway/module regressions: `npm test` — 11 passed, 0 skipped. New regressions were run failing before their fixes, including the independent review's orphan ROI remapping and JSON orphan transcript cases.
- Gateway: `npm run typecheck` — passed; regenerated bindings include the optional legacy ID parameter.
- Map: `npm run build` — passed (existing bundle-size advisory). Production database module: SpacetimeDB 2.10.2 `build --module-path spacetimedb` — passed.
- Real local integration: `npm run test:integration` — passed with SpacetimeDB 2.10.2, Node 24.14.1 and the actual Python adapter. Verified server-only reads/writes, participant transcript subscriptions and consent revocation, canonical map profiles, verified legacy IDs and one-time messaging links, persisted presence and Python restore/recommendation, six-collection import and retry, database/gateway restart, interaction cascade and orphan account deletion. Test data and local keys are isolated under ignored `.test-runtime/`.
- Additional defects found during verification were repaired: WebSocket bearer parsing, stale matching caches after deletion from another process, JSON peer ROI deletion, and orphan transcript cleanup. Rematch uses one authoritative presence snapshot per interval; opportunities/connections fail rather than returning stale data when storage is unavailable.

Production publication, real Clerk sign-in and external provider integrations were not exercised. The original ASI vector/embedding/push/transcription/outbound provider stubs remain as documented; replacing them is outside this persistence integration. No commit or push was performed.
