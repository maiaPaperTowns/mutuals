# Web Profile Chat Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. Independent API work may be delegated under dispatching-parallel-agents; review the completed implementation.

**Goal:** Build the authorized resume/introduction chat intake and connect it to authenticated ASI profile persistence.

**Architecture:** `/chat` uses the existing Clerk/SpacetimeDB provider. A focused API client calls the pre-event service's own-account onboarding endpoints; that service persists structured profiles through its existing adapter.

**Tech Stack:** React, TypeScript, existing MHacks CSS, Clerk, FastAPI/Pydantic, existing SpacetimeDB storage.

**Spec:** `../specs/2026-10-03-web-profile-chat-design.md`

## Constraints and review focus

- Preserve the existing map and earlier uncommitted edits. No commit, push or production publication.
- Private default map profile before API identity resolution; never infer legacy IDs from browser identity.
- API JWT failures and model/storage failures must preserve inputs and never show fake saved/matched state.
- Resume/introduction updates retain prior facts and settings; uploaded bytes are not persisted.
- Cross-origin preflight, account switches and async responses must not leak another account's profile.
- Mobile file selection, focus, input and long content must remain usable.

## Tasks

### 1 Authenticated onboarding API

Files: `agents/models.py`, `agents/pre_event.py`, `agents/config.py`, `agents/.env.example`, `agents/tests/test_pre_event.py`.

- [x] Add failing tests for GET `/onboarding/profile` and POST `/onboarding/input` (`message`/`file` multipart), authentication, legacy IDs, file/size errors, preservation, failure and CORS.
- [x] Add profile introduction/filename fields and implement verified-account ingestion using existing extraction/storage; return the stored canonical profile.
- [x] Configure explicit CORS origins and run targeted/full backend tests.

### 2 Chat page and transport

Files: `map/src/ProfileChat.tsx`, `map/src/profileApi.ts`, `map/src/App.tsx`, `map/src/styles.css`, `map/vercel.json`, `map/.env.example`, test files and package scripts.

- [x] Add failing frontend behavioral/transport tests for restore, auth/bootstrap, upload success and retained failed input.
- [x] Implement the page, authenticated API client and map/chat navigation. Keep auth dialogs shared and bootstrap private default profiles through the real reducer.
- [x] Add responsive layout, keyboard/file interactions, profile summary and clear provider failure states.
- [x] Run frontend tests and production build.

### 3 End-to-end verification and documentation

- [x] Exercise rendered chat with real local API/JWT validation and storage, isolating only external identity/model retrieval in test fixtures.
- [x] Check desktop/mobile layout, direct `/chat` navigation, failed submission and account isolation; verify stored matching fields.
- [x] Run final regressions/builds and independent review; repair findings.
- [x] Document required API URL/CORS deployment settings and verified limits. Show the finished page; do not deploy to production.


## Verified results

- Frontend: 9 behavioral/transport/bootstrap tests passed; production build passed.
- Python: 144 tests passed, including 19 onboarding cases and 2 simultaneous-intake regressions.
- Database module: 12 regressions passed; SpacetimeDB CLI build passed. Gateway typecheck passed.
- Real local HTTP integration passed for both existing legacy-linked and newly initialized accounts. API and database/gateway restart restoration passed.
- Browser walkthrough used the real ProfileChat and API client, local RS256 fixture credentials and real FastAPI/gateway/SpacetimeDB. Text submission, TXT multipart upload, refresh restore and model-error draft preservation passed. Desktop/mobile layout and collapsed summary checked; 390px viewport had no horizontal overflow. Production /chat and login-dialog navigation checked.
- External JWKS retrieval and model responses isolated. Live Clerk authentication and the ASI1 model were not validated; backend credentials/configuration are absent in this checkout.
- Review fixes: blank map defaults no longer erase private extracted facts; same-account intake writes are serialized. Single API process/worker required; older resume/goals routes and multiple workers need database-level concurrency coordination before concurrent use.
- No commit, push or production deployment. Preview remains available at http://127.0.0.1:5173/chat.
