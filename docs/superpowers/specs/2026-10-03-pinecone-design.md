# Pinecone connection design

The user authorized connecting the current backend to real Pinecone, following the selective integration approach in the comparison report. Preserve SpacetimeDB, Clerk authentication, existing API routes, and existing scoring. Do not integrate concierge or LinkedIn.

Implement the existing VectorDBClient and embed interfaces using Pinecone SDK 7.x and hosted llama-text-embed-v2 inference. Use a 1024-dimension cosine serverless index named networking-roi on AWS us-east-1. Validate an existing index instead of replacing it. Keep credentials only in ignored agents/.env.

Save profiles to the authoritative store and read their canonical map fields before embedding. Pinecone failures must not prevent profile/event persistence or the normal event scan. Include profile skills, goals, experience and offerings in the embedding text. Clean profile vectors from both current account-deletion paths; report a cleanup failure rather than silently claiming complete deletion.

Unit tests must explicitly disable real provider keys. Validate SDK calls with fakes, fallback behavior and canonical profile indexing. A separate connection check uses real inference and isolated synthetic vectors, confirms fetch/query, and deletes its test vectors. It must never print credentials or upload existing user data.
