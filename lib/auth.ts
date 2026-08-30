import { betterAuth } from "better-auth";
import { env } from "cloudflare:workers";

export const auth = betterAuth({
  baseURL: "http://localhost:3001",

  trustedOrigins: [
    "http://localhost:3001",
  ],
  database: env.DB,

  emailAndPassword: {
    enabled: true,
  },

  databaseHooks: {
  user: {
    create: {
      after: async (user) => {
        const workspaceId = crypto.randomUUID();

        const workspaceName = user.name
          ? `${user.name}'s Workspace`
          : "My Workspace";

        await env.DB.batch([
          env.DB.prepare(
            `
              INSERT INTO workspaces (
                id,
                name,
                created_by
              )
              VALUES (?, ?, ?)
            `
          ).bind(
            workspaceId,
            workspaceName,
            user.id
          ),

          env.DB.prepare(
            `
              INSERT INTO workspace_members (
                workspace_id,
                user_id,
                role
              )
              VALUES (?, ?, 'owner')
            `
          ).bind(
            workspaceId,
            user.id
          ),
        ]);
      },
    },
  },
},

  user: {
    modelName: "users",
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },

  session: {
    modelName: "sessions",
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },

  account: {
    modelName: "accounts",
    identityStrategy: "provider-id",
    fields: {
      userId: "user_id",
      accountId: "account_id",
      providerId: "provider_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      idToken: "id_token",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },

  verification: {
    modelName: "verifications",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
});