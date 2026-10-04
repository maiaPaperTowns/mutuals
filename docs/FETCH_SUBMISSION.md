# mutuals: Fetch.ai submission and operation

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Agent name: **mutuals Networking**

Agent address: `agent1q0jxrkgqv7qw75w0z3taze7dl05cpe0s6xcl0ddw0l0vkhvgxr8eccl74h2`

Website: https://mhacks-live-map.vercel.app/events

Public project source: https://github.com/maiaPaperTowns/mutuals

## What this agent actually does

ASI:One -> signed Agent Chat Protocol (ACP) -> Python Agent on Agentverse Hosted -> authenticated HTTPS native SpacetimeDB procedures -> ASI model API and saved event data.

Agentverse Hosted runs the Python Agent. No Agent process or listener runs on the user's computer; no local-network permission or tunnel is required. The model and business data stay in the existing cloud backend. The model is accessed through the existing ASI API in SpacetimeDB. The existing Pre, During and Post assistants are internal roles with distinct policies and tools. They are not three separately published Agentverse agents. Post consults Pre/During through the existing native role Q&A; only the single ACP entry point is counted publicly.

Scope: **Pre and Post** in ASI:One. Pre can review an existing event interest list, explain matches, and save favorites without GPS. Post can review completed connections, consult other roles, prepare permitted private follow-up drafts and save them to the same website account. Drafts are not delivered automatically. During asks the user to open the existing website GPS flow; this is outside the primary Fetch demo workflow.

## Account authorization

An ASI account is not a Clerk account. We never treat an Agent address, supplied user ID or username as a website identity.

1. Sign in on the website and save a profile. Join the demo event there.
2. In **Use mutuals in ASI:One**, click **Generate link code**.
3. Open a chat with **mutuals Networking** and send `link <code>`.
4. Send `events`, then `event <event-id>` if you have multiple events.
5. Continue the Pre/Post workflow in that conversation. Results persist in the existing private website tables.

The code expires after five minutes and is single use. A grant lasts at most 24 hours and is scoped to a hash of the Agent's address, signed sender and transport session. A new chat needs a new code; relinking replaces the previous grant. Website **Disconnect ASI:One**, chat `unlink`, account deletion, or expiry removes access. Authorization and phase checks run again after external model calls, before writes. Duplicate ACP message IDs reuse the same backend request ID and saved turn/action results.

Codes, raw chats, private drafts and service credentials are excluded from transport logs. The Hosted adapter calls only native scoped procedures over HTTPS, using a dedicated token stored in Agentverse Agent Secrets. Its SpacetimeDB identity is allowlisted in `asi_chat_service` and cannot use the existing legacy service profile view. It receives no caller-supplied user IDs.

## Deploy on Agentverse Hosted

The active Hosted Agent is **mutuals Networking**, handle `@mutuals-mhacks2026`. Live probes from two consenting ASI accounts had distinct signed senders/session hashes and stable hashes across turns within each chat. A separate chat also had a different hash. Dedicated private access is enabled with user approval. Website-to-ASI binding, authorized event queries, Pre recommendations and saved favorites passed live verification. An unbound chat still receives an authorization prompt instead of event data. Actual platform message replay was not induced; deterministic request IDs and replay safety were verified in tests and native SDK integration.

Profile: https://agentverse.ai/agents/details/agent1q0jxrkgqv7qw75w0z3taze7dl05cpe0s6xcl0ddw0l0vkhvgxr8eccl74h2/profile

Build the single-file artifact from the tested source:

```powershell
agents/.venv/Scripts/python.exe agents/build_asi_hosted.py
```

Paste `agents/hosted/agent.py` into this Hosted Agent's Build editor as `agent.py`. Confirm the entire saved editor content matches the artifact, then Start Agent. Agentverse supplies the Agent instance and identity; do not upload `.env`, create a local Agent, or start a listener. The code defaults to a public probe until private access is enabled. Hosted globals reset between invocations; event selection, grants and retry state therefore live in SpacetimeDB.

**Private activation gate:** with two consenting ASI accounts and two chats, verify distinct session hashes, stable hashes across turns within one chat, and stable request IDs on retries. No real binding codes/private data should be sent until this is verified. New sessions are deliberately unbound.

After this passes, obtain a fresh service token from the intended SpacetimeDB server's `POST /v1/identity`. Using the database owner's CLI, allowlist only its returned identity:

```sql
INSERT INTO asi_chat_service (identity) VALUES (0x<dedicated-service-identity>);
```

Store that token in **Agent Secrets** as `ASI_CHAT_SERVICE_TOKEN`, and set `ASI_CHAT_ENABLED=true`. Do not reuse an administrator or legacy gateway token. Restart the Hosted Agent and verify website authorization -> Pre/Post actions -> same-account persistence. Removing the allowlisted identity immediately disables access.

Required resources: the existing Clerk website, native SpacetimeDB module/provider settings, Agentverse Hosted and ASI:One accounts. The backend still calls ASI/Pinecone; these keys stay in its current cloud configuration. Hosted imports use supported `httpx`, `uagents` and `uagents_core` plus Python standard modules. There is no local bridge process to run.

## Verification

```powershell
# agents
.venv/Scripts/python.exe -m pytest tests -q --basetemp=.pytest-tmp
# agents/spacetime-gateway
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:networking
# map
npm.cmd test -- --maxWorkers=1
npm.cmd run build
```

The real database integration uses an isolated local SpacetimeDB instance with synthetic provider responses, not production user data. On Windows set `SPACETIME_CLI` and `SPACETIME_STANDALONE` to the actual binaries in the installed version's `bin` directory. Unit tests verify code expiry, single use, service separation, session replacement, cross-user denial, message replay, website revocation during model execution, and unchanged During guards. Local tests do not prove ASI:One discovery or live routing; those require the preceding gate and a working cloud demonstration.

## Demo and requirement evidence

Use consenting demonstration accounts with public/synthetic profiles. Join and prepare an event, complete an accepted connection using the existing During website flow, then set the event to Post. Disclose this setup in the demo; do not fabricate GPS/check-ins or completed connections.

Suggested primary **Post** conversation after authorization:

1. `events` / `event <id>`: select the caller's own event.
2. `recap`: Post consults Pre/During and explains the caller's completed connections.
3. `Which completed connection should I follow up with and why?`
4. `Prepare and save a LinkedIn follow-up draft for <completed connection>.` Use a channel allowed by that user's preferences.
5. `Show me the saved draft.` Verify it appears on the same website account, with no duplicate on retry. Pending or declined connections must be refused.

For Pre, use an event in Pre with a prepared interest list: `Who should I meet and why?`, then `Favorite <person>`. Check the saved favorite on the website. This needs no GPS.

**Verified primary demonstration (2026-10-04):** the user approved a dedicated `mutuals Fetch Hosted demo` event (`6897a464-75b2-40d3-8dc0-d0c698d0b272`). Two consenting participants joined, the roster was locked and real matches were prepared. The linked ASI chat listed this event, retrieved and explained the actual recommendation, then saved the requested favorite. After a website reload, the favorite checkbox remained selected and both conversation turns appeared in the same account's Pre history. The workflow completed through ASI; the website reload was verification, not a step needed to execute the favorite. Post was not demonstrated because this event has no real completed connections.

| Official mandatory requirement | Evidence to collect |
| --- | --- |
| At least one Agentverse agent | Verified public profile URL for mutuals Networking |
| ACP | Published chat protocol plus real signed request, acknowledgement and response |
| Discoverable and usable through ASI:One | Find/select the actual Agent and receive its reply in ASI:One |
| Meaningful tool execution/orchestration | Live Pre recommendation retrieval and persisted favorite verified; Post role consultations and private drafts covered by integration tests |
| Primary workflow entirely in ASI conversation | Live event query -> recommendation -> saved favorite in one chat after disclosed account authorization; no frontend needed to finish these actions |
| Public source with run/test instructions | Public repo containing the corresponding implementation and this guide |

Website account authorization and joining/preparing the event are prerequisites. Our interpretation is that the primary Pre recommendation/favorite task then completes in ASI:One; organizers determine whether this satisfies their rule. A profile or an ASI API call alone is insufficient evidence. Interactive cards, payment and additional published agents are optional and are not claimed here.

Official requirements: https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack

## Final submission checklist

Submission-ready project fields:

| Field | Value |
| --- | --- |
| Project name | mutuals |
| Public GitHub | https://github.com/maiaPaperTowns/mutuals |
| Published agents | 1 |
| Agent profile URL | https://agentverse.ai/agents/details/agent1q0jxrkgqv7qw75w0z3taze7dl05cpe0s6xcl0ddw0l0vkhvgxr8eccl74h2/profile |

Problem description to paste: **mutuals helps event participants decide who to meet and turn conversations into useful next steps. Its ASI:One agent retrieves personalized event matches, explains recommendations and saves favorites to the participant's authorized website account. The same native backend also supports private post-event follow-up drafts for completed connections.**

Use the actual team's lead name/email and size (1-4 including the lead), not the two-person test event's participant count. Table number and the form's video/profile/shared-chat fields are optional. The user chose to keep the existing private test transcript, including authorization messages; no public shared-chat URL has been generated. Leave uncreated URLs empty rather than supplying placeholders.

Suggested 3-5 minute recording: introduce the event-networking problem (30 seconds); show the Hosted profile and briefly explain the account-authorization prerequisite without displaying the code (45 seconds); in ASI query the event, request a recommendation and save a favorite (90 seconds); reload the website to show persistence (45 seconds); explain the single ACP entry point, native tools and tested privacy boundaries (30 seconds). Use actual actions and disclose that Post requires real completed connections.

- [x] Agentverse Hosted profile published, ACP manifest present, ASI Available; direct ASI:One invocation replies. Actual profile link is above.
- [x] Live routing isolation passed; enable Hosted private access with a dedicated secret. Website binding and unbound-chat denial verified; native tests cover cross-account read/write denial and grant replacement.
- [x] Successful live ASI:One Pre recommendation and favorite, with website persistence verified. Live Post draft demonstration remains separate.
- [ ] Share a successful demonstration with consent and no binding-code messages; copy its actual `https://asi1.ai/shared-chat/...` link.
- [x] Public GitHub contains corresponding code, agent name/address, setup instructions and both badges.
- [ ] Record/upload a 3-5 minute video showing actual actions and account persistence. The Submission Agent form marks its video field optional; the Hackpack requests a video.
- [ ] Submit the project on Devpost.
- [ ] Team lead opens the MHacks Submission Agent, creates a team, fills project/name/email/team size/problem/public GitHub and useful demo/profile/shared-chat links, reviews, and confirms.
- [ ] Copy the returned Team ID. Each declared teammate joins themselves with name/email. Verify **Submitted**, not **Incomplete**.

Count **one** published Agent for this integration. Internal Pre/During/Post roles are described honestly as backend orchestration. Do not put real binding codes, resumes, unshared contact details or raw GPS into public shared chats or videos. Profile links, shared-chat links, video, Team ID and submission status are filled only after their actual creation; no placeholder is evidence of completion.
