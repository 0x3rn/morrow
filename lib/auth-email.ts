export interface AuthEmailEnv {
  RESEND_API_KEY?: string;
  MORROW_EMAIL_FROM?: string;
}

export type AuthCodePurpose = "signup" | "login" | "password-change" | "email-change" | "new-email";

export function requireAuthEmailConfiguration(env: AuthEmailEnv) {
  if (!env.RESEND_API_KEY?.trim() || !env.MORROW_EMAIL_FROM?.trim()) {
    throw new Error("Authentication email delivery is not configured.");
  }
}

export async function sendAuthCode(
  env: AuthEmailEnv,
  email: string,
  code: string,
  purpose: AuthCodePurpose,
  fetcher: typeof fetch = fetch,
) {
  requireAuthEmailConfiguration(env);
  if (!/^\d{6}$/.test(code)) {
    throw new Error("Authentication codes must contain six digits.");
  }

  const actions: Record<AuthCodePurpose, string> = {
    signup: "verify your email", login: "log in", "password-change": "change your password",
    "email-change": "approve your email change", "new-email": "confirm your new email",
  };
  const subjects: Record<AuthCodePurpose, string> = {
    signup: "verification", login: "login", "password-change": "password change",
    "email-change": "email change", "new-email": "new email confirmation",
  };
  const action = actions[purpose];
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: env.MORROW_EMAIL_FROM!.trim(),
      to: [email],
      subject: `Your Morrow ${subjects[purpose]} code`,
      text: `Your Morrow code is ${code}. Use it to ${action}. It expires in 5 minutes. If you did not request this code, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;color:#17201d;max-width:480px;margin:auto;padding:32px"><h1 style="font-size:24px">Your Morrow code</h1><p>Use this code to ${action}:</p><p style="font-size:36px;font-weight:700;letter-spacing:8px">${code}</p><p>It expires in 5 minutes.</p><p>If you did not request this code, ignore this email.</p></div>`,
    }),
  });

  // Never surface the provider response: it can contain addresses or request data.
  if (!response.ok) {
    throw new Error("Authentication email could not be delivered.");
  }
}
