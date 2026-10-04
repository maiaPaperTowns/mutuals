# ASIone SpacetimeDB Integration Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Move the ASIone backend's six persistent collections into the existing SpacetimeDB database while preserving its API and the current map behavior.

**Architecture:** Port the published ASIone Python services into `agents/`, keep FastAPI/uAgents as the application layer, and add a private TypeScript gateway using the official SpacetimeDB TypeScript client. Extend the existing SpacetimeDB module with private ASIone tables and owner-scoped reducers/views; keep the JSON store as a local adapter and provide an idempotent importer.

**Tech Stack:** SpacetimeDB 2.x TypeScript module/client, Node.js TypeScript, Python FastAPI/uAgents, existing React/Clerk map.

**Spec:** `docs/superpowers/specs/2026-10-03-asi-spacetimedb-integration-design.md`

## Global Constraints

- Keep current map tables, map subscriptions, route paths, and public Pydantic response models.
- Keep names, contact details, match reasons, resumes, transcripts, follow-up drafts, and ROI records private by default.
- Never expose gateway or SpacetimeDB service credentials to browser code.
- Do not use client-supplied `user_id` as proof of identity.
- Do not seed production from `fake_data.py` or import `TestResume.pdf`.
- Do not create duplicate live-location storage.
- Preserve the pre-existing untracked `.gitignore`; stage only files created for this work if a commit is later requested.

## Review Focus

- ASI/uAgents request identity: verify which signed claim or authenticated transport identifies a caller; do not assume a request-body ID is trustworthy.
- Existing Clerk map profile data: profile extension must preserve current reducers, views, and bindings.
- Two-party interaction privacy: participant views must redact the other participant's private fields.
- Recording consent changes: transcript reads must re-check both participants' current consent.
- Partial imports and retries: duplicate keys must remain idempotent, and failed records must be reported without silent loss.

---

### Task 1: Bring the ASIone service source into this branch

**Files:**
- Create: the Python service modules from remote branch `ASIone` under `agents/`, following the published README and PLAN folder structure.
- Create: Python dependency/configuration files required to run those services.
- Exclude: `TestResume.pdf`; keep test fixture code isolated from production startup and migration.

**Interfaces:**
- Produces: the existing ASIone FastAPI routes, Pydantic models, uAgents behavior, and persistence adapter boundary for later tasks.
- Consumes: current `README.md`, `PLAN.md`, and the remote `ASIone` branch sources.

- [x] Identify and inventory the source files and route/model contracts on the published `ASIone` branch.
- [x] Add the service source under `agents/` without changing route paths or response models.
- [x] Record the current JSON store interface and the six collection keys/types that the replacement adapter must preserve.
- [x] Check the staged/unstaged diff to confirm unrelated `photon/` and `map/` application files are untouched.

### Task 2: Extend the existing SpacetimeDB schema

**Files:**
- Modify: `map/spacetimedb/src/index.ts`
- Generate/update: `map/src/module_bindings/` using the repository's existing SpacetimeDB CLI workflow.

**Interfaces:**
- Produces: private profile fields, `agent_user_link`, `agent_presence`, `agent_link_code`, `event`, `interaction`, `transcript`, `follow_up_plan`, and `roi_history` tables; purpose-specific reducers and owner/participant-scoped views for the gateway.
- Preserves: existing `presence`, `participant_owner`, `live_location`, `user_profile`, `my_profile`, `public_profiles`, and map reducers.

- [x] Add typed keys, indexed owner/status/time columns, timestamps, and serialized payload columns as specified.
- [x] Add reducers for profile/link updates, persisted ASI presence, organizer event upserts, interaction lifecycle and consent, transcript writes/reads, follow-up plans, ROI updates, and account deletion.
- [x] Keep sensitive tables private; views must return only the owner's permitted fields, with explicit transcript-consent checks.
- [x] Regenerate bindings and review the diff to ensure the map's current binding contracts still exist.

### Task 3: Add the internal TypeScript SpacetimeDB gateway

**Files:**
- Create: `agents/spacetime-gateway/package.json`, TypeScript configuration, server entrypoint, and typed SpacetimeDB adapter modules.
- Modify: root/agent run documentation only where needed to explain local startup and server-only configuration.

**Interfaces:**
- Consumes: Task 2 reducers/views and the ASIone JSON-store method signatures from Task 1.
- Produces: an authenticated internal HTTP API exposing only the typed persistence operations needed by the Python services.

- [x] Connect with the supported SpacetimeDB TypeScript client using server-side service credentials.
- [x] Authenticate Python-to-gateway requests with a backend-only shared credential; reject unauthorized requests before database operations.
- [x] Implement only allowlisted operations required by existing routes; do not expose arbitrary table or reducer access.
- [x] Keep service credentials out of tracked files and all frontend configuration.

### Task 4: Replace production JSON persistence and add migration

**Files:**
- Modify: ASIone route/service modules to depend on a persistence interface.
- Create: a SpacetimeDB-backed Python adapter and an idempotent importer for `DATA_DIR`.
- Modify: environment example and startup/deployment documentation for backend-only configuration.

**Interfaces:**
- Consumes: Task 3 internal gateway API.
- Produces: production routes backed by SpacetimeDB; local development may select the existing JSON adapter.

- [x] Resolve the authenticated caller identity from a verified token/transport claim; document the exact ASI/uAgents identity source found in Task 1.
- [x] Resolve or create a private `agent_user_link` record; attach messaging identities only after server-side verification.
- [x] Route existing reads/writes and live presence updates through the adapter without changing existing HTTP/WebSocket route contracts.
- [x] Implement deletion across the user's identity mapping, profile, interactions, transcripts, plans, and ROI records while retaining other users' profiles.
- [x] Import exactly the six JSON collections, preserving keys/timestamps, skipping already-existing records, excluding fixtures, and reporting per-record failures.
- [x] Review configuration and source to verify production does not select the JSON file store and no secrets enter frontend assets.

### Task 5: Integration and documentation review

**Files:**
- Modify: root `README.md`, `PLAN.md`, and agent/map deployment instructions as needed.

- [x] Document the schema-first deployment order, binding generation, gateway/Python startup, migration command, required server environment variables, and rollback to local JSON for development.
- [x] Inspect the complete diff against the approved design and confirm every acceptance criterion has a corresponding implementation path.
- [x] Report any deployment-only action that requires access to the SpacetimeDB production credentials; keep that action out of source-code changes.

---
