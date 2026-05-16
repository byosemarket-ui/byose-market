# Full Forensic Admin Dashboard Blank-Screen Report (2026-05-14)

## Incident Summary
After successful admin authentication, redirect to /admin/dashboard.html could result in an apparent blank/white dashboard state.

## Forensic Scope Covered
- Admin authentication and session flow
- Login redirect chain
- Dashboard boot lifecycle
- Admin shell mount and route rendering
- Runtime crash/failover handling
- Module import and startup dependency review
- Production behavior checks (online)

## Trace: Login to Dashboard
1. Login submit and API call:
   - admin/admin-login/admin-login.js
   - persistSession() stores token/profile
2. Post-login validation:
   - admin/admin-login/admin-login.js -> validateSessionAfterLogin()
   - admin/admin-login/js/admin-security.js -> validateSession(force=true)
3. Redirect:
   - admin/admin-login/admin-login.js -> redirectToDashboard()
   - admin-security redirect fallback also available
4. Dashboard bootstrap entry:
   - admin/dashboard.html loads:
     - admin-login/js/admin-security.js
     - js/core/config.js
     - js/core/api-client.js
     - app/main.js
5. App boot:
   - app/main.js -> bootstrap()
   - ensureAuthenticated() gate
   - renderAppShell(appRoot)
   - startRouter() -> renderRoute()

## Verified Failure Risks (Root Causes)
### RC-1 (Primary Stability Risk): silent startup exits can leave blank shell
- File: admin/app/main.js (pre-fix behavior)
- Condition: early bootstrap returns (auth fail or mount issues) could stop lifecycle before shell mount and before visible fallback UI.
- Impact: users can observe blank/empty viewport during or after startup interruption.

### RC-2 (Production Path Robustness): non-canonical login redirect target
- File: admin/admin-login/js/admin-security.js
- Old target: /admin/admin-login.html
- Canonical login page in this architecture: /admin/admin-login/admin-login.html
- Impact: deployment/path drift risk across environments.

### RC-3 (Production Realtime URL bug): duplicated /api segment
- File: admin/app/services/realtime-sync.service.js
- Old SSE URL construction: ${apiBase}/api/realtime/stream
- With apiBase already ending in /api, resolved URL became /api/api/realtime/stream
- Impact: repeated transport failures/noise and unstable realtime layer in production.

## Fixes Applied
1. Startup failover hardening:
   - admin/app/main.js
   - Added mountBootstrapFailure() to render visible fallback UI in appRoot/content.
   - Added handleBootstrapFailure() to avoid silent failure.
   - Added global error/unhandledrejection guards for startup/runtime interruptions.
   - bootstrap() now throws when #appRoot is missing instead of silent return.
   - Auth-gated exit now shows explicit fallback message before redirect path completes.

2. Auth redirect canonicalization:
   - admin/admin-login/js/admin-security.js
   - getLoginUrl() now points to /admin/admin-login/admin-login.html

3. Realtime endpoint correction:
   - admin/app/services/realtime-sync.service.js
   - SSE path corrected to ${apiBase}/realtime/stream

## Dangerous/Broken Code Removed or Replaced
- Replaced silent bootstrap failure pattern with explicit failure rendering and centralized error handling.
- Replaced non-canonical auth login redirect path with canonical route.
- Replaced duplicated /api realtime stream path construction.

## Auth/Session Compatibility Assessment
- Login flow remains unchanged in core behavior (persist -> validate -> redirect).
- Session guard remains active.
- Guard failures now degrade visibly rather than appearing as unexplained blank state.

## Shell Rendering Guarantees Added
- If startup fails, appRoot now receives explicit fallback UI.
- If shell renders, route failures are still isolated to content area.
- Goal achieved: no silent blank-screen startup path.

## Production/Online Forensic Observations
- Online dashboard was reproducible with shell rendering under authenticated localStorage simulation.
- Significant production API 404 activity observed, including realtime URL duplication issue fixed in code.
- Could not perform credentialed end-to-end login in this session (no credentials provided).

## Verification Performed
- Static forensic trace across auth, dashboard boot, routing, shell rendering, and services.
- Edited files pass diagnostics check (no new file-level errors reported by workspace diagnostics tool).
- Production runtime observation performed for dashboard behavior and network/runtime signals.

## Verification Limitations
- Full credentialed login test was not executed in this session.
- Local static server test via python was unavailable on host (python not installed in this environment).

## Final Result
The admin dashboard architecture is now hardened against silent startup failures and production path instability linked to blank-screen perception. Startup and runtime errors now surface a visible fallback instead of leaving the interface empty.