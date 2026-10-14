"use server";

import { auth } from "@/lib/auth";
import {
  initiateOrUpdateWorkspaceSubscription,
  updateWorkspaceSubscriptionCancellationWithLemonSqueezy,
} from "@/lib/lemonsqueezy";
import { requireActiveWorkspaceMembership } from "@/lib/team-workspaces";
import {
  toUserFacingErrorMessage,
  type WorkspaceActionResult,
} from "@/lib/user-facing-error";
import {
  getWorkspaceSubscription,
  updateWorkspaceBillingInterval,
} from "@/lib/workspace-billing";
import { env } from "cloudflare:workers";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

async function requireAuthenticatedUser(): Promise<{
  id: string;
  email: string;
  name: string;
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
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
): Promise<WorkspaceActionResult> {
  try {
    const user = await requireAuthenticatedUser();
    const activeWorkspace =
      await requireActiveWorkspaceMembership(
        env.DB,
        user.id,
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

    const result =
      await initiateOrUpdateWorkspaceSubscription(env, {
        actorUserId: user.id,
        actorEmail: user.email,
        actorName: user.name,
        workspaceId: activeWorkspace.id,
        planId,
        billingInterval,
      });

    revalidateBillingAndWorkspacePaths();

    if (result.mode === "checkout_redirect") {
      return { checkoutUrl: result.checkoutUrl };
    }

    return {};
  } catch (error) {
    return {
      error: toUserFacingErrorMessage(error),
    };
  }
}

export async function updateBillingIntervalAction(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    const user = await requireAuthenticatedUser();
    const activeWorkspace =
      await requireActiveWorkspaceMembership(
        env.DB,
        user.id,
      );

    const billingInterval = String(
      formData.get("billingInterval") ?? "",
    ).trim();

    const currentSubscription =
      await getWorkspaceSubscription(
        env.DB,
        activeWorkspace.id,
      );

    // If the workspace has an active Lemon Squeezy subscription, switching billing interval
    // must update the variant on Lemon Squeezy first.
    if (
      currentSubscription.providerSubscriptionId &&
      currentSubscription.status !== "canceled"
    ) {
      const result =
        await initiateOrUpdateWorkspaceSubscription(env, {
          actorUserId: user.id,
          actorEmail: user.email,
          actorName: user.name,
          workspaceId: activeWorkspace.id,
          planId: currentSubscription.planId,
          billingInterval,
        });

      revalidateBillingAndWorkspacePaths();

      if (result.mode === "checkout_redirect") {
        return { checkoutUrl: result.checkoutUrl };
      }

      return {};
    }

    // When on an unsubscribed workspace plan, toggling the interval only updates
    // the workspace's preferred billing interval for plan comparison and checkout.
    await updateWorkspaceBillingInterval(env.DB, {
      actorUserId: user.id,
      workspaceId: activeWorkspace.id,
      billingInterval,
    });

    revalidateBillingAndWorkspacePaths();
    return {};
  } catch (error) {
    return {
      error: toUserFacingErrorMessage(error),
    };
  }
}

export async function toggleSubscriptionCancellationAction(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    const user = await requireAuthenticatedUser();
    const activeWorkspace =
      await requireActiveWorkspaceMembership(
        env.DB,
        user.id,
      );

    const mode = String(
      formData.get("mode") ?? "schedule_cancel",
    ).trim();

    await updateWorkspaceSubscriptionCancellationWithLemonSqueezy(
      env,
      {
        actorUserId: user.id,
        workspaceId: activeWorkspace.id,
        cancelAtPeriodEnd: mode === "schedule_cancel",
      },
    );

    revalidateBillingAndWorkspacePaths();
    return {};
  } catch (error) {
    return {
      error: toUserFacingErrorMessage(error),
    };
  }
}
