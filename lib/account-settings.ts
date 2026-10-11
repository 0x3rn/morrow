import type { createMorrowAuth, MorrowAuthEnv } from "./auth-config.ts";
import { sendAuthCode, type AuthCodePurpose } from "./auth-email.ts";

type Auth = ReturnType<typeof createMorrowAuth>;
type Purpose = "email" | "password";
interface Challenge {
  id: string; user_id: string; session_id: string; purpose: Purpose;
  stage: "current-email" | "new-email"; original_email: string; new_email: string | null;
  code_hash: string; attempts: number; ready: number; expires_at: number; last_sent_at: number;
}
class AccountError extends Error {
  status: number;
  challenge?: ReturnType<typeof publicChallenge>;
  constructor(status: number, message: string, challenge?: ReturnType<typeof publicChallenge>) {
    super(message); this.status = status; this.challenge = challenge;
  }
}
const invalidCode = () => new AccountError(400, "This code is invalid or has expired. Request a new code.");
const encoder = new TextEncoder();
function publicChallenge(row: Challenge) {
  return { id: row.id, purpose: row.purpose, stage: row.stage,
    email: row.stage === "new-email" ? row.new_email! : row.original_email,
    resendAt: row.last_sent_at + 60_000 };
}
function equalHash(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function randomCode() {
  // Rejection sampling avoids bias from the 32-bit integer range.
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= 4_294_000_000);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

export function createAccountSettings(env: MorrowAuthEnv, auth: Auth, fetcher: typeof fetch = fetch) {
  const db = env.DB;
  async function codeHash(id: string, stage: string, code: string) {
    const { secret } = await auth.$context;
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(`morrow-account:${id}:${stage}:${code}`));
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
  }
  async function limit(userId: string, kind: "send" | "verify") {
    const now = Date.now(), window = kind === "send" ? 3_600_000 : 900_000, maximum = kind === "send" ? 10 : 30;
    const result = await db.prepare(`INSERT INTO auth_rate_limits (id, key, count, last_request) VALUES (?, ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = CASE WHEN last_request <= ? THEN 1 ELSE count + 1 END,
      last_request = CASE WHEN last_request <= ? THEN excluded.last_request ELSE last_request END
      WHERE count < ? OR last_request <= ? RETURNING count`)
      .bind(crypto.randomUUID(), `account-${kind}:${userId}`, now, now - window, now - window, maximum, now - window).first();
    if (!result) throw new AccountError(429, "Too many attempts. Please try again later.");
  }
  async function deliver(row: Challenge, code: string) {
    const purpose: AuthCodePurpose = row.stage === "new-email" ? "new-email" : row.purpose === "email" ? "email-change" : "password-change";
    try { await sendAuthCode(env, publicChallenge(row).email, code, purpose, fetcher); }
    catch { throw new AccountError(503, "We couldn't send your code. Please try again shortly.", publicChallenge(row)); }
    await db.prepare("UPDATE account_change_challenges SET ready = 1 WHERE id = ? AND code_hash = ? AND claim_token IS NULL")
      .bind(row.id, row.code_hash).run();
  }
  return async function handle(request: Request): Promise<Response> {
    const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    try {
      const origin = new URL(env.BETTER_AUTH_URL?.trim() || env.MORROW_APP_URL?.trim() || "http://localhost:3001").origin;
      if (request.headers.get("Origin") !== origin) throw new AccountError(403, "This request is not allowed.");
      if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new AccountError(415, "Send this request as JSON.");
      const text = await request.text();
      if (text.length > 4096) throw new AccountError(400, "This request is too large.");
      let body: Record<string, unknown>;
      try { const value = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); body = value; }
      catch { throw new AccountError(400, "This request is invalid."); }
      const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
      if (!session || !session.user.emailVerified) throw new AccountError(401, "Please log in again.");
      const userId = session.user.id, sessionId = session.session.id, email = session.user.email, now = Date.now();
      const credential = await db.prepare("SELECT id FROM accounts WHERE user_id = ? AND provider_id = 'credential' AND password IS NOT NULL").bind(userId).first<{ id: string }>();
      if (body.action === "update-name") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new AccountError(400, "Enter a name between 1 and 100 characters.");
        const result = await db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?)")
          .bind(name, now, userId, sessionId, userId, now).run();
        if (!result.meta.changes) throw new AccountError(401, "Please log in again.");
        return respond({ user: { name, email }, message: "Name updated." });
      }
      if (!credential) throw new AccountError(400, "This account does not have a password to change.");
      if (body.action === "request-code") {
        const purpose = body.purpose;
        if (purpose !== "email" && purpose !== "password") throw new AccountError(400, "Choose an email or password change.");
        let newEmail: string | null = null;
        if (purpose === "email") {
          newEmail = typeof body.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";
          if (newEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) throw new AccountError(400, "Enter a valid email address.");
          if (newEmail === email.toLowerCase()) throw new AccountError(400, "Enter a different email address.");
          if (await db.prepare("SELECT id FROM users WHERE lower(email) = ?").bind(newEmail).first()) throw new AccountError(409, "This email address is already in use.");
        }
        const previous = await db.prepare("SELECT last_sent_at FROM account_change_challenges WHERE user_id = ? AND purpose = ?").bind(userId, purpose).first<{ last_sent_at: number }>();
        if (previous && now < previous.last_sent_at + 60_000) throw new AccountError(429, "Please wait 60 seconds before requesting another code.");
        await limit(userId, "send");
        const id = crypto.randomUUID(), code = randomCode();
        const row: Challenge = { id, user_id: userId, session_id: sessionId, purpose, stage: "current-email", original_email: email,
          new_email: newEmail, code_hash: await codeHash(id, "current-email", code), attempts: 0, ready: 0, expires_at: now + 300_000, last_sent_at: now };
        // One pending change per purpose; a replacement invalidates the previous code.
        const inserted = await db.prepare(`INSERT INTO account_change_challenges
          (id, user_id, session_id, purpose, stage, original_email, new_email, code_hash, expires_at, last_sent_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, purpose) DO UPDATE SET
          id = excluded.id, session_id = excluded.session_id, stage = excluded.stage, original_email = excluded.original_email,
          new_email = excluded.new_email, code_hash = excluded.code_hash, expires_at = excluded.expires_at,
          last_sent_at = excluded.last_sent_at, attempts = 0, ready = 0, claim_token = NULL
          WHERE last_sent_at <= ? RETURNING id`)
          .bind(id, userId, sessionId, purpose, row.stage, email, newEmail, row.code_hash, row.expires_at, now, now - 60_000).first();
        if (!inserted) throw new AccountError(429, "Please wait 60 seconds before requesting another code.");
        await deliver(row, code);
        return respond({ challenge: publicChallenge(row), message: "A code has been sent to your email and expires in 5 minutes." });
      }
      if (typeof body.challengeId !== "string") throw invalidCode();
      const find = () => db.prepare(`SELECT * FROM account_change_challenges WHERE id = ? AND user_id = ? AND session_id = ?
        AND original_email = ? AND claim_token IS NULL`).bind(body.challengeId, userId, sessionId, email).first<Challenge>();
      let row = await find();
      if (!row) throw invalidCode();
      if (body.action === "cancel-change") {
        await db.prepare("DELETE FROM account_change_challenges WHERE id = ? AND user_id = ? AND session_id = ?").bind(row.id, userId, sessionId).run();
        return respond({ message: "Change cancelled." });
      }
      if (body.action === "resend-code") {
        if (row.attempts >= 5) throw invalidCode();
        if (now < row.last_sent_at + 60_000) throw new AccountError(429, "Please wait 60 seconds before requesting another code.");
        await limit(userId, "send");
        let code: string, hash: string;
        do { code = randomCode(); hash = await codeHash(row.id, row.stage, code); } while (equalHash(hash, row.code_hash));
        const updated = await db.prepare(`UPDATE account_change_challenges SET code_hash = ?, ready = 0, expires_at = ?, last_sent_at = ?
          WHERE id = ? AND code_hash = ? AND stage = ? AND attempts < 5 AND claim_token IS NULL AND last_sent_at <= ? RETURNING *`)
          .bind(hash, now + 300_000, now, row.id, row.code_hash, row.stage, now - 60_000).first<Challenge>();
        if (!updated) throw invalidCode();
        await deliver(updated, code);
        return respond({ challenge: publicChallenge(updated), message: "A new code has been sent." });
      }
      const expectedStage = body.action === "confirm-new-email" ? "new-email" : "current-email";
      if ((body.action === "change-password" && row.purpose !== "password") ||
        ((body.action === "verify-current-email" || body.action === "confirm-new-email") && row.purpose !== "email") ||
        !["change-password", "verify-current-email", "confirm-new-email"].includes(String(body.action)) || row.stage !== expectedStage) throw invalidCode();
      if (body.action === "change-password" && (typeof body.newPassword !== "string" || body.newPassword.length < 8 || body.newPassword.length > 128)) {
        throw new AccountError(400, "Use a password between 8 and 128 characters.");
      }
      if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new AccountError(400, "Enter the six-digit code.");
      await limit(userId, "verify");
      const attempted = await db.prepare(`UPDATE account_change_challenges SET attempts = attempts + 1 WHERE id = ?
        AND user_id = ? AND session_id = ? AND stage = ? AND code_hash = ? AND ready = 1 AND expires_at > ?
        AND attempts < 5 AND claim_token IS NULL RETURNING *`)
        .bind(row.id, userId, sessionId, row.stage, row.code_hash, now).first<Challenge>();
      if (!attempted || !equalHash(attempted.code_hash, await codeHash(row.id, row.stage, body.code))) throw invalidCode();
      row = attempted;
      if (body.action === "verify-current-email") {
        await limit(userId, "send");
        let code: string;
        do { code = randomCode(); } while (code === body.code);
        const hash = await codeHash(row.id, "new-email", code);
        const updated = await db.prepare(`UPDATE account_change_challenges SET stage = 'new-email', code_hash = ?, attempts = 0,
          ready = 0, expires_at = ?, last_sent_at = ? WHERE id = ? AND code_hash = ? AND stage = 'current-email'
          AND attempts <= 5 AND expires_at > ? AND claim_token IS NULL RETURNING *`)
          .bind(hash, now + 300_000, now, row.id, row.code_hash, now).first<Challenge>();
        if (!updated) throw invalidCode();
        await deliver(updated, code);
        return respond({ challenge: publicChallenge(updated), message: "A code has been sent to your new email and expires in 5 minutes." });
      }
      const hash = body.action === "change-password" ? await (await auth.$context).password.hash(body.newPassword as string) : null;
      const claim = crypto.randomUUID();
      const claimStatement = db.prepare(`UPDATE account_change_challenges SET claim_token = ? WHERE id = ? AND user_id = ?
        AND session_id = ? AND original_email = ? AND code_hash = ? AND stage = ? AND ready = 1 AND attempts <= 5
        AND expires_at > ? AND claim_token IS NULL
        AND EXISTS (SELECT 1 FROM users WHERE id = ? AND email = ?)
        AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?) RETURNING id`)
        .bind(claim, row.id, userId, sessionId, email, row.code_hash, row.stage, Date.now(), userId, email, sessionId, userId, Date.now());
      const claimed = "EXISTS (SELECT 1 FROM account_change_challenges WHERE claim_token = ?)";
      // D1 batch is transactional: consuming the code, updating credentials and revoking sessions succeed together.
      const changes = body.action === "change-password"
        ? [db.prepare(`UPDATE accounts SET password = ?, updated_at = ? WHERE id = ? AND ${claimed}`).bind(hash, now, credential.id, claim)]
        : [db.prepare(`UPDATE users SET email = ?, email_verified = 1, updated_at = ? WHERE id = ? AND ${claimed}`).bind(row.new_email, now, userId, claim)];
      const results = await db.batch([
        claimStatement, ...changes,
        db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ? AND ${claimed}`).bind(userId, sessionId, claim),
        // A login that passed the old password but has not finished its code must start again.
        db.prepare(`DELETE FROM verifications WHERE value = ? AND (identifier LIKE '2fa-%' OR identifier LIKE 'trust-device-%') AND ${claimed}`).bind(userId, claim),
        db.prepare(`DELETE FROM account_change_challenges WHERE user_id = ? AND ${claimed}`).bind(userId, claim),
      ]);
      if (!results[0].meta.changes) throw invalidCode();
      return respond({ user: { name: session.user.name, email: row.purpose === "email" ? row.new_email! : email },
        message: row.purpose === "email" ? "Email updated." : "Password updated." });
    } catch (error) {
      if (error instanceof AccountError) return respond({ error: error.message, ...(error.challenge ? { challenge: error.challenge } : {}) }, error.status);
      if (error instanceof Error && /UNIQUE constraint failed: users.email/i.test(error.message)) return respond({ error: "This email address is already in use." }, 409);
      // Do not expose SQL, codes, addresses or provider errors.
      return respond({ error: "We couldn't save this change. Please try again." }, 500);
    }
  };
}
