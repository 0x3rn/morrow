import { betterAuth } from "better-auth";
import { env } from "cloudflare:workers";

const LOCAL_AUTH_URL =
  "http://localhost:3001";

type MorrowAuthEnv =
  typeof env & {
    BETTER_AUTH_URL?: string;
    MORROW_APP_URL?: string;

    BETTER_AUTH_SECRET?: string;
    AUTH_SECRET?: string;
  };

const runtimeEnv =
  env as MorrowAuthEnv;

function normalizeAppOrigin(
  value: string
) {
  let url: URL;

  try {
    url =
      new URL(
        value
      );
  } catch {
    throw new Error(
      "Morrow auth base URL must be a valid absolute URL."
    );
  }

  if (
    url.protocol !==
      "http:" &&
    url.protocol !==
      "https:"
  ) {
    throw new Error(
      "Morrow auth base URL must use HTTP or HTTPS."
    );
  }

  /*
   * Better Auth needs the canonical application
   * origin here.
   *
   * Any path accidentally supplied through an
   * environment variable is intentionally removed.
   */
  return url.origin;
}

function resolveAuthBaseUrl() {
  const configuredUrl =
    runtimeEnv.BETTER_AUTH_URL
      ?.trim() ||
    runtimeEnv.MORROW_APP_URL
      ?.trim();

  if (
    configuredUrl
  ) {
    return normalizeAppOrigin(
      configuredUrl
    );
  }

  /*
   * Local development remains zero-configuration.
   *
   * Production acceptance will explicitly verify
   * that a public application origin is configured
   * before release.
   */
  return LOCAL_AUTH_URL;
}

function resolveAuthSecret() {
  const secret =
    runtimeEnv.BETTER_AUTH_SECRET
      ?.trim() ||
    runtimeEnv.AUTH_SECRET
      ?.trim();

  return secret ||
    undefined;
}

const authBaseUrl =
  resolveAuthBaseUrl();

const authSecret =
  resolveAuthSecret();

export const auth =
  betterAuth({
    /*
     * Local development:
     *   http://localhost:3001
     *
     * Production:
     *   BETTER_AUTH_URL
     *
     * MORROW_APP_URL is accepted as the canonical
     * application-origin fallback because THE-19
     * already uses the same value for absolute
     * notification links.
     */
    baseURL:
      authBaseUrl,

    /*
     * Do not permanently trust localhost alongside
     * a production deployment.
     *
     * Only the currently selected canonical origin
     * is explicitly trusted.
     */
    trustedOrigins: [
      authBaseUrl,
    ],

    /*
     * Better Auth also understands its conventional
     * environment secret automatically, but passing
     * the Cloudflare binding explicitly makes the
     * Worker dependency clear.
     *
     * Local development may omit it.
     * Production release checks will require it.
     */
    ...(authSecret
      ? {
          secret:
            authSecret,
        }
      : {}),

    database:
      runtimeEnv.DB,

    emailAndPassword: {
      enabled:
        true,
    },

    databaseHooks: {
      user: {
        create: {
          after:
            async (
              user
            ) => {
              const workspaceId =
                crypto.randomUUID();

              const workspaceName =
                user.name
                  ? `${user.name}'s Workspace`
                  : "My Workspace";

              await runtimeEnv.DB.batch(
                [
                  runtimeEnv.DB.prepare(
                    `
                      INSERT INTO workspaces (
                        id,
                        name,
                        created_by
                      )

                      VALUES (
                        ?,
                        ?,
                        ?
                      )
                    `
                  ).bind(
                    workspaceId,
                    workspaceName,
                    user.id
                  ),

                  runtimeEnv.DB.prepare(
                    `
                      INSERT INTO workspace_members (
                        workspace_id,
                        user_id,
                        role
                      )

                      VALUES (
                        ?,
                        ?,
                        'owner'
                      )
                    `
                  ).bind(
                    workspaceId,
                    user.id
                  ),
                ]
              );
            },
        },
      },
    },

    user: {
      modelName:
        "users",

      fields: {
        emailVerified:
          "email_verified",

        createdAt:
          "created_at",

        updatedAt:
          "updated_at",
      },
    },

    session: {
      modelName:
        "sessions",

      fields: {
        userId:
          "user_id",

        expiresAt:
          "expires_at",

        ipAddress:
          "ip_address",

        userAgent:
          "user_agent",

        createdAt:
          "created_at",

        updatedAt:
          "updated_at",
      },
    },

    account: {
      modelName:
        "accounts",

      identityStrategy:
        "provider-id",

      fields: {
        userId:
          "user_id",

        accountId:
          "account_id",

        providerId:
          "provider_id",

        accessToken:
          "access_token",

        refreshToken:
          "refresh_token",

        accessTokenExpiresAt:
          "access_token_expires_at",

        refreshTokenExpiresAt:
          "refresh_token_expires_at",

        idToken:
          "id_token",

        createdAt:
          "created_at",

        updatedAt:
          "updated_at",
      },
    },

    verification: {
      modelName:
        "verifications",

      fields: {
        expiresAt:
          "expires_at",

        createdAt:
          "created_at",

        updatedAt:
          "updated_at",
      },
    },
  });