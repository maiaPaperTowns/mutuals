# Event area and map reset

The requested feature lets an administrator mark a separate area for each event. Public activity maps show the saved polygon, and Reset view fits its full extent. The home map shows all saved event boundaries and resets to their combined extent. The open MHacks invitation gets an approximate North Campus polygon around Duderstadt/Pierpont.

Use the existing React Leaflet and SpacetimeDB stack; add no dependencies. Draw by clicking 3–50 boundary points in order, with undo, cancel, save and clear controls. Save errors retain the draft. Existing GPS privacy, matching and invitation contracts remain intact.

Store area JSON in a separate table keyed by event ID. Only provisioned administrators may write it. Validate coordinates, point count and nonzero enclosed area. Publish only boundary geometry through an anonymous view. Event deletion removes its boundary and preserves other events.

Verification: backend authorization, validation and deletion isolation; actual Leaflet drawing, undo, reset bounds and retry; public/admin page controls; frontend and module builds; cloud publication without deleting data; production browser display and reset.

Execution: implement and test the backend, regenerate bindings, add the shared polygon/reset layer and admin editor, run full affected checks, push the current branch, publish both affected runtimes and set the open MHacks area's initial boundary.
