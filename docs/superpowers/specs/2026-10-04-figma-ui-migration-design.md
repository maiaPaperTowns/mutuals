# Figma UI migration

The user authorized implementation of the existing Figma redesign, with ambiguous feature mappings deferred for review. Work starts at main commit `10f350a06ed1cd9db78f753625d1987b7e6b9815`, on `feat/figma-ui-migration`. Publish a Vercel Preview; keep the production UI unchanged.

Source: https://www.figma.com/design/T9gwgiWFWFmgf48D4xF7Yp?node-id=0-1
Retrieved high-fidelity context and screenshots: home `16:2`, profile `14:2`, event `83:373`, accordion `68:52`. Starter MCP quota prevented retrieving the standalone expanded People component and mobile context.

## Confirmed mapping

- Home keeps Leaflet, points/mascot, opt-in GPS, badge and Cute/Formal behavior. Left accordions list actual events and account-owned event agents. The right account banner opens a saved-profile dropdown and links to the profile builder.
- Home People lists the caller's starred people across events, deduplicated by user ID. An event is ongoing when its existing server phase is `during`; highlight favorites belonging to an ongoing event, without treating their GPS presence as required. Use member-scoped interest lists for names rather than exposing private profiles.
- Event detail uses existing title, description, venue, time and area map on the left; saved Pre rankings on the right, descending Fit. Joining, roster lock, admin controls, GPS, notifications, connection consent, recaps and follow-up drafts retain their original behavior.
- `/assistant` provides one account-owned place for all event/role threads, readable and usable across event phases. Messages remain persisted in existing private SpacetimeDB tables. Remove chat/consultation phase gates; keep membership checks, role allowlists, retry IDs, and phase requirements for time-sensitive actions.
- Profile builder becomes a wide saved profile on the left and narrower assistant/upload composer on the right. Intake API and data model remain unchanged.

## Deferred mappings

- Event images and Other information have no fields in the existing event model. Keep the existing area map and known event metadata instead of adding speculative storage.
- Event People `Reserved` button and possible person-profile links have no confirmed operation. Omit them pending user review.
- No separately defined mascot-checkbox behavior is visible in the retrieved design. Preserve points, mascot, badge and existing style control; do not invent a new checkbox.
- Event deletion currently deletes event chat records. The user requested persistent chats across phases, but did not specify a new admin-deletion retention policy. Leave deletion semantics unchanged and surface this for review.
- Formal and expanded People visual variants lack retrieved high-fidelity context. Preserve existing Formal behavior; implement the explicitly described People data behavior and flag visual fidelity for review.

## Verification

Exercise cross-phase agent selection and sending, account isolation and retry behavior, descending Fit, cross-event favorite deduplication/highlighting, Profile intake regression, and responsive layouts. Run website tests/build and module/gateway tests/typecheck/build. Regenerate bindings if module publication requires it. Push the branch, verify remote SHA, deploy Preview, verify its live pages and cloud connection. Publish compatible module changes without deleting production data.
