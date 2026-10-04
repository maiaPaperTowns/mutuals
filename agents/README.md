# ASI:One backend

The deployed website now uses native SpacetimeDB procedures/reducers with real ASI and Pinecone HTTP calls. This path does not start the Python services or internal gateway below. Their setup instructions remain relevant to the separate legacy Python/Agentverse path. See [the cloud acceptance report](../reports/云端后端连接验收报告.md) for current deployment and provider gaps.

This folder contains the published `ASIone` Python service modules. Their six persisted collections and ASI live matching presence use the SpacetimeDB module in `../map/spacetimedb`; Python connects only to the internal TypeScript gateway.

## Deploy the shared database

1. From `map/`, build the updated module and generate bindings, then publish it:

   ```bash
   npm run stdb:build
   npm run stdb:generate
   npm run stdb:publish
   ```

2. Create a server-only SpacetimeDB service token for the gateway. Start the gateway once and copy its logged service identity into the private `agent_service` table using an administrator SQL session. That table is the allowlist used by ASI persistence reducers and service views.
3. Configure the gateway and Python API from `.env.example` in the backend secret store. Keep `SPACETIMEDB_SERVICE_TOKEN`, `SPACETIME_GATEWAY_TOKEN`, Clerk credentials, and `ORGANIZER_TOKEN` out of browser/Vercel variables and tracked files.
4. Install and start the TypeScript gateway, then install and start the existing Python services with `APP_ENV=production` and `STORAGE_BACKEND=spacetimedb`.

The API resolves a Clerk subject to a SpacetimeDB identity. A user must sign in to the map and save a profile before that mapping exists. Once authenticated, `POST /link-code` creates a short-lived one-time code; the user sends `link <code>` to ASI:ONE to bind the verified messaging identity. The backend ignores body-supplied identity as proof of account ownership.

For linked accounts, the map's display name and nonempty headline/interests are authoritative. Empty map headline/interests retain extracted values in the private ASI profile. ASI reads and writes retain those values while saving private fields such as goals, skills and preferences. Resume extraction does not replace an existing map profile or publish private extracted facts to the map.

## Web profile intake

The pre-event service exposes authenticated `GET /onboarding/profile`, returning `{user_id, profile}` with a nullable profile, and multipart `POST /onboarding/input`, accepting optional `message` and/or `file`. Both use the verified account's resolved identity, including legacy mappings; browser-supplied user IDs are ignored. The POST returns the stored canonical `UserProfile`, with private cumulative `introduction` and optional `resume_filename` metadata.

Introductions are limited to 10000 characters in total. Resumes accept text-based PDF and UTF-8 `.txt` files up to 10 MiB; empty/unreadable files fail with an actionable 4xx response. Uploaded bytes and full extracted resume text are never persisted. ASI extraction receives prior structured facts, the introduction and up to 15000 characters of new resume text; additional skills, goals and offerings merge with existing facts while visibility, availability and follow-up preferences remain intact. Extraction errors return 502, and storage errors return 503.

Set `WEB_ALLOWED_ORIGINS` to a comma-separated list of exact website origins (for example `https://your-web-app.vercel.app,http://localhost:5173`), then restart the service. Wildcards are rejected. CORS wraps authentication so permitted browser preflight and authentication failures include the required headers. Set the website's public `VITE_ASI_API_URL` to this service's reachable HTTP base URL; keep gateway secrets on the server.

Run the pre-event API with one process/worker. Intake submissions are serialized per verified account in that process so two browser tabs cannot overwrite each other's supplements. This lock does not coordinate multiple API workers or writes through the older resume/goals endpoints; scaling concurrent writers requires a database-level transaction/version check before enabling them.

## Local run

For development, set `APP_ENV=development` and `STORAGE_BACKEND=json`; the existing JSON adapter stores records under `DATA_DIR`. Production refuses the JSON backend.

Start the gateway from this directory:

```bash
cd spacetime-gateway
npm install
npm start
```

Run the existing Python entrypoints (`pre_event.py`, `during.py`, `post_event.py`) with the same environment. Push, transcription, and outbound message integrations remain provider stubs from the published branch.

Install Python dependencies from this directory with `python -m pip install -r requirements.txt`. Run the three HTTP service entrypoints in separate processes so each agent keeps its configured ports and lifecycle.

## Pinecone

Set `PINECONE_API_KEY` in the ignored `agents/.env` or backend environment, then install `requirements.txt`. The backend uses Pinecone SDK 7.x and hosted `llama-text-embed-v2` inference. On first use it creates the serverless `networking-roi` index on AWS `us-east-1`, with 1024 dimensions and cosine similarity. An existing index must match those settings; it is never replaced. Optional overrides are listed in `.env.example`.

Profiles and events use separate namespaces. SpacetimeDB remains the source of truth: the backend saves and reads canonical profile fields before embedding them. Provider failures preserve profile/event storage and fall back to scanning stored events. The existing HTTP and ASI account-deletion paths also remove the user's profile vector; a provider cleanup failure is reported for retry. Existing records are not automatically uploaded or backfilled, and this change does not alter ROI scoring or add concierge.

Indexing and deletion share a per-user lock within each Python process. Concurrent operations across separate agent processes require database-level coordination; the local lock does not provide it.

From `agents/`, run `.\.venv\Scripts\python.exe check_pinecone.py` to verify the real service. The check embeds synthetic text, writes to a unique temporary namespace, verifies fetch/query, then deletes and confirms removal of its test vector. It never uploads saved profiles or prints credentials. Unit tests disable real provider keys.

## Import existing local JSON records

Point `DATA_DIR` at the published service's existing data directory and provide `SPACETIME_GATEWAY_URL` and `SPACETIME_GATEWAY_TOKEN`:

```bash
python migrate_json.py
```

The importer reads only `profiles`, `events`, `interactions`, `transcripts`, `plans`, and `roi_history`. It preserves each Pydantic record and timestamp, skips keys already present in SpacetimeDB, reports failures by collection and filename, and returns a nonzero exit code if any record fails. It never reads fixtures or sample resumes. Legacy records retain their original ASI user keys. Records whose keys do not match the authenticated account ID remain private and need an explicit, verified account mapping before users can access them.

After importing a legacy profile, an operator must verify that its owner controls the Clerk account, then call the internal gateway with the verified pair:

```http
POST /api/identity/link-legacy
Authorization: Bearer <SPACETIME_GATEWAY_TOKEN>
Content-Type: application/json

{"auth_subject":"<verified Clerk subject>","user_id":"<imported ASI user ID>"}
```

This route requires the server-only gateway secret and is not exposed by the public Python APIs. Do not infer ownership from a matching name or a browser-supplied ID. Subsequent identity resolution retains the legacy key and messaging binding. The reducer refuses an account owned by someone else, and refuses replacing a default account with existing ASI data, including orphan peer ROI references; reconcile conflicting data before changing its key.

## Deletion and privacy

`DELETE ME` after messaging account linking and authenticated `DELETE /delete-me` remove the user's profile data, ASI presence, messaging link, related interactions, transcripts, plans, ROI rows, and map pin/location. Transcript writes and reads require both participants' current consent. The gateway listens on loopback by default and requires its own bearer secret for all persistence endpoints. If Python services run elsewhere, bind only to a private network address and protect the connection with network policy and TLS.

Live matching checks authoritative presence before returning opportunities or creating a connection, and refreshes it once per rematch interval. Deletion from another Python process therefore also clears the matching process's cached participant state. Deleting an interaction cascades to its transcript, follow-up plans and ROI entries; account deletion also follows orphan references.

## Tests

From `agents/`, create a virtual environment and install the development requirements:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest --basetemp=.pytest-tmp -q
```

The Python suite includes the original ASI tests, signed test JWTs and regressions for presence persistence, authentication, WebSockets and cross-process deletion. JWKS retrieval and external provider stubs are isolated in tests.

From `agents/spacetime-gateway/`:

```powershell
npm install
npm test
npm run typecheck
$env:SPACETIME_CLI = '<path to SpacetimeDB 2.10.2 CLI>'
$env:SPACETIME_STANDALONE = '<path to SpacetimeDB 2.10.2 standalone executable>'
npm run test:integration
```

Use Node.js 24. The module regression tests invoke production handlers with in-memory table contexts. The integration test requires installed `map/spacetimedb` dependencies and the Python virtual environment above (`TEST_PYTHON` can override its executable). It starts an isolated database, gateway and FastAPI service on temporary loopback ports, copies the production module with a test-only fixture reducer, and creates its own local JWT keys and synthetic records under ignored `.test-runtime/`. It verifies service authorization, verified legacy mappings, real RS256 web authentication, multipart profile intake and supplements, canonical/private profile fields, API restart restoration, provider failure preservation, one-time messaging links, consent-aware subscriptions, the real Python storage adapter, six-collection migration retries, database/gateway restart and deletion. Only external JWKS retrieval and ASI completion are isolated for web intake. It does not use production credentials or publish a production database.

For a local rendered browser walkthrough, set `INTAKE_BROWSER_VERIFY=1` before running the integration test. After API preparation it writes `map/.test-runtime/onboarding-browser.json` with a generated fixture JWT and allows `http://127.0.0.1:5173`. Complete the walkthrough and create `map/.test-runtime/onboarding-browser.done` within three minutes; the test then removes the JWT config and continues its restart/deletion checks. The default integration run does not pause.
