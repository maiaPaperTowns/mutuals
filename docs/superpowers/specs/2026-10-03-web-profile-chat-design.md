# Web Profile Chat

## Goal and scope

Create the user's requested website intake page for resumes and personal introductions. Keep the existing map and account flow. The chat presentation collects profile information; it does not pretend to be a general assistant or claim that a match has been made.

The user explicitly requested implementation. Proceed in this checkout while preserving all earlier uncommitted integration work; do not commit, push or publish to production.

## Design

Add `/chat` with ordinary page navigation to/from the map and a Vercel SPA rewrite for direct visits. Use the current green/white MHacks identity, Manrope display typography, DM Sans body and DM Mono utility text. The signature is a live profile summary alongside a quiet conversational intake thread. On narrow screens the summary collapses behind an accessible control and the composer stays usable with the keyboard open.

Signed-out visitors can understand the page and open the existing sign-in dialog. Signed-in users can submit a PDF or UTF-8 text resume, a free-form introduction, or both. Starter prompts insert editable text. Empty submissions are disabled. Show pending, success and actionable failure states; preserve input on failure. Do not store resume contents or chat transcripts in localStorage.

Reuse the Clerk `spacetimedb` JWT and website profile identity. If a newly signed-in account has no map profile, create its private default profile through `saveMyProfile` using the account display name and visibility false before invoking the ASI API. The API derives user ID from verified authentication rather than accepting a browser-supplied ID, including for legacy-linked accounts.

Use `VITE_ASI_API_URL` for the existing pre-event service, configured by the backend owner. Add `GET /onboarding/profile` returning `{user_id, profile}` with nullable profile, and authenticated multipart `POST /onboarding/input` accepting `message` and/or `file`, returning the persisted `UserProfile`. Add private `introduction` and `resume_filename` metadata to the existing profile payload. Limit messages/cumulative introduction to 10000 characters and resume files to 10 MiB; accept PDF/text only and reject unreadable/empty files. PDF bytes are extracted and sent to the existing ASI profile extraction path, never persisted as raw files. Include prior structured profile context so supplementary inputs preserve existing facts and user preferences. New extracted matching fields are saved through the existing adapter. Return the stored canonical profile after saving.

Configure `WEB_ALLOWED_ORIGINS` on the pre-event service for permitted website origins, including authenticated requests and preflight. The website holds only its public API address and user JWT, never a gateway/service secret.

Direct API submission reuses the existing storage and extraction layer. Writing uploads into SpacetimeDB first would require a new processing queue/file storage; adding a Vercel proxy is unnecessary for this first intake page. Matching continues to consume structured profiles in the existing ASI layer. Presence/check-in, Photon, match UI and provider implementations are outside this feature.

The account display name and any nonempty map headline/interests remain canonical. Empty map defaults preserve private extracted headline/interests rather than erase them. Resume extraction never populates public map fields or changes map visibility automatically. Clearing public map fields does not erase private resume facts.

## Validation

Add meaningful backend regressions for own-account reads/writes, forged user IDs, legacy mapping, repeated introductions, resume validation, provider failure preserving prior records and CORS preflight. Add frontend tests for login gating, bootstrap, multipart/JWT transport, restoration, success acknowledgement, failed requests retaining input, rejected files and mobile composition. Run the full Python suite, map build and shared-module build, plus a rendered browser walkthrough against an isolated local API. External model/network boundaries may be isolated in tests, but label that limit and do not claim live ASI/Clerk production validation.
