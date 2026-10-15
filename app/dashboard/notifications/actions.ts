"use server";

import { auth } from "@/lib/auth";
import {
  createWorkspaceExternalChannel,
  removeWorkspaceExternalChannel,
  saveUserEmailNotificationPreferences,
  toggleWorkspaceExternalChannelStatus,
  updateWorkspaceExternalChannel,
} from "@/lib/notification-settings";
import {
  cancelTelegramLinkCode,
  generateTelegramLinkCode,
  resolveTelegramChatDestination,
  sendTelegramBotPlainMessage,
} from "@/lib/telegram-bot";
import {
  toUserFacingErrorMessage,
  type WorkspaceActionResult,
} from "@/lib/user-facing-error";
import { env } from "cloudflare:workers";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

function readStringArray(
  formData: FormData,
  key: string,
): string[] {
  return formData
    .getAll(key)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function readBooleanCheckbox(
  formData: FormData,
  key: string,
): boolean {
  const value = String(formData.get(key) || "")
    .trim()
    .toLowerCase();
  return (
    value === "1" ||
    value === "true" ||
    value === "on"
  );
}

async function requireAuthenticatedUserId(): Promise<string> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  return session.user.id;
}

function revalidateNotificationRoutes() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/notifications");
}

export async function updateEmailNotificationPreferences(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    const userId = await requireAuthenticatedUserId();

    await saveUserEmailNotificationPreferences(env.DB, {
      userId,
      emailEnabled: readBooleanCheckbox(
        formData,
        "emailEnabled",
      ),
      digestEmailEnabled: readBooleanCheckbox(
        formData,
        "digestEmailEnabled",
      ),
      minSignificance: String(
        formData.get("minSignificance") || "minor",
      ).trim(),
      categories: readStringArray(
        formData,
        "categories",
      ),
      competitorIds: readStringArray(
        formData,
        "competitorIds",
      ),
      digestPeriods: readStringArray(
        formData,
        "digestPeriods",
      ),
    });

    revalidateNotificationRoutes();
    return {};
  } catch (error) {
    return {
      error: toUserFacingErrorMessage(error),
    };
  }
}

export async function generateTelegramLinkIdAction(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    const userId = await requireAuthenticatedUserId();
    const name =
      String(formData.get("name") || "").trim() ||
      "Telegram";

    await generateTelegramLinkCode(env.DB, {
      userId,
      name,
      sendChanges: formData.has("sendChanges")
        ? readBooleanCheckbox(formData, "sendChanges")
        : true,
      sendDigests: formData.has("sendDigests")
        ? readBooleanCheckbox(formData, "sendDigests")
        : false,
      minSignificance: String(
        formData.get("minSignificance") || "minor",
      ).trim(),
      categories: readStringArray(formData, "categories"),
      competitorIds: readStringArray(
        formData,
        "competitorIds",
      ),
      digestPeriods:
        readStringArray(formData, "digestPeriods").length >
        0
          ? readStringArray(formData, "digestPeriods")
          : ["weekly"],
    });

    revalidateNotificationRoutes();
    return {};
  } catch (error) {
    return {
      error: toUserFacingErrorMessage(error),
    };
  }
}

export async function cancelTelegramLinkIdAction(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    const userId = await requireAuthenticatedUserId();
    await cancelTelegramLinkCode(env.DB, {
      userId,
      code: String(formData.get("code") || "").trim(),
    });

    revalidateNotificationRoutes();
    return {};
  } catch (error) {
    return {
      error: toUserFacingErrorMessage(error),
    };
  }
}

export async function createExternalChannel(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    const userId = await requireAuthenticatedUserId();
    const name = String(formData.get("name") || "").trim();
    const channel = String(
      formData.get("channel") || "",
    ).trim();
    const rawTelegramChatId = String(
      formData.get("telegramChatId") || "",
    ).trim();
    const telegramConnectToken = String(
      formData.get("telegramConnectToken") || "",
    ).trim();

    if (
      channel.toLowerCase() === "telegram" &&
      !rawTelegramChatId
    ) {
      await generateTelegramLinkCode(env.DB, {
        userId,
        name: name || "Telegram",
        sendChanges: readBooleanCheckbox(
          formData,
          "sendChanges",
        ),
        sendDigests: readBooleanCheckbox(
          formData,
          "sendDigests",
        ),
        minSignificance: String(
          formData.get("minSignificance") || "minor",
        ).trim(),
        categories: readStringArray(
          formData,
          "categories",
        ),
        competitorIds: readStringArray(
          formData,
          "competitorIds",
        ),
        digestPeriods: readStringArray(
          formData,
          "digestPeriods",
        ),
      });

      revalidateNotificationRoutes();
      return {};
    }

    let telegramChatId = rawTelegramChatId;
    let telegramUsername: string | null = null;

    if (channel.toLowerCase() === "telegram") {
      const resolved = await resolveTelegramChatDestination(
        env.DB,
        {
          rawChatIdOrUsername: rawTelegramChatId,
          connectToken: telegramConnectToken,
          botToken: env.MORROW_TELEGRAM_BOT_TOKEN,
        },
      );
      telegramChatId = resolved.chatId;
      telegramUsername = resolved.username;
    }

    await createWorkspaceExternalChannel(env.DB, {
      userId,
      name,
      channel,
      slackWebhookUrl: String(
        formData.get("slackWebhookUrl") || "",
      ).trim(),
      telegramBotToken: String(
        formData.get("telegramBotToken") || "",
      ).trim(),
      telegramChatId,
      telegramUsername,
      webhookUrl: String(
        formData.get("webhookUrl") || "",
      ).trim(),
      webhookSecret: String(
        formData.get("webhookSecret") || "",
      ).trim(),
      sendChanges: readBooleanCheckbox(
        formData,
        "sendChanges",
      ),
      sendDigests: readBooleanCheckbox(
        formData,
        "sendDigests",
      ),
      minSignificance: String(
        formData.get("minSignificance") || "minor",
      ).trim(),
      categories: readStringArray(
        formData,
        "categories",
      ),
      competitorIds: readStringArray(
        formData,
        "competitorIds",
      ),
      digestPeriods: readStringArray(
        formData,
        "digestPeriods",
      ),
    });

    if (
      channel.toLowerCase() === "telegram" &&
      telegramChatId &&
      env.MORROW_TELEGRAM_BOT_TOKEN
    ) {
      await sendTelegramBotPlainMessage({
        botToken: env.MORROW_TELEGRAM_BOT_TOKEN,
        chatId: telegramChatId,
        text: `Morrow delivery channel "${name}" is now connected. You will receive competitor alerts here based on your routing preferences.`,
      });
    }

    revalidateNotificationRoutes();
    return {};
  } catch (error) {
    return {
      error: toUserFacingErrorMessage(error),
    };
  }
}

export async function updateExternalChannel(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    const userId = await requireAuthenticatedUserId();
    const channel = String(
      formData.get("channel") || "",
    ).trim();
    const rawTelegramChatId = String(
      formData.get("telegramChatId") || "",
    ).trim();
    const telegramConnectToken = String(
      formData.get("telegramConnectToken") || "",
    ).trim();

    let telegramChatId = rawTelegramChatId;
    let telegramUsername: string | null = null;

    if (
      channel.toLowerCase() === "telegram" &&
      (rawTelegramChatId || telegramConnectToken)
    ) {
      const resolved = await resolveTelegramChatDestination(
        env.DB,
        {
          rawChatIdOrUsername: rawTelegramChatId,
          connectToken: telegramConnectToken,
          botToken: env.MORROW_TELEGRAM_BOT_TOKEN,
        },
      );
      telegramChatId = resolved.chatId;
      telegramUsername = resolved.username;
    }

    await updateWorkspaceExternalChannel(env.DB, {
      userId,
      channelId: String(
        formData.get("channelId") || "",
      ).trim(),
      name: String(formData.get("name") || "").trim(),
      channel,
      slackWebhookUrl: String(
        formData.get("slackWebhookUrl") || "",
      ).trim(),
      telegramBotToken: String(
        formData.get("telegramBotToken") || "",
      ).trim(),
      telegramChatId,
      telegramUsername,
      webhookUrl: String(
        formData.get("webhookUrl") || "",
      ).trim(),
      webhookSecret: String(
        formData.get("webhookSecret") || "",
      ).trim(),
      sendChanges: readBooleanCheckbox(
        formData,
        "sendChanges",
      ),
      sendDigests: readBooleanCheckbox(
        formData,
        "sendDigests",
      ),
      minSignificance: String(
        formData.get("minSignificance") || "minor",
      ).trim(),
      categories: readStringArray(
        formData,
        "categories",
      ),
      competitorIds: readStringArray(
        formData,
        "competitorIds",
      ),
      digestPeriods: readStringArray(
        formData,
        "digestPeriods",
      ),
    });

    revalidateNotificationRoutes();
    return {};
  } catch (error) {
    return {
      error: toUserFacingErrorMessage(error),
    };
  }
}

export async function toggleExternalChannelStatus(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    const userId = await requireAuthenticatedUserId();

    await toggleWorkspaceExternalChannelStatus(env.DB, {
      userId,
      channelId: String(
        formData.get("channelId") || "",
      ).trim(),
      currentStatus: String(
        formData.get("currentStatus") || "",
      ).trim(),
    });

    revalidateNotificationRoutes();
    return {};
  } catch (error) {
    return {
      error: toUserFacingErrorMessage(error),
    };
  }
}

export async function removeExternalChannel(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    const userId = await requireAuthenticatedUserId();

    await removeWorkspaceExternalChannel(env.DB, {
      userId,
      channelId: String(
        formData.get("channelId") || "",
      ).trim(),
    });

    revalidateNotificationRoutes();
    return {};
  } catch (error) {
    return {
      error: toUserFacingErrorMessage(error),
    };
  }
}
