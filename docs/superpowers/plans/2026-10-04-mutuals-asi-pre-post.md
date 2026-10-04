# mutuals Pre / Post Agent implementation plan

Approved in the task conversation on 2026-10-04. Execute inline with executing-plans.

## Goal and constraints

One ACP-compatible `mutuals Networking` Agent registered on Agentverse using Mailbox. Existing website users authorize their own account with a five-minute one-time code. ASI:One provides Pre recommendations/favorites and Post recap/private drafts, using existing Maincloud business logic. During remains on the GPS-enabled website. No chat registration, fake Clerk identity, new location mode, or automatic outbound delivery.

Grant: sender/session scoped, 24-hour maximum, one active grant per website account, revocable on the website and via unlink. New sessions rebind. Each transaction rechecks access, including after external model calls. Stable ACP message IDs drive retry-safe turns. Transport identity is never a Clerk ID.

## Tasks

- [ ] 1. ACP Mailbox runtime: stable secret seed, manifest, acknowledgements, request/session hashes, two-account live routing verification before private activation.
- [ ] 2. Private code/grant tables and dedicated service allowlist; website create/status/revoke procedures and binding panel. Verify expiry, replay, replacement, deletion and cross-account isolation.
- [ ] 3. Shared account-resolver-based Pre/Post execution; restricted loopback TypeScript bridge at port 8111; Python ACP entrypoint. Preserve website contracts, member/phase checks and During GPS guards.
- [ ] 4. Offline suites, real local module/SDK integration, generated bindings, Maincloud publication with --delete-data=never, existing Vercel deployment, actual browser verification. Commit/push current main and verify remote SHA.
- [ ] 5. Agent profile/discoverability, consenting demo accounts, successful Pre/Post shared chats, 3-5 minute video, public corresponding source and README, Devpost plus MHacks submission. Teammates join themselves; verify Submitted.

## Interfaces

Website: createAsiLinkCode(), getAsiLinkStatus(), revokeAsiChatGrant().
Service: redeemAsiLinkCode(code, sessionKey, requestId), getAsiChatContext(sessionKey), sendAsiAssistantMessage(sessionKey,eventId,message,requestId), generateAsiEventRecap(sessionKey,eventId,requestId). JSON string responses match existing module conventions. No userId input; service identity has a separate allowlist and no broad subscriptions.

## Verification

Python ACP tests; gateway/module unit tests and typecheck; map tests/build; isolated real database integration with synthetic providers; live Agentverse and ASI routing; website-to-ASI-to-website persistence. Pending/declined connections cannot produce drafts. Missing GPS does not block Pre/Post. During redirects without mutation. Duplicate messages do not duplicate actions. No claims of successful delivery on failures.

## Submission boundaries

Primary Fetch demonstration: authorized account -> connection review -> prioritization -> selected private follow-up draft saved, entirely in ASI after account authorization. Website authorization is disclosed; eligibility is judged by organizers, not guaranteed. Count one public agent, disclose three internal roles. Public source excludes secrets/private data; preserve team private-repo permissions. Check for the existing public team repository before creating a duplicate.

## External completion

Registration/live routing requires usable Agentverse/ASI accounts. Shared chats/video require actual successful demonstrations; submission requires real lead details and teammates joining. Record concrete blockers rather than inventing evidence. Current Windows host is the first transport host; Mailbox does not provide compute or guarantee continuous uptime.
