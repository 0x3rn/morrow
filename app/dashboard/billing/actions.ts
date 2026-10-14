"use server";

import { auth } from "@/lib/auth";
import { requireActiveWorkspaceMembership } from "@/lib/team-workspaces";
import {
  changeWorkspaceSubscriptionPlan,
  setWorkspaceSubscriptionCancellation,
  updateWorkspaceBillingInterval,
} from "@/lib/workspace-billing";
import { env } from "cloudflare:workers";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

async function requireAuthenticatedUserId(): Promise<string> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  return session.user.id;
}

function revalidateBillingAndWorkspacePaths(): void {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/competitors");
  revalidatePath("/dashboard/changes");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/billing");
}

export async function changeSubscriptionPlanAction(
  formData: FormData,
): Promise<void> {
  const userId = await requireAuthenticatedUserId();
  const activeWorkspace =
    await requireActiveWorkspaceMembership(
      env.DB,
      userId,
    );

  const planId = String(
    formData.get("planId") ?? "",
  ).trim();
  const billingIntervalRaw = formData.get(
    "billingInterval",
  );
  const billingInterval =
    typeof billingIntervalRaw === "string" &&
    billingIntervalRaw.trim().length > 0
      ? billingIntervalRaw.trim()
      : undefined;

  await changeWorkspaceSubscriptionPlan(env.DB, {
    actorUserId: userId,
    workspaceId: activeWorkspace.id,
    planId,
    billingInterval,
  });

  revalidateBillingAndWorkspacePaths();
}

export async function updateBillingIntervalAction(
  formData: FormData,
): Promise<void> {
  const userId = await requireAuthenticatedUserId();
  const activeWorkspace =
    await requireActiveWorkspaceMembership(
      env.DB,
      userId,
    );

  const billingInterval = String(
    formData.get("billingInterval") ?? "",
  ).trim();

  await updateWorkspaceBillingInterval(env.DB, {
    actorUserId: userId,
    workspaceId: activeWorkspace.id,
    billingInterval,
  });

  revalidateBillingAndWorkspacePaths();
}

export async function toggleSubscriptionCancellationAction(
  formData: FormData,
): Promise<void> {
  const userId = await requireAuthenticatedUserId();
  const activeWorkspace =
    await requireActiveWorkspaceMembership(
      env.DB,
      userId,
    );

  const mode = String(
    formData.get("mode") ?? "schedule_cancel",
  ).trim();

  await setWorkspaceSubscriptionCancellation(env.DB, {
    actorUserId: userId,
    workspaceId: activeWorkspace.id,
    cancelAtPeriodEnd: mode === "schedule_cancel",
    immediate: mode === "cancel_now",
  });

  revalidateBillingAndWorkspacePaths();
}
