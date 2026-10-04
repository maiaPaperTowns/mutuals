# Automatic During and administrator event phases

The user requests immediate implementation of the main flow and explicitly permits removing incidental detail. Reuse the current event roster, Pre comparison, ASI assistants, private GPS and notifications.

- Pre freezes the joined roster and stores each directed pair's Fit, ROI and reason in SpacetimeDB. During never recomputes pair ROI.
- The administrator can edit event metadata, delete an event and set its persisted phase to pre/during/post. Switching to During requires prepared lists; switching out of During stops GPS discovery. Returning to Pre preserves the frozen roster and existing scores.
- Entering During starts browser GPS permission/updates automatically for a member. No area, availability or check-in form. Location updates establish presence; connection state derives free/busy on the server. GPS remains explicitly stoppable and is removed when the page closes or data expires.
- Nearby means the existing 100 metre GPS threshold with fresh accurate positions. Use all saved eligible matches (Fit >=35) plus favorites. Only two free participants get nearby alerts. Include stored fit/reason and profile-based conversation topics. Website popups and inbox are the required notification surface; closed-page push is outside scope.
- A requested connection does not make someone busy. Acceptance atomically makes both busy; one person cannot accept two overlapping chats. Repeated/reversed requests are idempotent. Three-person tests cover this, rather than adding group conversation UI.
- Either participant can end an accepted chat. Store completed, restore free only if no active connection remains, invalidate relevant nearby cooldowns and notify newly available nearby matches in both directions. Completed connections remain usable in Post.
- Event deletion removes its roster snapshots, comparison lists, GPS/schedules, favorites, messages, notifications, connections, transcripts, plans, history and Pinecone event namespace. Keep personal profiles and other events.

Verification: module unit tests including saved-score stability, automatic presence, busy suppression, three-person races, ending/re-notification, admin authority and deletion isolation; website tests for popup/no manual controls/end/admin tools; real isolated SpacetimeDB three-client integration; builds; fresh reviewer; push existing branch and publish both existing deployments without deleting production data.
