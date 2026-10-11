import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP, twoFactor } from "better-auth/plugins";
import { requireAuthEmailConfiguration, sendAuthCode, type AuthEmailEnv } from "./auth-email.ts";

export function createEmailVerificationOptions(
  env: AuthEmailEnv,
  fetcher: typeof fetch = fetch,
) {
  const failedDeliveries = new WeakSet<Request>();
  const emailUnavailable = () => new APIError("SERVICE_UNAVAILABLE", {
    code: "EMAIL_DELIVERY_UNAVAILABLE",
    message: "We couldn't send your code. Please try again shortly.",
  });

  async function deliver(
    email: string,
    otp: string,
    purpose: "signup" | "login",
    request?: Request,
  ) {
    try {
      await sendAuthCode(env, email, otp, purpose, fetcher);
    } catch {
      if (request) failedDeliveries.add(request);
      throw emailUnavailable();
    }
  }

  return {
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
    },
    emailVerification: {
      // Send from the OTP plugin's signup hook, which retains the request context.
      sendOnSignUp: false,
      sendOnSignIn: false,
      // The verification endpoint checks the password before consuming the code.
      // Both factors complete in one step, including signup and unverified users.
      autoSignInAfterVerification: true,
    },
    plugins: [
      emailOTP({
        sendVerificationOnSignUp: true,
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        storeOTP: "hashed",
        disableSignUp: true,
        sendVerificationOTP: async ({ email, otp }, ctx) => {
          await deliver(email, otp, "signup", ctx?.request);
        },
      }),
      twoFactor({
        issuer: "Morrow",
        totpOptions: { disable: true },
        twoFactorCookieMaxAge: 600,
        otpOptions: {
          digits: 6,
          period: 5,
          allowedAttempts: 5,
          storeOTP: "hashed",
          sendOTP: async ({ user, otp }, ctx) => {
            await deliver(user.email, otp, "login", ctx?.request);
          },
        },
        schema: {
          user: { fields: { twoFactorEnabled: "two_factor_enabled" } },
          twoFactor: {
            modelName: "two_factors",
            fields: {
              userId: "user_id",
              backupCodes: "backup_codes",
              failedVerificationCount: "failed_verification_count",
              lockedUntil: "locked_until",
            },
          },
        },
      }),
      {
        id: "morrow-email-delivery",
        hooks: {
          after: [{
            matcher: (ctx) => Boolean(ctx.request && failedDeliveries.has(ctx.request)),
            handler: createAuthMiddleware(async (ctx) => {
              if (ctx.request) failedDeliveries.delete(ctx.request);
              throw emailUnavailable();
            }),
          }],
        },
      },
    ],
    disabledPaths: [
      // Account changes must use the session-bound email-code flow.
      "/change-email",
      "/email-otp/change-email",
      "/email-otp/request-email-change",
      "/change-password",
      "/set-password",
      "/update-user",
      "/request-password-reset",
      "/forget-password",
      "/reset-password",
      "/sign-in/email-otp",
      "/verify-email",
      "/send-verification-email",
      "/two-factor/disable",
      "/two-factor/enable",
      "/two-factor/get-totp-uri",
      "/two-factor/verify-totp",
      "/two-factor/verify-backup-code",
      "/two-factor/generate-backup-codes",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
    ],
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limits",
      fields: { lastRequest: "last_request" },
      customRules: {
        "/sign-up/email": { window: 60, max: 3 },
        "/sign-in/email": { window: 60, max: 5 },
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/email-otp/verify-email": { window: 60, max: 5 },
        "/two-factor/send-otp": { window: 60, max: 3 },
        "/two-factor/verify-otp": { window: 60, max: 10 },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/email-otp/verify-email") {
          const password = ctx.body?.password;
          const email = ctx.body?.email;
          const invalidCredentials = () => new APIError("UNAUTHORIZED", {
            code: "INVALID_EMAIL_OR_PASSWORD",
            message: "Invalid email or password.",
          });
          if (typeof password !== "string" || !password || password.length > 128 || typeof email !== "string") {
            throw invalidCredentials();
          }
          const record = await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase(), { includeAccounts: true });
          const account = record?.accounts.find((account) => account.providerId === "credential" && account.accountId === record.user.id);
          if (!account?.password) {
            await ctx.context.password.hash(password);
            throw invalidCredentials();
          }
          if (!await ctx.context.password.verify({ hash: account.password, password })) {
            throw invalidCredentials();
          }
        }
        if (ctx.path === "/email-otp/send-verification-otp" && ctx.body?.type !== "email-verification") {
          throw new APIError("BAD_REQUEST", { message: "Only email verification codes are available here." });
        }
        if (ctx.path === "/two-factor/verify-otp" && ctx.body?.trustDevice) {
          throw new APIError("BAD_REQUEST", { message: "An email code is required for every login." });
        }
        if (["/sign-up/email", "/sign-in/email", "/email-otp/send-verification-otp", "/two-factor/send-otp"].includes(ctx.path ?? "")) {
          try {
            requireAuthEmailConfiguration(env);
          } catch {
            throw emailUnavailable();
          }
        }
      }),
    },
  } satisfies BetterAuthOptions;
}
