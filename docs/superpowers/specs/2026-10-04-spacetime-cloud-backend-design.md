# SpacetimeDB cloud backend

The user requests a service everyone can use, with every backend connection verified in the cloud. They explicitly selected SpacetimeDB as the backend instead of another continuously running server.

Keep the current Vercel website, Clerk login, SpacetimeDB database and private profile contracts. Move the website intake and networking business operations into authenticated SpacetimeDB TypeScript procedures/reducers. Procedures call the real ASI and Pinecone HTTP APIs. The website calls SpacetimeDB directly; Python and the internal Node gateway are no longer required for this web path.

Provider credentials are stored in a private configuration table, provisioned only through an administrator session. They never appear in generated client data, public views, provider status responses or logs. Database operators can inspect private tables; this is not a dedicated secret manager. Administrator-only synthetic probes verify actual Maincloud egress and clean up their temporary Pinecone record.

Intake keeps canonical name/headline/interests, private introduction/resume metadata and prior preferences. Text-based PDF/TXT extraction happens in the browser before sending bounded text; original bytes are not persisted. ASI failures return an actionable error without corrupting prior facts. Pinecone failures preserve canonical storage and expose indexing status. Per-account operation reservations and version checks prevent competing submissions or delayed writes from overwriting newer data.

Preserve the existing ROI formula when moving event ranking and live opportunities. Real accounts opt in to discovery; demo map pins never become real matches. Connection requests and responses require the authenticated participant, accepted interactions gate follow-up generation, and per-user views keep drafts private. Recording, outbound delivery, Photon and ASI:One chat transport require their actual providers and interfaces; missing implementations or credentials must be reported explicitly.

Success means: publish additive database changes without deleting existing data; publish the website; verify real Maincloud-to-ASI and Maincloud-to-Pinecone requests; verify signed-in browser load/save and refresh; record every unverified/blocked capability and the exact next action.
