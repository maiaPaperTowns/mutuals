# UI follow-up design

User clarification approves these additions on feat/figma-ui-migration; retain Preview deployment and unchanged main.

- Demo is the existing mutuals Fetch Hosted demo (6897a464-75b2-40d3-8dc0-d0c698d0b272), whose venue is MHacks integration demo. Show an official MHacks photo above a short introduction and the existing integration description. Use demo-specific presentation content without a new event schema; preserve the two real MHacks records.
- People uses fixed groups of five, globally ordered by descending Fit. Reserve advances the group; after the final group it returns to the first. Show absolute ranks, retain stars, reset paging when changing event/account. No cumulative Load more and no size selector.
- Each user + event + role conversation retains 50 user/assistant messages combined. Cap reads immediately and trim stored messages upon insertion; preserve completed-turn retry records and action phase safeguards. Test separate roles, events, users, chronology and duplicates. Existing administrative deletion semantics are unchanged.
- The mascot checkbox clarification maps to existing Cute/Formal; verify its persisted switch without adding another checkbox.
- Event match cards are display-only: clicking the card body triggers no action. The user confirmed this behavior; it is no longer unresolved. Existing explicit star/connect/map buttons retain their own actions.
- Confirm Figma connector identity; try the already logged-in UMich account. Verify connector whoami after reauthorization before claiming educational limits. Do not change unrelated account permissions.
