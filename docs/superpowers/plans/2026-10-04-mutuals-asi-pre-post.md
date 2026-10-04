# mutuals Pre / Post Agent implementation plan

Approved in the task conversation on 2026-10-04. Execute inline with executing-plans.

## Goal and constraints

One ACP-compatible `mutuals Networking` Agent running on Agentverse Hosted, as selected by the user during execution. Existing website users authorize their own account with a five-minute one-time code. ASI:One provides Pre recommendations/favorites and Post recap/private drafts, using existing Maincloud business logic. During remains on the GPS-enabled website. No chat registration, fake Clerk identity, new location mode, or automatic outbound delivery.

Grant: sender/session scoped, 24-hour maximum, one active grant per website account, revocable on the website and via unlink. New sessions rebind. Each transaction rechecks access, including after external model calls. Stable ACP message IDs drive retry-safe turns. Transport identity is never a Clerk ID.

## Tasks

- [x] 1. Hosted ACP runtime: published manifest, acknowledgements, request/session hashes. Two consenting accounts passed live routing isolation; private activation approved and website binding verified. Replay safety verified offline and with real native SDK/HTTP integration.
- [x] 2. Private code/grant tables and dedicated service allowlist; website create/status/revoke procedures and binding panel. Verify expiry, replay, replacement, deletion and cross-account isolation.
- [x] 3. Shared account-resolver-based Pre/Post execution; Hosted Python entrypoint calls native HTTPS procedures. Preserve website contracts, member/phase checks and During GPS guards.
- [x] 4. Offline suites, real local module/SDK/HTTP integration, generated bindings, Maincloud publication with --delete-data=never, existing Vercel deployment, actual website verification. Commit/push current main and verify remote SHA.
- [ ] 5. Agent profile/discoverability, consenting demo accounts, successful Pre/Post shared chats, 3-5 minute video, public corresponding source and README, Devpost plus MHacks submission. Teammates join themselves; verify Submitted.

## Interfaces

Website: createAsiLinkCode(), getAsiLinkStatus(), revokeAsiChatGrant().
Service: redeemAsiLinkCode(code, sessionKey, requestId), getAsiChatContext(sessionKey), sendAsiAssistantMessage(sessionKey,eventId,message,requestId), generateAsiEventRecap(sessionKey,eventId,requestId). JSON string responses match existing module conventions. No userId input; service identity has a separate allowlist and no broad subscriptions.

## Verification

Python ACP tests; gateway/module unit tests and typecheck; map tests/build; isolated real database integration with synthetic providers; live Agentverse and ASI routing; website-to-ASI-to-website persistence. Pending/declined connections cannot produce drafts. Missing GPS does not block Pre/Post. During redirects without mutation. Duplicate messages do not duplicate actions. No claims of successful delivery on failures.

## Submission boundaries

The user selected a Pre-first live demonstration during execution: authorized account -> event query -> recommendation -> saved favorite, entirely in ASI after account authorization and event setup. Post review/drafts remain implemented and tested, with live demonstration requiring real completed connections. Website authorization is disclosed; eligibility is judged by organizers, not guaranteed. Count one public agent, disclose three internal roles. Public source excludes secrets/private data; preserve team private-repo permissions. Check for the existing public team repository before creating a duplicate.

## External completion

Hosted registration/publication, ASI login/routing and private account binding are complete. On 2026-10-04, the user approved a dedicated demo event and a consenting teammate joined. The two-person roster was prepared; the linked ASI chat retrieved real Pre recommendations and saved a favorite, verified after website reload. The user asked to retain the authorization messages; the test chat is retained privately and no public shared-chat link is claimed. Video and actual submission require completion; submission requires real lead details and teammates joining. Record concrete blockers rather than inventing evidence. Agentverse Hosted provides compute; the Windows computer need not remain online.

## Approved hosting change

User explicitly chose Agentverse Hosted during execution. Replace the local Mailbox/loopback runtime in Tasks 1 and 3 with Hosted ACP -> HTTPS native procedures. Account binding, native Pre/Post business logic, During website GPS and live isolation gate remain. Remove obsolete local runtime files; no local-network permission is required.
