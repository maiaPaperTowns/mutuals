# Personal event agent exchange and automatic recap

The user wants Pre, During and Post to exchange information, with Post producing a recap of connections, common interests and contact opportunities. They selected automatic recap when entering Post.

Use the existing ASI/SpacetimeDB runtime and add no dependencies. Each role can ask another registry role a read-only question. Post's recap always consults Pre and During in separate ASI requests and combines their replies. Colleagues see only the caller's matching event history, own profile and permitted connection facts. Persist exchanges privately and show the question/answer trail.

During saves explicit request, accepted/declined and finished-chat facts. Keep pending, accepted and completed states distinct. Do not fabricate conversation content. Recap is read-only and cached for unchanged connection history; completed colleague exchanges survive retries. Validate the caller's membership and active source phase before and after provider calls. Inactive roles can answer historical questions without performing actions.

Provide an optional LinkedIn URL with explicit event-specific sharing consent. Only accepted/recorded/completed connections can view a shared link. Read links live through caller-scoped views, separately from generated text, so withdrawal removes them. Do not send other people's contact URLs to ASI. Event deletion and account deletion clean up owned data.

Verification covers actual separate ASI request payloads, caller/event isolation, generic colleague questions, phase changes during a call, non-mutating automatic recap, retry caching, revised history, StrictMode auto-call deduplication, contact sharing and withdrawal. Run frontend/backend suites, real module build and isolated real SpacetimeDB + SDK integration, then push and publish both affected existing cloud deployments without deleting production data.
