"use server";

import { auth } from "@/lib/auth";
import {
  createWorkspaceExternalChannel,
  removeWorkspaceExternalChannel,
  saveUserEmailNotificationPreferences,
  toggleWorkspaceExternalChannelStatus,
  updateWorkspaceExternalChannel,
} from "@/lib/notification-settings";
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
) {
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
}

export async function createExternalChannel(
  formData: FormData,
) {
  const userId = await requireAuthenticatedUserId();

  await createWorkspaceExternalChannel(env.DB, {
    userId,
    name: String(formData.get("name") || "").trim(),
    channel: String(formData.get("channel") || "").trim(),
    slackWebhookUrl: String(
      formData.get("slackWebhookUrl") || "",
    ).trim(),
    telegramBotToken: String(
      formData.get("telegramBotToken") || "",
    ).trim(),
    telegramChatId: String(
      formData.get("telegramChatId") || "",
    ).trim(),
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
}

export async function updateExternalChannel(
  formData: FormData,
) {
  const userId = await requireAuthenticatedUserId();

  await updateWorkspaceExternalChannel(env.DB, {
    userId,
    channelId: String(
      formData.get("channelId") || "",
    ).trim(),
    name: String(formData.get("name") || "").trim(),
    channel: String(formData.get("channel") || "").trim(),
    slackWebhookUrl: String(
      formData.get("slackWebhookUrl") || "",
    ).trim(),
    telegramBotToken: String(
      formData.get("telegramBotToken") || "",
    ).trim(),
    telegramChatId: String(
      formData.get("telegramChatId") || "",
    ).trim(),
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
}

export async function toggleExternalChannelStatus(
  formData: FormData,
) {
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
}

export async function removeExternalChannel(
  formData: FormData,
) {
  const userId = await requireAuthenticatedUserId();

  await removeWorkspaceExternalChannel(env.DB, {
    userId,
    channelId: String(
      formData.get("channelId") || "",
    ).trim(),
  });

  revalidateNotificationRoutes();
}
