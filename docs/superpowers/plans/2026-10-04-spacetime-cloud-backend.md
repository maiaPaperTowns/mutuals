# SpacetimeDB cloud backend execution

Spec: ../specs/2026-10-04-spacetime-cloud-backend-design.md

User chose direct SpacetimeDB hosting and authorized deployment and end-to-end verification. Execute in the current feature branch, preserving all existing work and without a Git commit or push.

1. Add cloud provider configuration, probes and authenticated intake. Verify: failing then passing module tests for authorization, private configuration, canonical fields, outages and delayed/deleted records; build the real module.
2. Port current scoring and networking operations. Verify: Python/TypeScript scoring parity, opt-in/stale presence, participant ownership and private follow-up drafts.
3. Switch website intake to procedures and local PDF/TXT parsing. Verify: frontend regressions, unreadable files, bounded text and production build.
4. Publish module with `--delete-data=never`, provision private provider configuration and call administrator synthetic probes from Maincloud. Verify: actual provider responses and cleanup; no credentials in public output.
5. Publish Vercel website and test signed-in browser save/refresh. Verify: live rendered success plus private storage; document all remaining provider and UI gaps.

Review focus: anonymous provider use, credential leakage, concurrent update/deletion, empty/unindexed activity catalog, false claims that a saved draft was sent.

Initial evidence: website and database already public; web intake API URL absent; ASI API direct connectivity passed; Pinecone direct connectivity passed in the prior task. ASI chat transport, Photon credentials and recording/outreach implementations remain missing.

Execution ledger:
- Task 1: complete. Private `cloud_provider_config`, `cloud_admin`, `cloud_operation` published with `--delete-data=never`; provider values provisioned privately. Final Maincloud probe returned ASI success, 1024 dimensions, Pinecone write/fetch/query success, self-similarity 1 and cleanup_verified=true.
- Task 2: complete and published. Native event recommendation/upsert, opt-in presence/checkout, opportunities, requests/responses, private follow-up drafting/preferences/approval/outcomes, and account deletion. Final 30 module/scoring tests pass; seven scenarios preserve original Python ROI scores, breakdowns and reasons. Module build and gateway typecheck pass.
- Task 3: complete. Native webpage procedures and browser PDF/TXT parsing (PDF.js 6.4.299); new collapsible networking panel with explicit check-in/out, matches, activity ranking, request responses and unsent draft display. Final 17 frontend tests and production build pass. Original HTTP adapter retained for existing preview/tests. PDF upload itself was not live tested; no OCR implementation.
- Task 4: complete. Final module published to `mhacks-live-map` Maincloud without deleting data. Anonymous administrator probe/profile read are rejected and private configuration table is inaccessible. Real private profile state is indexed and its Pinecone vector is fetched successfully by `agents/check_cloud_state.py`; no profile contents or credentials are printed.
- Task 5: complete on the existing public vercel.app domain. Final Vercel deployment `dpl_EcgpSV1VHHMmsDssuQ7un6zuCxCb`, READY. Signed-in save and restoration passed for factual project introduction. Native browser check-in changed cloud presence count 0→1; checkout returned it to 0. Both match and activity procedures returned truthful empty results. Saved screenshot `reports/cloud-backend-browser-proof.jpg`.
- Final reviewer `/root/cloud_review`: identified and verified fixes for map-only deletion and checkout/in-flight heartbeat race. Regression tests cover both; reviewer reports no additional Important findings. No Git commit or push; preexisting user work retained.
- New primary alias `https://mutuals.tech` has a remaining DNS propagation/cache issue on this computer. Browser ERR_NAME_NOT_RESOLVED; default DNS returns old SOA without A. Public DNS 1.1.1.1 returns 216.198.79.1 and 64.29.17.1; Vercel nameservers match; HTTPS /chat with resolved IP and full TLS verification returns 200. Primary-domain complete login has not been tested. The existing vercel.app domain is the verified usable entry point.
- Remaining product gaps: real activity catalog empty; no second real-account pairing/draft test; preference/approval/outcome/deletion interfaces have no website controls; external recording/push/outreach stubs; Photon credentials/bridge persistence/identity adaptation and receiver runtime missing; Agentverse transport not connected. Report exact requirements in `reports/云端后端连接验收报告.md`.
