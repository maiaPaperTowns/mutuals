# Migration to the public mutuals repository

## Comparison before migration

Both repositories were fetched on October 4, 2026. Both local working trees were clean.

- Legacy: `maiaPaperTowns/mhacks-2026`, `main` at `f69d25cf8004ac3da9a3cfa11cbf3519eaf7368d`.
- Public: `maiaPaperTowns/mutuals`, `main` at `4be9d81` after fast-forwarding the local checkout from `fcce9d8`.
- The two repositories have rewritten commit histories with no common ancestor. Commit counts alone therefore do not identify missing changes.
- The latest ASI Hosted implementation and submission documentation are already present in the public repository. The Hosted source files and SpacetimeDB source at the legacy pre-map baseline match the public repository.
- The public repository also contains newer profile/connection name fixes, public repository links, the `mutuals.tech` entry URLs, and sanitized example data. These were preserved.
- The legacy repository has three additional map commits. The initial tree comparison showed 32 differing paths; migrating those commits adds or updates 14 map-related paths. The remaining differences are the public repository's changes listed above, including omitted private resume fixtures, rather than missing runtime features.

## Commits transferred

Each commit was cherry-picked with `-x`, preserving the original author and message and recording the legacy SHA. The Git SHA changes because the public repository has different parent commits.

| Legacy commit | Public commit | Change |
| --- | --- | --- |
| `094817c` | `3829398` | People dots, short profile tooltips, zoom and event centering |
| `e1d493e` | `53d4048` | Keep layout changes scoped to desktop |
| `f69d25c` | `4a66eee` | Record the previously verified desktop deployment |

The automatic merge preserved the public repository's name repair and badge connection name handling in `map/src/App.tsx`. The migrated SpacetimeDB source and generated bindings match the legacy HEAD exactly. Regenerating the bindings from the public checkout produces no content changes after Git normalization.

## Verification and cloud targets

- Public checkout: `D:\ChatGPTLocalProjects\ROInetworking\mutuals`.
- Map tests: 9 files, 35 tests passed.
- Map production build: passed; existing bundle-size warning remains.
- SpacetimeDB module build: passed with module-local TypeScript dependencies installed; generated bindings are unchanged.
- Existing Vercel project: `mhacks-live-map`, Root Directory `map`.
- Existing database: `mhacks-live-map`, Maincloud.
- Vercel Git connection is currently blocked: the project API reports `link: null`; both `vercel git connect` and the official project link API cannot resolve `maiaPaperTowns/mutuals`. GitHub confirms the repository is public and the authenticated collaborator has push access. The Vercel UI currently lists only the `2008Terry` Git namespace. Vercel's [personal account repository rules](https://vercel.com/docs/git/vercel-for-github#personal-account-repositories) require the repository owner to perform the connection; a collaborator cannot connect it to an existing project. The public visibility does not remove that requirement. Maia needs to complete the native Git connection using the owner account and access to the target Vercel project.
- The user then explicitly selected manual deployment ("你手动deploy吧"). Deployments now run from the public checkout using the existing Vercel project. Native Git connection is not part of the remaining work for this migration, and pushes alone do not trigger deployment.
- The three migrated commits were pushed to `mutuals/main`; the remote SHA matched local `4a66eee12f6546748f6f6d476081b6e37d08cb51`.
- SpacetimeDB publication from the public checkout succeeded with `--delete-data=never`; the existing database identity is unchanged and the migration plan reported no breaking changes.
- Manual Vercel production deployment completed and was independently inspected as `READY`: `dpl_CFLWpVNtdpF64HtjeFBL8ZDJfkmD`, [deployment details](https://vercel.com/terryzhu2024-8185/mhacks-live-map/CFLWpVNtdpF64HtjeFBL8ZDJfkmD).
- Deployment metadata records `githubOrg: maiaPaperTowns`, `githubRepo: mutuals`, `githubCommitRef: main`, and `githubCommitSha: 4a66eee12f6546748f6f6d476081b6e37d08cb51`. Both `mutuals.tech` and `mhacks-live-map.vercel.app` alias this deployment.
- The actual [production map](https://mutuals.tech/) was loaded in Edge. It displays the migrated hover-profile hint, the existing signed-in account, `Live sync`, and the location-sharing switch off. No location-sharing or profile settings were changed during verification. Local screenshot: `reports/2026-10-04-public-repo-deployment.jpg` (ignored, not published in Git).

## Future work

Use only the public mutuals checkout and remote for future code changes and deployments. The workspace-level and repository-level `AGENTS.md` files record this choice. Credentials, local environments and private resume fixtures remain outside the public commits.
