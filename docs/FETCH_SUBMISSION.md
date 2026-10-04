# mutuals: Fetch.ai submission and operation

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Agent name: **mutuals Networking**

Agent address: `agent1qt6xhqsn53g4fj4w35d45avhlzns79t6qujx2cupyqxjncyp96prc60nfsn`

Website: https://mhacks-live-map.vercel.app/events

Public project source: https://github.com/maiaPaperTowns/mutuals

## What this agent actually does

ASI:One -> signed Agent Chat Protocol (ACP) messages -> Python/uAgents Mailbox transport -> authenticated loopback TypeScript bridge -> native SpacetimeDB procedures -> ASI model API and saved event data.

The Agent runs on our machine/server. Agentverse provides registration, discovery and Mailbox delivery; it does not host this process or our model. The model is accessed through the existing ASI API in SpacetimeDB. The existing Pre, During and Post assistants are internal roles with distinct policies and tools. They are not three separately published Agentverse agents. Post consults Pre/During through the existing native role Q&A; only the single ACP entry point is counted publicly.

Scope: **Pre and Post** in ASI:One. Pre can review an existing event interest list, explain matches, and save favorites without GPS. Post can review completed connections, consult other roles, prepare permitted private follow-up drafts and save them to the same website account. Drafts are not delivered automatically. During asks the user to open the existing website GPS flow; this is outside the primary Fetch demo workflow.

## Account authorization

An ASI account is not a Clerk account. We never treat an Agent address, supplied user ID or username as a website identity.

1. Sign in on the website and save a profile. Join the demo event there.
2. In **Use mutuals in ASI:One**, click **Generate link code**.
3. Open a chat with **mutuals Networking** and send `link <code>`.
4. Send `events`, then `event <event-id>` if you have multiple events.
5. Continue the Pre/Post workflow in that conversation. Results persist in the existing private website tables.

The code expires after five minutes and is single use. A grant lasts at most 24 hours and is scoped to a hash of the Agent's address, signed sender and transport session. A new chat needs a new code; relinking replaces the previous grant. Website **Disconnect ASI:One**, chat `unlink`, account deletion, or expiry removes access. Authorization and phase checks run again after external model calls, before writes. Duplicate ACP message IDs reuse the same backend request ID and saved turn/action results.

Codes, raw chats, private drafts and service credentials are excluded from transport logs. The bridge only listens on `127.0.0.1:8111`, requires its own bearer token, and receives no caller-supplied user IDs. Its dedicated SpacetimeDB identity is allowlisted in `asi_chat_service` and cannot use the existing legacy service profile view. Do not expose this bridge through a tunnel.

## Install and run

Required: Python environment from `agents/requirements.txt`, Node dependencies in `map/`, `map/spacetimedb/` and `agents/spacetime-gateway/`, the configured Clerk website, an existing SpacetimeDB database with ASI/Pinecone provider settings, and Agentverse/ASI:One accounts. Development dependencies and provider keys are not included in the public source.

Copy `agents/.env.example` to server-only `agents/.env`. Generate a distinct random `ASI_NETWORKING_AGENT_SEED`; keeping it unchanged preserves the Agent address. Generate another independent `ASI_CHAT_BRIDGE_TOKEN`. Set `SPACETIMEDB_URI` and `SPACETIMEDB_DATABASE` for the intended deployment. Do not reuse an administrator token as `ASI_CHAT_SERVICE_TOKEN`.

First run in probe mode, without private access:

```powershell
cd agents
.venv/Scripts/python.exe -u asi_networking_agent.py
# ASI_CHAT_ENABLED=false in .env
```

Open the printed Agent Inspector URL, sign in to Agentverse, and connect the Agent using Mailbox. Inspector requires browser permission to access the local listener on port 8007. Configure the profile name, description, README and public repository link. Verify ACP is present and the Agent is discoverable in ASI:One.

**Private activation gate:** using two consenting ASI accounts and two chats, verify different sender/session hashes, stable hashes across turns in one chat, and stable request IDs on transport retries. An unrelated user's chat must not reuse another user's session key. No real binding codes or private data may be sent while this is unverified. A new session is deliberately unbound.

After this passes, obtain a fresh service token from the intended SpacetimeDB server's `POST /v1/identity` endpoint. Keep the returned token in `ASI_CHAT_SERVICE_TOKEN`; using the database owner's CLI, insert only that returned identity into private `asi_chat_service`:

```sql
INSERT INTO asi_chat_service (identity) VALUES (0x<dedicated-service-identity>);
```

Set `ASI_CHAT_ENABLED=true` and run these two processes (or `agents/start_asi_networking.ps1`):

```powershell
cd agents/spacetime-gateway
npm.cmd run start:asi
# In another terminal, from agents:
.venv/Scripts/python.exe -u asi_networking_agent.py
```

The PowerShell launcher hides both process windows and prints owned PIDs. Logs are under ignored `agents/data/asi-runtime/`. It does not install a background service or guarantee uptime; check startup logs, keep the host awake during judging, and stop only the returned PIDs. Changing a seed requires a new registration. Removing the dedicated service identity disables all bridge access. Mailbox alone does not execute code while the host is offline.

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

| Official mandatory requirement | Evidence to collect |
| --- | --- |
| At least one Agentverse agent | Verified public profile URL for mutuals Networking |
| ACP | Published chat protocol plus real signed request, acknowledgement and response |
| Discoverable and usable through ASI:One | Find/select the actual Agent and receive its reply in ASI:One |
| Meaningful tool execution/orchestration | Post role consultations and a persisted private draft, or Pre persisted favorite |
| Primary workflow entirely in ASI conversation | Completed Post review -> prioritization -> saved draft in one chat after disclosed account authorization; no frontend needed to finish these actions |
| Public source with run/test instructions | Public repo containing the corresponding implementation and this guide |

Website account authorization is a prerequisite. Our interpretation is that the primary Post task then completes in ASI:One; organizers determine whether this satisfies their rule. A profile or an ASI API call alone is insufficient evidence. Interactive cards, payment and additional published agents are optional and are not claimed here.

Official requirements: https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack

## Final submission checklist

- [ ] Agentverse profile connected, published and discoverable; copy the actual `/agents/details/agent1.../profile` link.
- [ ] Live routing isolation gate passed; enable the private bridge and verify two accounts cannot read each other's data.
- [ ] Successful ASI:One Pre/Post conversations; share actual chats and copy `https://asi1.ai/shared-chat/...` links.
- [ ] Public GitHub contains corresponding code, agent name/address, setup instructions and both badges.
- [ ] Record/upload a 3-5 minute video showing actual actions and account persistence. The Submission Agent form marks its video field optional; the Hackpack requests a video.
- [ ] Submit the project on Devpost.
- [ ] Team lead opens the MHacks Submission Agent, creates a team, fills project/name/email/team size/problem/public GitHub and useful demo/profile/shared-chat links, reviews, and confirms.
- [ ] Copy the returned Team ID. Each declared teammate joins themselves with name/email. Verify **Submitted**, not **Incomplete**.

Count **one** published Agent for this integration. Internal Pre/During/Post roles are described honestly as backend orchestration. Do not put real binding codes, resumes, unshared contact details or raw GPS into public shared chats or videos. Profile links, shared-chat links, video, Team ID and submission status are filled only after their actual creation; no placeholder is evidence of completion.
