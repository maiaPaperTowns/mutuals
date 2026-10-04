# UI clarification follow-up

Branch: `feat/figma-ui-migration`, based on the current `main` used for the initial redesign. The website deployment target remains an independent Preview.

## Clarifications applied

1. The live database contains two MHacks events and `mutuals Fetch Hosted demo` (venue: MHacks integration demo). The demo ID `6897a464-75b2-40d3-8dc0-d0c698d0b272` now shows one [official MHacks photo](https://www.mhacks.org/about/about-02.jpg), a short introduction and its existing integration description. The photo is labeled as a previous edition. The two MHacks records and database descriptions are preserved.
2. Event People is globally ordered by descending saved Fit and displays five at a time. Reserve replaces ranks 1-5 with 6-10, then 11-15; the final group wraps to the beginning. Stars persist between groups. Polls use the requested page and stale responses cannot undo Reserve; if people disappear beyond the current offset, the list returns to the first group.
3. The unresolved whole-card click primarily refers to the **Event page's right-side matches with Fit**. Home's right-side People lists favorites across events and highlights favorites in ongoing events. Existing star/connect controls remain available; no speculative whole-card navigation was added.
4. The mascot clarification maps to the existing Cute/Formal control, which changes the appearance and saves the browser preference. Browser verification is recorded below.
5. Each user + event + role (Pre/During/Post) keeps its own latest **50 messages, combining user messages and assistant replies**. The private view caps existing history immediately; account loading and all message writers trim stored history. Other users/events/roles do not consume this allowance. Temporary replies are acknowledged regardless of whether subscription or procedure response arrives first. Existing retry records remain for idempotency and are separate from visible chat history.
6. Figma connector `whoami` confirms the Gmail Starter/View account, rather than UMich. An already signed-in UMich account is available in Google, but the Figma popup does not complete navigation through browser automation. The login/connector pages are left open for manual completion. Education identity and remaining design comparisons are not verified; additional design reads are paused to avoid consuming this account's quota.

## Verification

- Website: 46 tests passed; production build passed (existing chunk-size advisory).
- Gateway/module: 60 tests and typecheck passed.
- Actual SpacetimeDB module build and binding generation passed; generated bindings were unchanged.
- Actual isolated local SpacetimeDB + generated SDK integration passed, including separate 50-message role histories, physical storage trimming, retry safety, phase guards and privacy. Providers in this test are synthetic; live provider verification is separate.
- Read-only code review identified three timing/pagination issues; all were fixed and re-reviewed without further actionable findings.
- Local browser verified the demo photo, introduction and existing event description from Maincloud.

## Deployment and remaining checks

Runtime deployment results and browser checks will be appended after publication. Main and the production website alias remain outside the requested UI migration target. The message retention rule will apply to the existing shared Maincloud backend when published.

Remaining clarification: what opening an Event match card should show (profile details, connection details, or another existing feature). The distinct Home favorite-card action can be specified separately if desired.
