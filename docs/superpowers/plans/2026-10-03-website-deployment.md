# Website production deployment - 2026-10-03

User explicitly requested publication of the profile chat page.

- Production chat: https://mhacks-live-map.vercel.app/chat
- Production map: https://mhacks-live-map.vercel.app/
- Vercel project: mhacks-live-map (prj_mCCtiBtog5ZwrOcpLm9VgmgWwg8U)
- Deployment: dpl_4wte1oWWjj4k8NQ386yJ8TAMSy8S, READY
- Immutable deployment: https://mhacks-live-na0kmi81c-terryzhu2024-8185.vercel.app
- Existing public Clerk publishable configuration added to Production. It is the existing development instance; no secret key was placed in frontend settings.
- Website source upload excludes backend, tests, local runtime files and environment files through .vercelignore. First attempt uploaded no application files due to ignore rules and failed before replacing production; corrected rules verified 67 entries and published successfully.
- Verification: 9 frontend tests passed, production build passed locally and on Vercel. Direct online /chat renders; Clerk registration form renders; map reaches Live sync; My profile navigation returns to /chat.
- Backend intake URL is not configured in Production. Python/gateway runtime and ASI1 credentials remain pending; live upload/extraction/storage was not claimed or verified by this frontend deployment.
- Database module was already deployed to mhacks-live-map on maincloud. No Git commit or push was performed.
