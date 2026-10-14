"use server";

import { auth } from "@/lib/auth";
import {
  acceptWorkspaceInvitation,
  createTeamWorkspace,
  inviteOrAddWorkspaceMember,
  removeWorkspaceMember,
  requireActiveWorkspaceMembership,
  revokeWorkspaceInvitation,
  switchActiveWorkspace,
  updateWorkspaceMemberRole,
  updateWorkspaceName,
} from "@/lib/team-workspaces";
import { env } from "cloudflare:workers";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

async function requireAuthenticatedUser() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  return session.user;
}

export async function switchWorkspaceAction(
  formData: FormData,
): Promise<void> {
  const user = await requireAuthenticatedUser();
  const workspaceId = String(
    formData.get("workspaceId") ?? "",
  );

  await switchActiveWorkspace(env.DB, {
    userId: user.id,
    workspaceId,
  });

  revalidatePath("/dashboard", "layout");
}

export async function createWorkspaceAction(
  formData: FormData,
): Promise<void> {
  const user = await requireAuthenticatedUser();
  const name = String(formData.get("name") ?? "");

  await createTeamWorkspace(env.DB, {
    userId: user.id,
    name,
  });

  revalidatePath("/dashboard", "layout");
}

export async function renameWorkspaceAction(
  formData: FormData,
): Promise<void> {
  const user = await requireAuthenticatedUser();
  const active =
    await requireActiveWorkspaceMembership(
      env.DB,
      user.id,
    );
  const name = String(formData.get("name") ?? "");

  await updateWorkspaceName(env.DB, {
    userId: user.id,
    workspaceId: active.id,
    name,
  });

  revalidatePath("/dashboard", "layout");
}

export async function inviteWorkspaceMemberAction(
  formData: FormData,
): Promise<void> {
  const user = await requireAuthenticatedUser();
  const active =
    await requireActiveWorkspaceMembership(
      env.DB,
      user.id,
    );
  const email = String(formData.get("email") ?? "");
  const role = String(
    formData.get("role") ?? "member",
  );

  await inviteOrAddWorkspaceMember(env.DB, {
    actorUserId: user.id,
    workspaceId: active.id,
    email,
    role,
  });

  revalidatePath("/dashboard", "layout");
}

export async function updateMemberRoleAction(
  formData: FormData,
): Promise<void> {
  const user = await requireAuthenticatedUser();
  const active =
    await requireActiveWorkspaceMembership(
      env.DB,
      user.id,
    );
  const targetUserId = String(
    formData.get("targetUserId") ?? "",
  );
  const nextRole = String(formData.get("role") ?? "");

  await updateWorkspaceMemberRole(env.DB, {
    actorUserId: user.id,
    workspaceId: active.id,
    targetUserId,
    nextRole,
  });

  revalidatePath("/dashboard", "layout");
}

export async function removeMemberAction(
  formData: FormData,
): Promise<void> {
  const user = await requireAuthenticatedUser();
  const active =
    await requireActiveWorkspaceMembership(
      env.DB,
      user.id,
    );
  const targetUserId = String(
    formData.get("targetUserId") ?? "",
  );

  await removeWorkspaceMember(env.DB, {
    actorUserId: user.id,
    workspaceId: active.id,
    targetUserId,
  });

  revalidatePath("/dashboard", "layout");
}

export async function revokeInvitationAction(
  formData: FormData,
): Promise<void> {
  const user = await requireAuthenticatedUser();
  const active =
    await requireActiveWorkspaceMembership(
      env.DB,
      user.id,
    );
  const invitationId = String(
    formData.get("invitationId") ?? "",
  );

  await revokeWorkspaceInvitation(env.DB, {
    actorUserId: user.id,
    workspaceId: active.id,
    invitationId,
  });

  revalidatePath("/dashboard", "layout");
}

export async function acceptInvitationAction(
  formData: FormData,
): Promise<void> {
  const user = await requireAuthenticatedUser();
  const invitationId = String(
    formData.get("invitationId") ?? "",
  );

  await acceptWorkspaceInvitation(env.DB, {
    userId: user.id,
    invitationId,
  });

  revalidatePath("/dashboard", "layout");
}
