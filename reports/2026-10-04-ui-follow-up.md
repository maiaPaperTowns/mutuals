# UI clarification follow-up

Branch: `feat/figma-ui-migration`, initially based on `main` at `10f350a`. The website deployment target remains an independent Preview. A fresh fetch found that another contributor has since merged the initial UI migration into `main` (`5df31e7`); remote main currently points to `ece1eed`. This follow-up did not modify or push main.

## Clarifications applied

1. The live database contains two MHacks events and `mutuals Fetch Hosted demo` (venue: MHacks integration demo). The demo ID `6897a464-75b2-40d3-8dc0-d0c698d0b272` now shows one [official MHacks photo](https://www.mhacks.org/about/about-02.jpg), a short introduction and its existing integration description. The photo is labeled as a previous edition. The two MHacks records and database descriptions are preserved.
2. Event People is globally ordered by descending saved Fit and displays five at a time. Reserve replaces ranks 1-5 with 6-10, then 11-15; the final group wraps to the beginning. Stars persist between groups. Polls use the requested page and stale responses cannot undo Reserve; if people disappear beyond the current offset, the list returns to the first group.
3. The user confirmed that clicking the **Event page's right-side match card body** must trigger no action. Source inspection confirms the card has no click handler, link or button semantics, so the current Preview already matches this requirement. Existing explicit star/connect/map buttons retain their own actions. Home's right-side People lists favorites across events and highlights favorites in ongoing events.
4. The mascot clarification maps to the existing Cute/Formal control, which changes the appearance and saves the browser preference. Browser verification is recorded below.
5. Each user + event + role (Pre/During/Post) keeps its own latest **50 messages, combining user messages and assistant replies**. The private view caps existing history immediately; account loading and all message writers trim stored history. Other users/events/roles do not consume this allowance. Temporary replies are acknowledged regardless of whether subscription or procedure response arrives first. Existing retry records remain for idempotency and are separate from visible chat history.
6. Figma connector `whoami` confirms the Gmail Starter/View account, rather than UMich. An already signed-in UMich account is available in Google, but the Figma popup does not complete navigation through browser automation. The login/connector pages are left open for manual completion. Education identity and remaining design comparisons are not verified; additional design reads are paused to avoid consuming this account's quota.

## Verification

- Website: 46 tests passed; production build passed (existing chunk-size advisory).
- Gateway/module: 60 tests and typecheck passed.
- Actual SpacetimeDB module build and binding generation passed; generated bindings were unchanged.
- Actual isolated local SpacetimeDB + generated SDK integration passed, including separate 50-message role histories, physical storage trimming, retry safety, phase guards and privacy. Providers in this test are synthetic; live provider verification is separate.
- Read-only code review identified three timing/pagination issues; all were fixed and re-reviewed without further actionable findings.
- Local browser verified Cute -> Formal -> refresh (Formal remains selected) -> Cute; appearance and wording change as expected, and the initial Cute preference was restored.
- New Preview browser verified the demo photo, introduction and existing event description from Maincloud. At a 390px viewport, the 1600px image loads and the document remains within viewport width; the temporary viewport override was reset.

## Deployment and remaining checks

- Runtime commit `52a29043e61018bca7aed070f161bf49056d7413` was pushed and the remote branch SHA matched.
- SpacetimeDB published to existing Maincloud `mhacks-live-map` with `--delete-data=never`; no schema migration was required. The 50-message rule applies to this shared backend.
- Live `verify_cloud_providers` passed: ASI, 1024-dimensional embeddings, Pinecone write/fetch/query, similarity and probe cleanup.
- [New Preview](https://mhacks-live-x9oc2o7it-terryzhu2024-8185.vercel.app/events?event=6897a464-75b2-40d3-8dc0-d0c698d0b272): deployment `dpl_85mewYmYh25jwKwoxzZBrv2Zc57V`, independently inspected as READY with target preview. The first CLI attempt returned a transient authorization error; account/project checks passed and the explicit deploy retry succeeded.
- `mutuals.tech` still aliases production deployment `dpl_CFLWpVNtdpF64HtjeFBL8ZDJfkmD`. The follow-up did not promote this UI to production.
- Figma education reauthorization and the previously quota-blocked expanded design comparison remain incomplete pending manual school-account login. No credentials, private screenshots or temporary runtime files were committed.

The Event match-card click item is resolved and removed from the clarification list. Only the Figma account/design comparison blocker described above remains pending for this follow-up.
