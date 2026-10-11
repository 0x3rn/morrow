# Account settings

Account → Manage account now provides name, email, and password changes in the existing workspace panel.

- Name changes save immediately without sending email.
- Password changes require a six-digit code delivered to the current verified address.
- Email changes require separate proofs of the current and proposed addresses. The current address remains active until confirmation of the new address.
- Codes expire after five minutes, are stored as HMAC hashes, are bound to a user/session/purpose/stage, and can be consumed only once. Resend replaces the code with a different value and uses a 60-second cooldown. Per-user send/verification budgets and a five-attempt challenge limit are enforced in the database.
- Credential updates, approval consumption, revocation of other sessions, and invalidation of pending login challenges use one transactional D1 batch. Existing direct auth mutations and password-reset bypass routes are disabled.
- The current session stays signed in after a successful change. Closing the panel clears sensitive input and cancels the pending change.
- Migration 0009 adds only the short-lived challenge table; it does not change existing users or revoke their sessions.

## Verification

`node --test tests/account-settings.test.mjs tests/auth-verification.test.mjs tests/dashboard-presentation.test.mjs`: 33 passing checks. Includes both email stages, expiry/resend, lockout, delivery failure/recovery, session/user binding, duplicate-address races, concurrent approval/request races, cancellation, production password hashing, and transactional rollback after database errors.

Production Vinext build, TypeScript, and source lint pass. Browser checks use the built Worker with local D1 fixtures and intercepted test email delivery. Verified complete name/password/email flows, incorrect codes and password mismatch, account-menu refresh, numeric one-time-code inputs, cancellation on close, cleared passwords, and no overflow at 320, 375, 390, 430, 768, 1024, and 1440px. These are emulated browser viewports, not physical-device tests.

Fresh live test inbox/account credentials are kept only in ignored local test files, never in the repository. Live acceptance checks run after the GitHub-triggered deployment using actual email delivery.
