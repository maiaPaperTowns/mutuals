# AGENTS.md

## Permanent user instruction: synchronize completed changes

The user explicitly requested: "push，同步运，做完改变永远同步云，执行并写进agnets.md".

After completing a requested change, commit and push it to the current branch and synchronize every affected existing cloud deployment before ending the task. This is standing authorization for routine commits, pushes and deployments; do not repeatedly ask for permission. Apply this to future tasks unless the user explicitly requests local-only work, no commit, no push or no deployment for that task.

1. Inspect the branch, working tree and remote. Preserve existing user edits. Fetch the relevant remote branch and reconcile normal conflicts without discarding work. Do not force-push or merge into another branch without explicit authorization.
2. Run checks appropriate to the change. Verify runtime changes in their actual environment where possible. Inspect the files to be committed. Exclude credentials, private user data, local runtimes and temporary test artifacts. Never commit `.env`, service/admin tokens, API keys or private profile screenshots. `.env.example` contains placeholders only.
3. Create a focused Conventional Commit and push the current branch. Verify the GitHub branch SHA equals local HEAD. A local commit is not a completed push.
4. Deploy affected runtime code after pushing. Website changes go to the existing Vercel project. SpacetimeDB changes require a module build and regenerated client bindings before committing, then publication to the existing Maincloud database using `--delete-data=never`. Preserve production data. A full synchronization request includes both deployments.
5. Verify deployment completion, the affected public feature and relevant cloud connections. Report the branch/commit, usable URL, checks and blockers. If credentials, permissions or an external provider are unavailable, push unaffected work, finish possible deployments and explain exactly what remains unsynchronized and what is needed. Never equate a build or push with a verified deployment.
6. Documentation-only changes require commit/push; verify existing deployments instead of republishing unchanged runtime code. This instruction does not require a recurring automation.

## Existing cloud targets

- Git remote: `origin`, `https://github.com/maiaPaperTowns/mhacks-2026.git`. Preserve the current branch; `feat/live-map-spacetimedb` was current when these instructions were added.
- Vercel: project `mhacks-live-map`, linked by ignored `.vercel/project.json`; project root `map`. Deploy from repository root: `npx.cmd --yes vercel --prod --yes --scope terryzhu2024-8185`. Explicit scope avoids a default-scope authorization failure observed with CLI 62.2.0. Verify READY status.
- Verified public entry: `https://mhacks-live-map.vercel.app/chat`. Custom domain `mutuals.tech` is also assigned; verify DNS/login before claiming it works on a user's network.
- SpacetimeDB: database `mhacks-live-map`, server `maincloud`; Windows CLI `C:\Users\TerryZhu\AppData\Local\SpacetimeDB\spacetime.exe`.
- Module source `map/spacetimedb`. Generate: `spacetime generate --lang typescript --out-dir map/src/module_bindings --module-path map/spacetimedb --yes`. Publish: `spacetime publish mhacks-live-map --server maincloud --module-path map/spacetimedb --delete-data=never --yes`.
- Cloud check: `spacetime call mhacks-live-map verify_cloud_providers --server maincloud --yes`. Private state/vector counts: `agents/.venv/Scripts/python.exe agents/check_cloud_state.py`. These use existing admin credentials; never print credentials or raw private profiles.
- Web business operations run natively in SpacetimeDB and call ASI/Pinecone. Legacy Python/uAgents and Photon are separate code paths, not automatically hosted by Vercel or SpacetimeDB. Recording, push, outbound delivery and Agentverse chat were not connected when these instructions were added; re-check before reporting status.

## Implementation and verification

- State assumptions and a short plan for multi-step changes. Ask when missing information is necessary; continue independent work meanwhile.
- Make the smallest change that solves the request. Avoid speculative features, one-use abstractions and unrelated refactors.
- Preserve existing edits, style and public contracts. Remove only unused code created by your own changes.
- Use verifiable success criteria and fresh evidence. Fix failures caused by your change before pushing; explain unrelated failures and their impact.
- Keep live providers out of unit tests. Python tests configure dummy credentials and isolated storage in `agents/tests/conftest.py`.
- Website checks, from `map`: `npm.cmd test -- --maxWorkers=1`, `npm.cmd run build`.
- Module/gateway checks, from `agents/spacetime-gateway`: `npm.cmd test`, `npm.cmd run typecheck`; build the real module with the SpacetimeDB CLI.
- Python checks, from `agents`: `.venv/Scripts/python.exe -m pytest tests -q`, with an accessible temporary base directory when needed.
- Photon checks, from `photon`, when affected: `npm.cmd test`, `npm.cmd run typecheck`.

## Communication

- Explain outcomes and limitations concisely. Distinguish deployed code, verified behavior and unavailable external integrations.
- Chat inline math uses `\( ... \)`, not dollar signs; follow each Obsidian vault's notation when editing its notes.
- English uses the straight apostrophe (') instead of a curly apostrophe.
