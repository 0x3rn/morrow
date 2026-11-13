# Morrow security review

Scope: code-level review of `app/api/**`, server actions, `lib/**`, `worker/**`, `next.config.ts`, auth configuration, webhooks, outbound fetches, SQL, rendering of fetched content, headers and dependencies. All testing was local (unit and integration tests against SQLite/mocks, plus a local `vinext dev` run). Nothing was sent to production or staging, no `--remote`, no deploy.

Rules followed during the review: no edits to migrations and no new migrations. The follow-up pass (see "Resolution") then fixed the remaining items that were safe to change and recorded a decision for each one that was not.

## Verdict

Ready. Authorization, SQL parameterisation, webhook signature handling and output escaping are in good shape, and the three launch-deciding items below are resolved (details under "Resolution"):

1. Vulnerable framework dependencies (React Server Components RCE advisory, Next.js): upgraded. The only critical advisory left is better-auth's OAuth Proxy, a plugin this app does not use.
2. Telegram endpoints accepted unauthenticated requests when `MORROW_TELEGRAM_WEBHOOK_SECRET` was not set: they now fail closed (503).
3. Better Auth fell back to a public default secret and a `http://localhost:3001` base URL when the env vars were missing: production now refuses to start without both. Both are set in production and staging (secret names checked with `wrangler secret list`; values never read).

## Summary table

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | High | Vulnerable dependencies: react-server-dom-webpack (critical RCE), next, better-auth, vite, undici, zod | Fixed (better-auth: not applicable, pinned) |
| 2 | High | SSRF: user URLs (competitor domain, monitored page, favicon, selector-test fetch, Slack/webhook destinations) could target internal hosts; unbounded redirects and bodies | Fixed |
| 3 | Medium | Telegram webhook and link endpoints fail open when the secret is unset | Fixed |
| 4 | Medium | No security headers (CSP, HSTS, frame-ancestors, nosniff, Referrer-Policy, Permissions-Policy) | Fixed |
| 5 | Medium | Better Auth uses the library default secret when `BETTER_AUTH_SECRET` is absent outside `NODE_ENV=production`; local base URL fallback disables Secure cookies | Fixed |
| 6 | Medium | Sign-up reveals whether an email is registered; unverified accounts can squat an email | Accepted risk (decision recorded) |
| 7 | Low | `/api/db-test` was reachable without authentication | Fixed |
| 8 | Low | Telegram secret compared with `!==` (timing) | Fixed |
| 9 | Low | CSP keeps `script-src 'unsafe-inline'` (no nonce) | Follow-up |
| 10 | Low | `/api/telegram/link` has no rate limit and no in-repo caller | Mitigated (secret required, fails closed) |
| 11 | Low | Telegram `@username` linking trusts handshake rows (no proof the user owns the username) | Accepted risk (decision recorded) |
| 12 | Low | Runtime `CREATE TABLE IF NOT EXISTS` for Telegram tables outside migrations | Accepted (no security impact; deferred) |
| 13 | Low | Webhook and bot secrets stored in plaintext in `config_json` | Accepted risk (decision recorded) |
| 14 | Low | Lemon Squeezy webhook reads an unbounded body before signature check | Fixed |
| 15 | Low | Slack mrkdwn built from competitor page text is not escaped | Not a finding (already escaped) |
| 16 | Low | 2FA email code search space is limited per IP only (lockout exists) | Info |
| 17 | Info | Error sanitiser is a deny-list | Info |

## Fixed (with tests)

Each fix has a commit and a `node --test` file that failed before the change.

### [High] 2. SSRF in monitoring, favicon, selector testing and outbound webhooks
Where (before): `app/dashboard/competitors/actions.ts` `normalizeDomain` and `findFaviconUrl` (fetch of `https://<user domain>` with redirects followed and any `http(s)` favicon URL stored); `app/dashboard/competitors/[competitorId]/actions.ts` `normalizeMonitoredUrl` (only the scheme was checked) and `loadMonitoredPageHtmlForAnalysis` (`fetch(pageUrl)` with automatic redirects and unbounded body, response text returned to the user through section scan and selector test); `worker/index.ts` `captureRenderedPage` (`page.goto(stored url)`); `worker/external-delivery.ts` `assertHttpsUrl` (Slack, webhook and Telegram API base URL accepted `https://127.0.0.1`, `https://169.254.169.254`, `https://localhost`).
Evidence: `tests/url-safety.test.mjs` "webhook and Slack URLs cannot target internal hosts" failed on the old `assertHttpsUrl`. `tests/monitoring-ssrf.test.mjs` "server actions and the capture worker route outbound fetches through the SSRF guard" failed before the wiring commit.
Impact: a tenant could make Morrow fetch internal or metadata addresses, read the response (section scan, selector preview) or fire POSTs at internal services. Cloudflare Workers cannot reach most private ranges, which limits the blast radius, but the missing check is still an SSRF and also allowed redirect chains and very large bodies.
Fix (commits "block private and internal hosts in outbound webhook URLs" and "stop user-supplied domains and page URLs reaching internal hosts"): new `lib/url-safety.ts` (loopback, RFC1918, link-local and metadata, CGNAT, multicast and reserved IPv4; IPv6 loopback, ULA, link-local, mapped, NAT64, 6to4; internal suffixes; single-label names; credentials; IP forms normalised by the URL parser), `lib/competitor-favicon.ts`, and `fetchPublicText` which follows at most 3 redirects manually, re-validating every hop, with a 2 MB body cap. Competitor domains and page URLs are validated on input and page URLs are validated again at capture time and after redirects.
Limits: validation is by hostname and IP literal. It cannot see DNS answers, so a public name that resolves to a private address is not detected by the code; this relies on the Workers network not routing to private space. Existing rows are not rewritten.
Behaviour change to know about: users can no longer add `localhost`, IP-address or internal-name competitors/pages, or webhook URLs on such hosts. The error text is "Enter a public website domain such as example.com." or "... must point to a public website, not a private or internal address."

### [Medium] 4. Security headers
Where: `next.config.ts` had no `headers()`.
Evidence: `tests/security-headers.test.mjs` failed (3 of 3) before. Local `vinext dev` response headers and the built `dist/server/index.js` both contain the set (HSTS present in the production build only).
Fix: for every path set `Content-Security-Policy` (`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `connect-src 'self'`, `img-src 'self' data: blob: https:` because competitor favicons load from their own sites, `upgrade-insecure-requests` in production), `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (production), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment and others disabled), `Cross-Origin-Opener-Policy: same-origin`. The pages checked locally load no third-party scripts or styles.
Verify after deploy: open the login, register, dashboard, billing (checkout redirect) and notifications pages in a browser and confirm the console shows no CSP violations. `preload` in HSTS means the domain can be submitted to the preload list; remove `preload` if that is not wanted.
Note on `wrangler.jsonc`: production deploys read it. The final commit does not change it. During the review I temporarily removed the `browser` and `ai` bindings (both connect to Cloudflare remotely in `vinext dev`) from the local file to run the dev server without touching Cloudflare, then reverted it with `git checkout`. Any header change must be verified in the production build (done here for the header set: `npm run build` output contains it).

### [Low] 7. Unauthenticated `/api/db-test`
Where: `app/api/db-test/route.ts` ran `SELECT 1` on the D1 binding for any caller.
Fix: route removed. `tests/security-routes.test.mjs` fails if a debug-like route exists and pins the reviewed route inventory, so a new handler needs a conscious update.

### [Low] 8. Non-constant-time Telegram secret comparison
Where: `lib/telegram-bot.ts` webhook and link handlers used `providedSecret !== configuredSecret`.
Fix: `telegramSecretMatches` hashes both values and uses `timingSafeEqual`. `tests/telegram-webhook-auth.test.mjs` failed before (missing export) and now covers wrong, missing and correct secrets for both handlers.

## Resolution

Decisions made in the follow-up pass, in finding order:

- **1 Dependencies (fixed).** react, react-dom and react-server-dom-webpack 19.2.8 -> 19.2.9, next 16.3.3 -> 16.4.6, vite/zod/source-map-js/fast-uri updated within range, undici forced to ^7.30.2 through `overrides`. `better-auth` stays pinned at exactly 1.7.2 on purpose: 1.7.3 and later refuse the `accounts.issuer` column that 1.7.0-1.7.2 created (`Database schema mismatch ... unexpected-required-column`), so upgrading needs a production schema migration following Better Auth's 1.7 upgrade guide. The advisories that remain (OAuth Proxy sign-in, Postgres/Drizzle adapter rate-limit race) only affect plugins and adapters this app does not use: it imports only `emailOTP` and `twoFactor` and runs on D1. Remaining `npm audit --omit=dev`: the better-auth item above plus 3 moderate (vinext -> @vercel/og -> satori SVG escaping, reachable only through OG image generation, which this app does not use; the fix needs a vinext major jump that requires React 19.3). Revisit when planning the better-auth migration.
- **3 Telegram (fixed).** Both handlers return 503 when no secret is configured. Production has the secret. Staging has none, so its Telegram endpoints now refuse requests, which is correct for an unconfigured bot. Test: `tests/telegram-webhook-auth.test.mjs`.
- **5 Auth defaults (fixed).** With `NODE_ENV=production`, `createMorrowAuth` throws if no base URL or no secret is configured. Production and staging both have `BETTER_AUTH_SECRET` and `MORROW_APP_URL`. Development stays zero-config. Test: `tests/auth-config-production.test.mjs` (2 of 4 tests fail without the fix).
- **6 Email enumeration (accepted).** The "already exists" response is a deliberate product choice, sign-up is limited to 3 requests per minute per IP, and an unverified account cannot sign in. A non-enumerating flow changes the sign-up and verification UX and could not be tested against real email delivery here, so it is not changed. Revisit together with the better-auth schema migration.
- **10 /api/telegram/link (mitigated).** The route requires the shared secret and fails closed. It is kept because an external bot service may call it.
- **11 Telegram username linking (accepted).** Alerts only go to a chat that has started the bot, workspace admins choose the destination, and forged handshakes are blocked now that the webhook requires its secret.
- **12 Runtime DDL (accepted).** Idempotent `CREATE TABLE IF NOT EXISTS`; moving it to a migration has no security effect and adds a production migration step, so it is deferred.
- **13 Plaintext channel secrets (accepted).** Encrypting `config_json` needs a new key and a data migration. The values are never returned to the client. Revisit with the better-auth migration.
- **14 Webhook body (fixed).** Bodies over 1 MiB are rejected with 413 before signature verification, by `Content-Length` and by a bounded read. Test: `tests/lemonsqueezy-webhook-limits.test.mjs` (2 of 3 fail without the fix).
- **15 Slack escaping (not a finding).** `escapeSlackMrkdwn` already escapes `&`, `<` and `>` on every page-derived field in `worker/external-delivery.ts`.

The sections below keep the original analysis for reference.

## Original analysis of items not fixed in the first pass

### [High] 1. Dependencies
Evidence: `npm audit --omit=dev` reports 13 issues (3 critical, 6 high). Relevant:
- `react-server-dom-webpack` 19.2.8 (range 19.2.0-19.2.8): unauthenticated RCE in React Server Components (GHSA-xqc2-xf4c-x3h3). The app runs RSC and server actions through vinext, so the server-action endpoints are the exposed surface. `package.json` pins `^19.2.8`.
- `next` 16.3.3: critical RCE advisories in image optimisation and `use cache` (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr), SSRF in image optimisation, server action DoS. Mostly in Next.js server code paths that vinext replaces, so reachability is lower; still upgrade (fix reported: 16.4.6).
- `better-auth` 1.7.2: OAuth state used as magic link sign-in (GHSA-965c-763c-88jm, critical) and OAuth proxy sign-in (GHSA-r4xp-prcw-77qf, high). The app uses only email and password plus email OTP, so these code paths are probably not reachable, but the patched 1.7.x should be taken (latest 1.7.22 at review time). Also a rate-limit race advisory affects the database adapter.
- `vite` 8.2.x (dev-server advisories, not production), `undici`, `zod`, `sharp`: transitive or dev-time.
Fix: upgrade react, react-dom and react-server-dom-webpack together to a patched 19.2.x (or the version `npm audit fix` selects), upgrade better-auth to the latest 1.7.x, then run the full test, build and a manual login, billing and notification check. Not done here because installs would change the shared `node_modules`.

### [Medium] 3. Telegram endpoints fail open
Where: `lib/telegram-bot.ts:1516` (`createTelegramLinkValidationHandler`) and `:1600` (`createTelegramWebhookHandler`): `if (configuredSecret) { ... }`. With no secret configured, anyone can POST forged Telegram updates (record handshakes, make the bot send its welcome message to any chat that has started it) and call `/api/telegram/link` to try link codes with a chat ID of their choice.
Impact: link codes are 8 characters and expire after 10 minutes, so guessing is impractical, but the endpoint has no rate limit and forged updates also poison the username to chat ID table (see 11).
Fix: return 401 (or 503) when the secret is empty, set the secret in production and register it with Telegram's `setWebhook` `secret_token`. Needs approval because it changes behaviour the Telegram bot relies on, and I cannot see the production configuration.
Verify: POST without the header returns 401 with the secret set (already tested) and also when it is unset.

### [Medium] 5. Auth secret and base URL defaults
Where: `lib/auth-config.ts:84-92` returns `undefined` when `BETTER_AUTH_SECRET`/`AUTH_SECRET` are absent, and `:7,:81` fall back to `http://localhost:3001`. Better Auth then uses the published default secret `better-auth-secret-12345678901234567890` unless `NODE_ENV` is `production` (`node_modules/better-auth/dist/context/create-context.mjs:39,78`). The same secret keys the account-change code HMAC in `lib/account-settings.ts`. A missing secret would let anyone forge session cookies; a missing base URL would drop the Secure cookie flag and break the Origin check in `/api/account` (which then expects `http://localhost:3001`).
Proof: reading the library source; I did not run it with the secret removed.
Fix: when the request origin is not localhost, throw at startup if the secret is missing or shorter than 32 characters, and throw if no base URL is configured. Confirm `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set in production (`wrangler secret list` or the dashboard) before relying on this.

### [Medium] 6. Email enumeration and squatting at sign-up
Where: `lib/auth-verification.ts:139-147` rejects sign-up with "A user with this email already exists." for any existing user, verified or not.
Impact: anyone can learn whether an email has an account; an attacker can register a victim's email without verifying it, which blocks the real owner from signing up (they get "already exists"). The attacker cannot sign in (verification required) and `acceptPendingWorkspaceInvitationsForUser` (`lib/auth-config.ts:230`) runs at user creation, but the account stays unverified so no session is issued.
Fix: for unverified existing users, re-send the verification code instead of throwing; return the same generic response for verified users and accept the enumeration trade-off or send an "already registered" email. Rate limits (3/min per IP on sign-up) reduce but do not remove the enumeration.

### [Low] 10. `/api/telegram/link` unrated and unused
Where: `app/api/telegram/link/route.ts`. Nothing in the repo calls it (`grep` over `app`, `components`, `lib`, `worker`). It consumes link codes using a caller-supplied `chatId`. Fix: delete the route, or require the secret (see 3) and add a rate limit.

### [Low] 11. Telegram username linking
Where: `lib/telegram-bot.ts` `resolveTelegramChatDestination` (around lines 1348-1450) resolves a typed `@username` through `telegram_bot_handshakes`. Impact: a workspace admin can point a channel at someone else's Telegram account if that person has ever started the bot, so alerts (competitor change summaries) are delivered to them, and handshakes can be forged when the webhook secret is unset (3). No data of other tenants is exposed. Fix: only accept chats proven through a link code.

### [Low] 12. Runtime DDL
Where: `lib/telegram-bot.ts:266,284` run `CREATE TABLE IF NOT EXISTS` on request paths. Schema belongs in migrations; the Worker's D1 token needs DDL rights. Fix: add a migration and remove the runtime DDL.

### [Low] 13. Channel secrets stored in plaintext
Where: `external_notification_channels.config_json` holds webhook signing secrets and bot tokens (`lib/notification-settings.ts`). A D1 export or a SQL injection would expose them. Fix: encrypt with a key from a Worker secret, or at minimum never return them to the client (they currently are not).

### [Low] 14. Webhook body size
Where: `lib/lemonsqueezy.ts:3059` `await request.text()` before the signature check. Fix: reject bodies over about 1 MB using `Content-Length` and a bounded read, before hashing. The signature check itself is correct (HMAC-SHA256 over the raw body, constant-time compare, store ID check, delivery key replay protection).

### [Info] 16. Two-factor brute force
`twoFactor` uses 6-digit emailed codes, 5 attempts per code, 3 sends per minute per IP, plus Better Auth's account lockout (10 failures, 15 minutes). An attacker who already knows the password and has many IPs is limited mainly by the lockout, which depends on a `two_factors` row existing for the user. I did not verify that row is created for every account because the 2FA enable endpoint is disabled; check that lockout actually triggers (create a user, fail 10 codes, expect `ACCOUNT_TEMPORARILY_LOCKED`). Rate limiting for the login endpoints is IP based and stored in D1 (read-modify-write), so concurrent bursts can exceed the limit slightly.

### Follow-ups without a severity change
- 9. A nonce based CSP needs a request-time proxy and framework support in vinext. Until then `script-src` keeps `'unsafe-inline'`; all other directives are strict, so injected markup cannot load remote script, but an injected inline script would run. React escapes output and the repo has no `dangerouslySetInnerHTML`, so there is no known injection point.
- 15. `worker/external-delivery.ts` builds Slack mrkdwn from change summaries; competitor page text can include `<https://evil|text>` style links. Escape `&`, `<`, `>` for Slack.
- 17. `lib/user-facing-error.ts` hides technical messages with a deny-list of patterns; an allow-list of known user errors would be safer.

## Checked and clean

- Authorization: every route handler and server action authenticates inside the handler. `/api/changes/[changeId]/screenshot/[side]` and `/api/snapshots/[snapshotId]/screenshot` join through `competitors.workspace_id` to `workspace_members` for the session user (no IDOR; `side` validated; R2 keys come from the database, not the request). `/api/account` checks Origin equality, JSON content type, a 4 KB limit, a verified session, binds every challenge to user, session and original email, and rate-limits sends and verifications per user. Server actions in competitors, pages, team, billing and notifications use `workspace_members` ownership joins and role helpers (`canEditMonitoring`, `canDeleteMonitoringResources`, `canManageWorkspaceChannels`, `canManageWorkspaceBilling` = owner only). Dashboard pages (changes, pages history/snapshots, competitor pages) 404 unless the user is a member of the workspace.
- SQL: a script that scans every `.prepare(` call found no user-controlled interpolation. The only `${}` uses are `?` placeholder lists (`placeholders`, `peerPlaceholders`), the constant `CLAIM_MINUTES`, and the fixed condition list in `app/dashboard/changes/page.tsx` (values are bound, LIKE patterns escaped).
- Webhooks: Lemon Squeezy verifies HMAC-SHA256 over the raw body with `timingSafeEqual`, rejects short or placeholder secrets, checks the store ID, claims each delivery atomically (`billing_webhook_deliveries`, duplicates and stale events ignored), restricts checkout URLs to `lemonsqueezy.com`. Checkout is created server-side; plan and price come from server configuration.
- Email output: change and digest emails escape all page-derived text with `escapeHtml`; auth codes are validated as six digits before sending.
- Open redirects: no user-controlled redirect targets; `next.config.ts` redirects are static; the checkout redirect only follows `https://` URLs produced by the server and validated against `lemonsqueezy.com`.
- CSRF: server actions use vinext's Origin versus Host check and cookies are Better Auth defaults (SameSite Lax); `/api/account` enforces an exact Origin; Better Auth enforces `trustedOrigins` (only the configured origin).
- Disabled Better Auth endpoints: password change, reset, email change, `update-user`, 2FA enable/disable, backup codes, email-OTP sign-in. The login flow requires password, email verification and an emailed code on every sign-in (`trustDevice` rejected).
- Secrets: `.env*` and `.dev.vars` are ignored; logs contain IDs and counts, not tokens or message bodies. `NEXT_PUBLIC_*` is not used.
- Header leakage: no `X-Powered-By` is sent by vinext (checked locally).

## Could not test

- Live login, sign-up, 2FA, billing checkout and Telegram flows end to end: they need real email delivery and provider credentials, which were out of bounds. The auth and account flows are covered by the existing SQLite-backed tests (`tests/auth-verification.test.mjs`, `tests/account-settings.test.mjs`).
- The local dev server became unresponsive on authenticated API routes during probing (it wedged after repeated rebuilds), so unauthenticated route probes (401/403 checks) were covered through unit tests rather than HTTP. Earlier probes confirmed `/api/db-test` returns 404 and the Telegram webhook returns 401 without the secret.
- DNS rebinding and what Cloudflare Browser Rendering can reach: depends on Cloudflare infrastructure.
- Browser CSP behaviour: no browser session was available, so violations were checked by inspecting the served HTML for third-party resources (none), not by watching the console. Do this after the first deploy to a preview.
- Cookie flags in production: depend on the configured base URL and `NODE_ENV`.

## Verification status of this branch

- `npx tsc --noEmit` passes.
- `npm run build` passes and the built server bundle contains the production headers.
- `node --test tests/*.test.mjs`: all new tests pass. One existing failure in `tests/dashboard-presentation.test.mjs` (dashboard health cells) exists on the base commit and is a UI test owned by the UI work.
- `npm run lint`: every file changed in this review lints clean. The repository still reports 6 errors and 8 warnings that exist on the base commit, all in UI files (`components/legal/legal-page-shell.tsx`, `components/mobile-plan-selector.tsx`, `app/dashboard/notifications/email-digest-fields.tsx`) or generated typings, which this review does not own. After `npm run build`, `npm run lint` also scans the generated `dist/` folder and reports extra errors there; delete `dist/` or run `npx eslint --ignore-pattern "dist/**"` to avoid that.
