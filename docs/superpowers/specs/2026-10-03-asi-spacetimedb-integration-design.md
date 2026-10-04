# ASIone Data Integration with SpacetimeDB

## Goal

Bring the ASIone backend data into the current `feat/live-map-spacetimedb` branch so the project uses the existing SpacetimeDB database as its shared source of truth. Keep the React map and its current SpacetimeDB subscription flow. Keep the ASIone FastAPI and uAgents services as the application and agent layer.

ASIone currently persists six collections through a development-only JSON file store: profiles, events, interactions, transcripts, follow-up plans, and ROI history. Its pre-event, during-event, and post-event APIs depend on those collections. The current map module already stores user profiles, presence, participant ownership, and live locations.

## Architecture

The SpacetimeDB TypeScript module owns the persistent project data. The ASIone Python services continue to own resume parsing, matching, negotiation, and HTTP/WebSocket behavior. A small internal TypeScript gateway connects the Python services to SpacetimeDB through the supported TypeScript client. The gateway exposes typed, allowlisted operations over an authenticated internal API; it does not provide generic public table access.

Bring the ASIone service files from the remote `ASIone` branch into the current branch under `agents/`, matching the directory already documented in the project README and plan. Place the TypeScript gateway under `agents/spacetime-gateway/`. Keep the existing `map/` application and module as the current branch's frontend and database module.

The flow is:

1. The React map keeps its current SpacetimeDB subscriptions. ASIone clients call the existing HTTP/WebSocket endpoints for agent workflows; this integration does not add agent UI to the map.
2. FastAPI verifies the caller and resolves the caller's stable project identity before invoking agent logic.
3. The Python services call the internal gateway for persistent reads and writes.
4. The gateway invokes authorized SpacetimeDB reducers and views.
5. SpacetimeDB commits the change and streams permitted updates to subscribed clients.

The gateway uses a dedicated SpacetimeDB service identity and a credential held only by backend services. SpacetimeDB reducers authorize that identity for agent-owned writes. Participant-facing views return only the requesting participant's records. The browser never receives the gateway credential or database administration credentials. FastAPI verifies each request's existing auth token and derives the authenticated identity from its verified claims; it does not accept a caller identity from an untrusted request body. On first use, FastAPI creates or resolves the private mapping from the verified identity to the ASIone `user_id`. Messaging identities are attached only after a server-side verification step. Existing accounts must be linked by a verified identity; matching on display name or email supplied in a request is not sufficient.

The existing ASIone HTTP and WebSocket routes and response models remain stable. The JSON store remains available only as a local development/test adapter. Production services use the SpacetimeDB-backed adapter.

## Data model

Keep the current `presence`, `participant_owner`, `live_location`, and `user_profile` tables. Extend the private profile record with the ASIone profile fields rather than creating a second source for name, headline, and interests. Add a private mapping from the ASIone `user_id` to the authenticated SpacetimeDB identity.

| Data | SpacetimeDB representation | Access |
| --- | --- | --- |
| Profile | Extend `user_profile` with role, skills, experience, goals, offerings, seniority, availability, discoverability, follow-up preferences, and an update timestamp. Keep the existing map-card fields canonical for display name, headline, interests, and visibility. | Private to the owner and the authorized agent gateway. The existing public profile view returns only opted-in map-card fields. |
| Identity mapping | New private `agent_user_link` table mapping the ASIone user key and messaging identifiers to the authenticated identity. Include owner identity and creation/update timestamps. | Authorized gateway only. |
| Live ASI presence | New private `agent_presence` table keyed by ASIone user ID, containing zone, optional local x/y, availability, discoverability, and last-seen time. | Authorized gateway and the owning participant. Not the map's public presence table or GPS location history. |
| Event catalog | New `event` table keyed by `event_id`, with searchable title, start/end, zone, host role, and a serialized payload for the remaining `EventInfo` fields. | Organizer writes; participant and agent reads. |
| Interactions | New `interaction` table keyed by `interaction_id`, with participant IDs, state, ROI score, reason, consent state, recording state, and transcript reference. | Authorized gateway and the two participants through scoped views. |
| Transcripts | New private `transcript` table keyed by interaction, containing transcript text and the optional audio reference. | Authorized gateway and interaction participants only after both recording consents are present. |
| Follow-up plans | New private `follow_up_plan` table keyed by `plan_id`, containing owner, interaction, channel, drafts, timing, rationale, approval state, and delivery status. | Authorized gateway and the plan owner. |
| ROI history | New private `roi_history` table keyed by entry ID, containing owner, interaction, outcome, score-at-match, and timestamp. | Authorized gateway and the record owner. |

Use typed keys, owners, statuses, and timestamps for lookups and access checks. Add indexes for event time, interaction participants/status, plan owner/status, and ROI owner/time because those fields drive existing lookups. Store nested Pydantic values as serialized JSON fields in the first schema version so the backend can preserve its existing request/response models. Add extracted indexed columns only where matching or map queries need them. Keep embeddings as optional profile/event payload data until the embedding and vector-search integrations are implemented.

The event catalog is populated through the organizer-only `POST /events` route, which upserts records. Test fixtures and `fake_data.py` remain test data and do not seed the production database. The map's existing location table remains the source for live GPS coordinates; ASIone zone and availability values belong to the private `agent_presence` data and must not create a second GPS location record. Agent presence updates expire after the existing stale timeout and are restored from the database when the ASIone agents start.

## API and privacy rules

Preserve the existing ASIone API surface, including resume/profile/goals, event recommendations, presence/opportunities, connect/respond, recording consent/start/stop, follow-up preferences/plans, approvals, outcomes, and ROI history. Route handlers continue to return the current Pydantic models while their persistence calls move behind the SpacetimeDB adapter.

Replace the current trust in client-supplied `user_id` with verified identity resolution. The authenticated identity determines the user's profile and participant-specific records. The agent gateway may perform cross-participant operations only through the authorized service identity and purpose-specific reducers.

Profiles, messaging IDs, contact handles, match reasons, recordings, transcripts, follow-up drafts, and ROI records remain private by default. For interactions visible to both participants, each view omits the other participant's private profile/contact fields unless that participant has explicitly consented to share them. Transcript reads require both participants' recording consent; consent is checked at read time as well as when recording starts. Public map views expose only existing opt-in fields. This integration does not expand who can see live GPS coordinates or alter the current location-sharing behavior.

The existing `DELETE ME` flow removes the person's identity mapping, profile, every interaction involving that person, dependent transcripts and follow-up plans, and ROI history for those interactions. It leaves the other participant's profile intact and removes all deleted-user contact data and transcript content.

## Migration and deployment

Add an idempotent importer for a local ASIone `DATA_DIR`. It reads the six JSON collections and writes them through the gateway, preserving keys and timestamps. It skips records already imported and reports per-collection counts. Import errors are reported per record, and the command exits unsuccessfully if any record fails so operators can rerun after fixing the issue. The importer does not read credentials from repository files, import `fake_data.py` fixtures, or ingest `TestResume.pdf`.

Deploy the SpacetimeDB schema before the gateway and Python services. Configure the gateway endpoint and service credentials only in backend environments. Configure public frontend values as before. Regenerate TypeScript bindings after each module schema change. Deployment-specific service hosts remain environment configuration; this design does not select a hosting provider.

## Acceptance criteria

- All six ASIone collections persist in the current SpacetimeDB database after Python service restarts.
- ASIone live presence and availability persist across agent restarts and expire after the configured stale timeout.
- Existing ASIone route paths and response models remain unchanged.
- Organizer event upserts survive restart and feed event recommendations.
- Agent and participant reads return only the records their identity is allowed to access.
- Unauthenticated requests and requests with a forged body `user_id` cannot read or mutate another participant's data.
- Interaction views redact private fields belonging to the other participant, and transcripts remain unreadable until both recording consents are present.
- Public subscriptions expose no phone numbers, contact handles, resume-derived private fields, transcripts, match reasons, follow-up drafts, or ROI history.
- Map profile, presence, and location behavior continue using the current SpacetimeDB tables without duplicate live-location rows.
- The JSON importer can be run more than once without duplicating records.
- Production services do not use the JSON file store or test fixtures as a source of truth.

## Out of scope

- Replacing the Python/uAgents runtime with TypeScript.
- Replacing FastAPI routes or changing their public payloads.
- Implementing the vector database, embedding service, transcription provider, push notifications, or outbound messaging providers.
- Changing map location precision, visibility, or sharing behavior.
- Adding real user records or synthetic personas to the production database.
