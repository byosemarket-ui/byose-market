# Dashboard Forensic Instability Report

Date: 2026-05-10

## Objective

Investigate and repair the exact cause of the admin dashboard UI appearing briefly and then disappearing or turning blank.

## Exact Root Cause

The disappearing dashboard was caused by the admin auth/session guard, not by the dashboard layout renderer.

### Exact files involved

- `admin/admin-login/js/admin-security.js`
- `admin/app/main.js`

### Exact functions involved

- `protectPage()` in `admin/admin-login/js/admin-security.js`
- `validateSession()` in `admin/admin-login/js/admin-security.js`
- `logout()` in `admin/admin-login/js/admin-security.js`
- `installSessionRefreshGuard()` in `admin/app/main.js` as a secondary trigger path

## Why the dashboard briefly appeared and then disappeared

### Rendering lifecycle sequence

1. `admin/dashboard.html` loaded normally.
2. `app/main.js` bootstrapped and rendered the shell/layout.
3. The dashboard UI became visible.
4. A later session validation pass ran through `AdminSecurity.validateSession()`.
5. That validation hit transport failures or 404 responses from `/admin/session`.
6. `admin-security.js` treated those recoverable validation failures as hard invalidation when no recent `adminLastValidatedAt` grace timestamp existed.
7. The auth guard then redirected away or previously hid the document root, making the dashboard appear to vanish.

### Exact disappearing trigger

The UI was being destroyed by post-render auth validation logic in `admin-security.js`.

It was not primarily caused by:

- sidebar render failure
- layout shell replacement
- CSS `display:none`
- responsive collapse
- route renderer wiping the DOM
- dashboard page cleanup logic

## Forensic Findings

### 1. Auth/session interference was the real instability source

`protectPage()` ran immediately and also on lifecycle hooks such as:

- initial script execution
- `pageshow`
- storage changes

In addition, the app itself ran `validateActiveSession()` from `main.js` on focus.

This means the dashboard could mount successfully and then later be invalidated by a separate auth check.

### 2. Recoverable backend/session-check failures were treated too aggressively

Inside `validateSession()`:

- non-auth failures such as 404/transport errors were classified as recoverable failures
- but if `adminLastValidatedAt` was missing or stale, the code still cleared auth and returned failure
- that failure path caused redirect/teardown even when the locally stored admin session was still structurally valid

### 3. The old guard also hid the whole document root

Before repair, `protectPage()` immediately set:

- `document.documentElement.style.visibility = "hidden"`

and `logout()` also hid the document before redirect.

That made the failure visually look like a blank white screen or disappearing UI, even before or during navigation.

## Deep Scan Coverage

Investigated:

- `admin/dashboard.html`
- `admin/app/main.js`
- `admin/app/components/layout.js`
- `admin/app/core/router.js`
- `admin/app/core/state.js`
- `admin/app/pages/dashboard.js`
- `admin/admin-login/js/admin-security.js`
- `admin/js/core/config.js`
- `admin/js/core/api-client.js`

Browser/runtime investigation checked:

- initial HTML load
- JS bootstrap
- shell injection into `#appRoot`
- route initialization
- dashboard mount
- post-render console/runtime activity
- auth/session validation behavior
- redirects after render
- API failure behavior

## Repair Applied

### File updated

- `admin/admin-login/js/admin-security.js`

### Exact repair

1. Removed document-wide hiding from `logout()`.
2. Removed document-wide hiding logic from `protectPage()`.
3. Changed recoverable validation failure handling inside `validateSession()` so locally valid admin sessions can continue gracefully even when backend/session validation is temporarily unavailable.
4. Added explicit `localSessionStillValid` tracking to the deferred-validation path.
5. Preserved hard failure behavior for definitive auth failures such as 401/403/token-invalid cases.

## Why this fixes the disappearing UI

After the repair:

- shell rendering is no longer visually blanked by `documentElement.style.visibility = "hidden"`
- recoverable `/admin/session` failures no longer wipe out a locally valid admin session immediately
- focus/pageshow/session rechecks no longer destroy the already-rendered dashboard on transport/404 failures alone
- definitive auth failures still redirect as intended

## Verification Results

### Local HTTP verification

A real local HTTP server was used to reproduce the dashboard under a proper origin:

- `http://127.0.0.1:8123/admin/dashboard.html#/dashboard`

Observed after repair:

- dashboard remained visible
- sidebar remained rendered
- header remained rendered
- `.dashboard-grid` remained mounted
- extra wait time did not blank the UI
- a forced focus event did not destroy the UI

### Runtime observations after repair

The page still logged API 404 warnings for missing local backend endpoints during static-server testing.

Those did not remove the dashboard UI anymore.

This confirms the instability was in auth/render lifecycle behavior, not in basic data-fetch failures.

## Final Root Cause Statement

The exact instability root cause was overly aggressive post-render auth/session enforcement in `admin/admin-login/js/admin-security.js`, specifically the combination of:

- `protectPage()` hiding the entire document root
- `validateSession()` converting recoverable `/admin/session` failures into a full invalidation when grace state was absent
- later lifecycle rechecks causing redirect/teardown after the dashboard had already rendered

## Files Repaired

- `admin/admin-login/js/admin-security.js`

## Final Outcome

The dashboard rendering system is now stable under the tested local HTTP lifecycle:

- dashboard stays visible
- sidebar stays visible
- header stays visible
- no post-render wipe was observed in the repaired flow

## Remaining Notes

- The prior syntax error in `admin/app/services/live-feeds.service.js` was a separate blank-page blocker and has already been repaired.
- Local/static testing still shows backend API 404 warnings when no real API server is available. Those affect live data population, not shell stability.