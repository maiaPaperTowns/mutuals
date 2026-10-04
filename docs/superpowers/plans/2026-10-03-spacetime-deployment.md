# SpacetimeDB deployment - 2026-10-03

User authorized direct deployment to the configured SpacetimeDB backend.

- Server: maincloud.spacetimedb.com
- Database: mhacks-live-map
- Identity: c20008b72362ea6686de299986f1d8886011f3a65bfb51722fc5099da12257c3
- Dashboard: https://spacetimedb.com/mhacks-live-map
- Publication succeeded with --delete-data=never. No database clearing or record export.
- Source SHA256: 633AD48D0C0AFC0C0AACBCA237351FC7450144B6D8E5FA0761C27ED9335701F2
- Migration repair: agent_profile_json has an explicit none default.
- Compatibility repair: original my_profile retains the same six column names and types; complete private account data uses my_profile_details, still filtered by sender identity.
- Online schema verified: 15 tables, 16 views, ASI service reducers present.
- Online counts: presence 17, participant_owner 3, user_profile 0; unchanged from before publication. New agent_profile and agent_service are empty.
- Anonymous online view checks return zero visible rows for agent_profiles and my_profile_details. No synthetic profiles were inserted into production.
- Verification: 14 module regressions, 9 frontend tests, gateway typecheck, website build, real local HTTP/JWT/gateway/database integration and restart checks passed.
- Full online records were not exported: automatic approval rejected that optional step as outside deployment authorization. Validation used schema and counts instead.
- Python onboarding/model service, gateway runtime and website deployment remain separate. No ASI model credentials or gateway service identity are configured by this database publication.
