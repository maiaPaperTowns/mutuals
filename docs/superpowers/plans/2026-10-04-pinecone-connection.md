# Pinecone connection verification

The user authorized configuring Pinecone and connecting to its real cloud service. The current backend now implements its existing vector interfaces with Pinecone; SpacetimeDB, Clerk authentication, web intake and ROI weights are retained. Concierge and LinkedIn changes were not imported.

- Credentials: stored only in ignored `agents/.env`; values are not recorded here. The supplied ASI key was saved but not validated by this work.
- Python runtime: existing `agents/.venv`, Python 3.12.
- SDK: Pinecone 7.3.0; `pip check` passed.
- Real index: `networking-roi`, serverless AWS `us-east-1`, 1024 dimensions, cosine.
- Real inference: `llama-text-embed-v2`, returned 1024 values.
- Real write, fetch and query: passed through `agents/check_pinecone.py`; self similarity was 1.0.
- Cleanup: the unique synthetic test vector was deleted, and fetch confirmed absence. No existing profiles or event records were uploaded by the connection check.
- Regression suite: 158 Python tests passed in 10.77 seconds. The fourteen new tests were verified failing before their corresponding implementation or corrections. Unit tests explicitly disable real provider keys; the gateway integration subprocess also disables them.
- Gateway TypeScript check: `npm.cmd run typecheck` passed.

Profile embedding now uses the saved canonical profile, including experience and offerings. Provider failures preserve authoritative data and fall back to the stored activity catalog. Unindexed events remain candidates even when other events are found through vector search. Delayed embedding results cannot replace newer canonical fields. Existing HTTP and messaging deletion flows remove the profile vector and report provider cleanup failures. A shared per-user lock serializes profile indexing and deletion within each Python process; coordination between separate agent processes still requires a database-level transaction/version check.

This verifies the local backend's real Pinecone connection. It does not deploy or start the full public backend, connect the production website, backfill existing records, or verify Agentverse/Photon communication.
