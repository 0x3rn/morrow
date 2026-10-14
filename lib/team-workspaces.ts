import { randomUUID } from "node:crypto";

import type { D1DatabaseLike } from "../worker/external-notifications.ts";
import {
  canAssignWorkspaceRole,
  canInviteWithWorkspaceRole,
  canManageTargetMemberRole,
  canManageTeamMembers,
  canManageWorkspaceSettings,
  getWorkspaceRolePermissions,
  isWorkspaceRole,
  normalizeWorkspaceRole,
  type InvitableWorkspaceRole,
  type WorkspaceRole,
  type WorkspaceRolePermissions,
} from "./workspace-roles.ts";

export interface ActiveWorkspaceMembership {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  role: WorkspaceRole;
  joinedAt: string;
  permissions: WorkspaceRolePermissions;
}

export interface UserWorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  joinedAt: string;
  isActive: boolean;
  memberCount: number;
  competitorCount: number;
}

export interface WorkspaceMemberView {
  userId: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  role: WorkspaceRole;
  joinedAt: string;
  isCurrentUser: boolean;
  canChangeRole: boolean;
  canRemove: boolean;
}

export interface WorkspaceInvitationView {
  id: string;
  workspaceId: string;
  email: string;
  role: InvitableWorkspaceRole;
  status: "pending" | "accepted" | "revoked";
  invitedByUserId: string;
  invitedByName: string | null;
  invitedByEmail: string;
  createdAt: string;
  updatedAt: string;
  canRevoke: boolean;
}

export interface PendingUserInvitationView {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: InvitableWorkspaceRole;
  invitedByName: string | null;
  invitedByEmail: string;
  createdAt: string;
}

export interface WorkspaceTeamSnapshot {
  activeWorkspace: ActiveWorkspaceMembership;
  workspaces: UserWorkspaceSummary[];
  members: WorkspaceMemberView[];
  pendingInvitations: WorkspaceInvitationView[];
  incomingInvitations: PendingUserInvitationView[];
  ownerCount: number;
  canLeaveWorkspace: boolean;
}

interface WorkspaceMembershipRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  role: string;
  joined_at: string;
}

interface UserWorkspaceSummaryRow {
  id: string;
  name: string;
  role: string;
  joined_at: string;
  member_count: number;
  competitor_count: number;
}

interface WorkspaceMemberRow {
  user_id: string;
  name: string | null;
  email: string;
  email_verified: number;
  role: string;
  joined_at: string;
}

interface WorkspaceInvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  status: string;
  invited_by: string;
  invited_by_name: string | null;
  invited_by_email: string;
  created_at: string;
  updated_at: string;
}

interface IncomingInvitationRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  role: string;
  invited_by_name: string | null;
  invited_by_email: string;
  created_at: string;
}

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

async function executeBatch(
  db: D1DatabaseLike,
  statements: ReturnType<D1DatabaseLike["prepare"]>[],
): Promise<void> {
  if (typeof db.batch === "function") {
    await db.batch(statements);
    return;
  }

  for (const statement of statements) {
    await statement.run();
  }
}

function toActiveWorkspaceMembership(
  row: WorkspaceMembershipRow,
): ActiveWorkspaceMembership {
  const role = normalizeWorkspaceRole(
    row.role,
    "viewer",
  );

  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role,
    joinedAt: row.joined_at,
    permissions:
      getWorkspaceRolePermissions(role),
  };
}

export async function getActiveWorkspaceMembership(
  db: D1DatabaseLike,
  userId: string,
): Promise<ActiveWorkspaceMembership | null> {
  const row = await db
    .prepare(
      `
        SELECT
          workspaces.id,
          workspaces.name,
          workspaces.created_by,
          workspaces.created_at,
          workspaces.updated_at,
          workspace_members.role,
          workspace_members.joined_at

        FROM workspace_members

        INNER JOIN workspaces
          ON workspaces.id =
             workspace_members.workspace_id

        INNER JOIN users
          ON users.id =
             workspace_members.user_id

        WHERE workspace_members.user_id = ?

        ORDER BY
          CASE
            WHEN users.active_workspace_id =
                 workspaces.id
              THEN 0
            ELSE 1
          END ASC,
          datetime(
            workspace_members.joined_at
          ) ASC,
          workspaces.id ASC

        LIMIT 1
      `,
    )
    .bind(userId)
    .first<WorkspaceMembershipRow>();

  return row
    ? toActiveWorkspaceMembership(row)
    : null;
}

export async function requireActiveWorkspaceMembership(
  db: D1DatabaseLike,
  userId: string,
): Promise<ActiveWorkspaceMembership> {
  const membership =
    await getActiveWorkspaceMembership(
      db,
      userId,
    );

  if (!membership) {
    throw new Error(
      "No workspace found for this account.",
    );
  }

  return membership;
}

export async function getWorkspaceMembershipById(
  db: D1DatabaseLike,
  userId: string,
  workspaceId: string,
): Promise<ActiveWorkspaceMembership | null> {
  const row = await db
    .prepare(
      `
        SELECT
          workspaces.id,
          workspaces.name,
          workspaces.created_by,
          workspaces.created_at,
          workspaces.updated_at,
          workspace_members.role,
          workspace_members.joined_at

        FROM workspace_members

        INNER JOIN workspaces
          ON workspaces.id =
             workspace_members.workspace_id

        WHERE workspace_members.user_id = ?
          AND workspace_members.workspace_id = ?

        LIMIT 1
      `,
    )
    .bind(userId, workspaceId)
    .first<WorkspaceMembershipRow>();

  return row
    ? toActiveWorkspaceMembership(row)
    : null;
}

export async function listUserWorkspaces(
  db: D1DatabaseLike,
  userId: string,
): Promise<UserWorkspaceSummary[]> {
  const active =
    await getActiveWorkspaceMembership(
      db,
      userId,
    );

  const result = await db
    .prepare(
      `
        SELECT
          workspaces.id,
          workspaces.name,
          workspace_members.role,
          workspace_members.joined_at,

          (
            SELECT COUNT(*)
            FROM workspace_members AS wm
            WHERE wm.workspace_id = workspaces.id
          ) AS member_count,

          (
            SELECT COUNT(*)
            FROM competitors
            WHERE competitors.workspace_id =
                  workspaces.id
          ) AS competitor_count

        FROM workspace_members

        INNER JOIN workspaces
          ON workspaces.id =
             workspace_members.workspace_id

        WHERE workspace_members.user_id = ?

        ORDER BY
          datetime(
            workspace_members.joined_at
          ) ASC,
          workspaces.name COLLATE NOCASE ASC
      `,
    )
    .bind(userId)
    .all<UserWorkspaceSummaryRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    role: normalizeWorkspaceRole(
      row.role,
      "viewer",
    ),
    joinedAt: row.joined_at,
    isActive: active?.id === row.id,
    memberCount: Number(row.member_count ?? 0),
    competitorCount: Number(
      row.competitor_count ?? 0,
    ),
  }));
}

export async function switchActiveWorkspace(
  db: D1DatabaseLike,
  input: {
    userId: string;
    workspaceId: string;
  },
): Promise<ActiveWorkspaceMembership> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("Workspace ID is required.");
  }

  const membership =
    await getWorkspaceMembershipById(
      db,
      input.userId,
      workspaceId,
    );

  if (!membership) {
    throw new Error(
      "Workspace not found or access denied.",
    );
  }

  await db
    .prepare(
      `
        UPDATE users
        SET
          active_workspace_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    )
    .bind(workspaceId, input.userId)
    .run();

  return membership;
}

export async function createTeamWorkspace(
  db: D1DatabaseLike,
  input: {
    userId: string;
    name: string;
  },
): Promise<ActiveWorkspaceMembership> {
  const name = input.name.trim();
  if (!name) {
    throw new Error(
      "Workspace name is required.",
    );
  }

  if (name.length > 120) {
    throw new Error(
      "Workspace name must be 120 characters or fewer.",
    );
  }

  const workspaceId = randomUUID();

  await executeBatch(db, [
    db
      .prepare(
        `
          INSERT INTO workspaces (
            id,
            name,
            created_by,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            ?,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `,
      )
      .bind(workspaceId, name, input.userId),

    db
      .prepare(
        `
          INSERT INTO workspace_members (
            workspace_id,
            user_id,
            role,
            joined_at
          )
          VALUES (
            ?,
            ?,
            'owner',
            CURRENT_TIMESTAMP
          )
        `,
      )
      .bind(workspaceId, input.userId),

    db
      .prepare(
        `
          UPDATE users
          SET
            active_workspace_id = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
      )
      .bind(workspaceId, input.userId),
  ]);

  const created =
    await getWorkspaceMembershipById(
      db,
      input.userId,
      workspaceId,
    );

  if (!created) {
    throw new Error(
      "Failed to load newly created workspace.",
    );
  }

  return created;
}

export async function updateWorkspaceName(
  db: D1DatabaseLike,
  input: {
    userId: string;
    workspaceId: string;
    name: string;
  },
): Promise<void> {
  const workspaceId = input.workspaceId.trim();
  const name = input.name.trim();

  if (!workspaceId || !name) {
    throw new Error(
      "Workspace name is required.",
    );
  }

  if (name.length > 120) {
    throw new Error(
      "Workspace name must be 120 characters or fewer.",
    );
  }

  const membership =
    await getWorkspaceMembershipById(
      db,
      input.userId,
      workspaceId,
    );

  if (!membership) {
    throw new Error(
      "Workspace not found or access denied.",
    );
  }

  if (
    !canManageWorkspaceSettings(membership.role)
  ) {
    throw new Error(
      "Only workspace Owners and Admins can rename a workspace.",
    );
  }

  await db
    .prepare(
      `
        UPDATE workspaces
        SET
          name = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    )
    .bind(name, workspaceId)
    .run();
}

export async function inviteOrAddWorkspaceMember(
  db: D1DatabaseLike,
  input: {
    actorUserId: string;
    workspaceId: string;
    email: string;
    role: string;
  },
): Promise<{
  outcome: "member_added" | "invitation_sent";
  email: string;
  role: InvitableWorkspaceRole;
}> {
  const workspaceId = input.workspaceId.trim();
  const email = normalizeEmail(input.email);
  const rawRole = input.role.trim().toLowerCase();

  if (!workspaceId) {
    throw new Error("Workspace ID is required.");
  }

  if (!email || !EMAIL_PATTERN.test(email)) {
    throw new Error(
      "Enter a valid email address.",
    );
  }

  const actor = await getWorkspaceMembershipById(
    db,
    input.actorUserId,
    workspaceId,
  );

  if (!actor) {
    throw new Error(
      "Workspace not found or access denied.",
    );
  }

  if (!canManageTeamMembers(actor.role)) {
    throw new Error(
      "Only workspace Owners and Admins can invite or add team members.",
    );
  }

  if (!isWorkspaceRole(rawRole)) {
    throw new Error(
      "Choose a valid workspace role.",
    );
  }

  if (
    !canInviteWithWorkspaceRole(
      actor.role,
      rawRole,
    )
  ) {
    throw new Error(
      actor.role === "admin"
        ? "Workspace Admins can only invite Member or Viewer roles. Ask a workspace Owner to grant Admin access."
        : "Cannot invite a member with that role.",
    );
  }

  const existingUser = await db
    .prepare(
      `
        SELECT
          id,
          email
        FROM users
        WHERE LOWER(email) = ?
        LIMIT 1
      `,
    )
    .bind(email)
    .first<{ id: string; email: string }>();

  if (existingUser) {
    const existingMember = await db
      .prepare(
        `
          SELECT
            role
          FROM workspace_members
          WHERE workspace_id = ?
            AND user_id = ?
          LIMIT 1
        `,
      )
      .bind(workspaceId, existingUser.id)
      .first<{ role: string }>();

    if (existingMember) {
      throw new Error(
        "That user is already a member of this workspace.",
      );
    }

    await executeBatch(db, [
      db
        .prepare(
          `
            INSERT INTO workspace_members (
              workspace_id,
              user_id,
              role,
              joined_at
            )
            VALUES (
              ?,
              ?,
              ?,
              CURRENT_TIMESTAMP
            )
          `,
        )
        .bind(
          workspaceId,
          existingUser.id,
          rawRole,
        ),

      db
        .prepare(
          `
            INSERT INTO workspace_invitations (
              id,
              workspace_id,
              email,
              role,
              invited_by,
              status,
              responded_at,
              created_at,
              updated_at
            )
            VALUES (
              ?,
              ?,
              ?,
              ?,
              ?,
              'accepted',
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
            ON CONFLICT(workspace_id, email) DO UPDATE SET
              role = excluded.role,
              invited_by = excluded.invited_by,
              status = 'accepted',
              responded_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          `,
        )
        .bind(
          randomUUID(),
          workspaceId,
          email,
          rawRole,
          input.actorUserId,
        ),
    ]);

    return {
      outcome: "member_added",
      email,
      role: rawRole,
    };
  }

  await db
    .prepare(
      `
        INSERT INTO workspace_invitations (
          id,
          workspace_id,
          email,
          role,
          invited_by,
          status,
          responded_at,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          'pending',
          NULL,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT(workspace_id, email) DO UPDATE SET
          role = excluded.role,
          invited_by = excluded.invited_by,
          status = 'pending',
          responded_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .bind(
      randomUUID(),
      workspaceId,
      email,
      rawRole,
      input.actorUserId,
    )
    .run();

  return {
    outcome: "invitation_sent",
    email,
    role: rawRole,
  };
}

export async function acceptPendingWorkspaceInvitationsForUser(
  db: D1DatabaseLike,
  input: {
    userId: string;
    email: string;
  },
): Promise<number> {
  const email = normalizeEmail(input.email);
  if (!email) {
    return 0;
  }

  const pendingResult = await db
    .prepare(
      `
        SELECT
          id,
          workspace_id,
          role
        FROM workspace_invitations
        WHERE LOWER(email) = ?
          AND status = 'pending'
        ORDER BY datetime(created_at) ASC
      `,
    )
    .bind(email)
    .all<{
      id: string;
      workspace_id: string;
      role: string;
    }>();

  const pending = pendingResult.results ?? [];
  if (pending.length === 0) {
    return 0;
  }

  const statements = [];
  for (const invitation of pending) {
    const role = normalizeWorkspaceRole(
      invitation.role,
      "member",
    );

    statements.push(
      db
        .prepare(
          `
            INSERT OR IGNORE INTO workspace_members (
              workspace_id,
              user_id,
              role,
              joined_at
            )
            VALUES (
              ?,
              ?,
              ?,
              CURRENT_TIMESTAMP
            )
          `,
        )
        .bind(
          invitation.workspace_id,
          input.userId,
          role,
        ),
      db
        .prepare(
          `
            UPDATE workspace_invitations
            SET
              status = 'accepted',
              responded_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
        )
        .bind(invitation.id),
    );
  }

  await executeBatch(db, statements);
  return pending.length;
}

export async function acceptWorkspaceInvitation(
  db: D1DatabaseLike,
  input: {
    userId: string;
    invitationId: string;
  },
): Promise<ActiveWorkspaceMembership> {
  const invitationId = input.invitationId.trim();
  if (!invitationId) {
    throw new Error(
      "Invitation ID is required.",
    );
  }

  const user = await db
    .prepare(
      `
        SELECT
          id,
          email
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
    )
    .bind(input.userId)
    .first<{ id: string; email: string }>();

  if (!user) {
    throw new Error("User not found.");
  }

  const invitation = await db
    .prepare(
      `
        SELECT
          id,
          workspace_id,
          email,
          role,
          status
        FROM workspace_invitations
        WHERE id = ?
          AND LOWER(email) = ?
          AND status = 'pending'
        LIMIT 1
      `,
    )
    .bind(
      invitationId,
      normalizeEmail(user.email),
    )
    .first<{
      id: string;
      workspace_id: string;
      email: string;
      role: string;
      status: string;
    }>();

  if (!invitation) {
    throw new Error(
      "Invitation not found or already processed.",
    );
  }

  const role = normalizeWorkspaceRole(
    invitation.role,
    "member",
  );

  await executeBatch(db, [
    db
      .prepare(
        `
          INSERT OR IGNORE INTO workspace_members (
            workspace_id,
            user_id,
            role,
            joined_at
          )
          VALUES (
            ?,
            ?,
            ?,
            CURRENT_TIMESTAMP
          )
        `,
      )
      .bind(
        invitation.workspace_id,
        input.userId,
        role,
      ),

    db
      .prepare(
        `
          UPDATE workspace_invitations
          SET
            status = 'accepted',
            responded_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
      )
      .bind(invitation.id),

    db
      .prepare(
        `
          UPDATE users
          SET
            active_workspace_id = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
      )
      .bind(
        invitation.workspace_id,
        input.userId,
      ),
  ]);

  const joined =
    await getWorkspaceMembershipById(
      db,
      input.userId,
      invitation.workspace_id,
    );

  if (!joined) {
    throw new Error(
      "Failed to load workspace membership after accepting invitation.",
    );
  }

  return joined;
}

export async function revokeWorkspaceInvitation(
  db: D1DatabaseLike,
  input: {
    actorUserId: string;
    workspaceId: string;
    invitationId: string;
  },
): Promise<void> {
  const workspaceId = input.workspaceId.trim();
  const invitationId = input.invitationId.trim();

  if (!workspaceId || !invitationId) {
    throw new Error(
      "Workspace ID and invitation ID are required.",
    );
  }

  const actor = await getWorkspaceMembershipById(
    db,
    input.actorUserId,
    workspaceId,
  );

  if (!actor || !canManageTeamMembers(actor.role)) {
    throw new Error(
      "Only workspace Owners and Admins can revoke invitations.",
    );
  }

  const invitation = await db
    .prepare(
      `
        SELECT
          id,
          role,
          status
        FROM workspace_invitations
        WHERE id = ?
          AND workspace_id = ?
          AND status = 'pending'
        LIMIT 1
      `,
    )
    .bind(invitationId, workspaceId)
    .first<{
      id: string;
      role: string;
      status: string;
    }>();

  if (!invitation) {
    throw new Error(
      "Pending invitation not found.",
    );
  }

  const invitedRole = normalizeWorkspaceRole(
    invitation.role,
    "member",
  );

  if (
    !canManageTargetMemberRole(
      actor.role,
      invitedRole,
    )
  ) {
    throw new Error(
      "Only workspace Owners can revoke Admin invitations.",
    );
  }

  await db
    .prepare(
      `
        UPDATE workspace_invitations
        SET
          status = 'revoked',
          responded_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND workspace_id = ?
      `,
    )
    .bind(invitationId, workspaceId)
    .run();
}

async function getWorkspaceOwnerCount(
  db: D1DatabaseLike,
  workspaceId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `
        SELECT
          COUNT(*) AS owner_count
        FROM workspace_members
        WHERE workspace_id = ?
          AND role = 'owner'
      `,
    )
    .bind(workspaceId)
    .first<{ owner_count: number }>();

  return Number(row?.owner_count ?? 0);
}

export async function updateWorkspaceMemberRole(
  db: D1DatabaseLike,
  input: {
    actorUserId: string;
    workspaceId: string;
    targetUserId: string;
    nextRole: string;
  },
): Promise<WorkspaceRole> {
  const workspaceId = input.workspaceId.trim();
  const targetUserId = input.targetUserId.trim();
  const rawNextRole = input.nextRole
    .trim()
    .toLowerCase();

  if (!workspaceId || !targetUserId) {
    throw new Error(
      "Workspace ID and member ID are required.",
    );
  }

  if (!isWorkspaceRole(rawNextRole)) {
    throw new Error(
      "Choose a valid workspace role.",
    );
  }

  const [actor, target] = await Promise.all([
    getWorkspaceMembershipById(
      db,
      input.actorUserId,
      workspaceId,
    ),
    getWorkspaceMembershipById(
      db,
      targetUserId,
      workspaceId,
    ),
  ]);

  if (!actor) {
    throw new Error(
      "Workspace not found or access denied.",
    );
  }

  if (!canManageTeamMembers(actor.role)) {
    throw new Error(
      "Only workspace Owners and Admins can change member roles.",
    );
  }

  if (!target) {
    throw new Error(
      "Workspace member not found.",
    );
  }

  if (
    !canManageTargetMemberRole(
      actor.role,
      target.role,
    )
  ) {
    throw new Error(
      "Only workspace Owners can change the role of an Owner or Admin.",
    );
  }

  if (
    !canAssignWorkspaceRole(
      actor.role,
      rawNextRole,
    )
  ) {
    throw new Error(
      "Only workspace Owners can grant Owner or Admin roles.",
    );
  }

  if (target.role === rawNextRole) {
    return rawNextRole;
  }

  if (
    target.role === "owner" &&
    rawNextRole !== "owner"
  ) {
    const ownerCount =
      await getWorkspaceOwnerCount(
        db,
        workspaceId,
      );
    if (ownerCount <= 1) {
      throw new Error(
        "Each workspace must keep at least one Owner. Promote another member to Owner first.",
      );
    }
  }

  await db
    .prepare(
      `
        UPDATE workspace_members
        SET role = ?
        WHERE workspace_id = ?
          AND user_id = ?
      `,
    )
    .bind(rawNextRole, workspaceId, targetUserId)
    .run();

  return rawNextRole;
}

export async function removeWorkspaceMember(
  db: D1DatabaseLike,
  input: {
    actorUserId: string;
    workspaceId: string;
    targetUserId: string;
  },
): Promise<void> {
  const workspaceId = input.workspaceId.trim();
  const targetUserId = input.targetUserId.trim();

  if (!workspaceId || !targetUserId) {
    throw new Error(
      "Workspace ID and member ID are required.",
    );
  }

  const [actor, target] = await Promise.all([
    getWorkspaceMembershipById(
      db,
      input.actorUserId,
      workspaceId,
    ),
    getWorkspaceMembershipById(
      db,
      targetUserId,
      workspaceId,
    ),
  ]);

  if (!actor) {
    throw new Error(
      "Workspace not found or access denied.",
    );
  }

  if (!target) {
    throw new Error(
      "Workspace member not found.",
    );
  }

  const isSelf =
    input.actorUserId === targetUserId;

  if (!isSelf) {
    if (!canManageTeamMembers(actor.role)) {
      throw new Error(
        "Only workspace Owners and Admins can remove team members.",
      );
    }

    if (
      !canManageTargetMemberRole(
        actor.role,
        target.role,
      )
    ) {
      throw new Error(
        "Only workspace Owners can remove an Owner or Admin.",
      );
    }
  }

  if (target.role === "owner") {
    const ownerCount =
      await getWorkspaceOwnerCount(
        db,
        workspaceId,
      );
    if (ownerCount <= 1) {
      throw new Error(
        isSelf
          ? "You are the only Owner of this workspace. Promote another member to Owner before leaving."
          : "Each workspace must keep at least one Owner.",
      );
    }
  }

  const targetWorkspaceCountRow = await db
    .prepare(
      `
        SELECT
          COUNT(*) AS total
        FROM workspace_members
        WHERE user_id = ?
      `,
    )
    .bind(targetUserId)
    .first<{ total: number }>();

  const targetWorkspaceCount = Number(
    targetWorkspaceCountRow?.total ?? 0,
  );

  if (targetWorkspaceCount <= 1) {
    throw new Error(
      isSelf
        ? "You cannot leave your only workspace."
        : "Cannot remove a user from their only workspace.",
    );
  }

  await executeBatch(db, [
    db
      .prepare(
        `
          DELETE FROM workspace_members
          WHERE workspace_id = ?
            AND user_id = ?
        `,
      )
      .bind(workspaceId, targetUserId),

    db
      .prepare(
        `
          UPDATE users
          SET
            active_workspace_id = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND active_workspace_id = ?
        `,
      )
      .bind(targetUserId, workspaceId),
  ]);
}

export async function getWorkspaceTeamSnapshot(
  db: D1DatabaseLike,
  userId: string,
): Promise<WorkspaceTeamSnapshot> {
  const activeWorkspace =
    await requireActiveWorkspaceMembership(
      db,
      userId,
    );

  const [
    workspaces,
    membersResult,
    invitationsResult,
    userRow,
  ] = await Promise.all([
    listUserWorkspaces(db, userId),

    db
      .prepare(
        `
          SELECT
            workspace_members.user_id,
            users.name,
            users.email,
            users.email_verified,
            workspace_members.role,
            workspace_members.joined_at

          FROM workspace_members

          INNER JOIN users
            ON users.id =
               workspace_members.user_id

          WHERE workspace_members.workspace_id = ?

          ORDER BY
            CASE workspace_members.role
              WHEN 'owner' THEN 1
              WHEN 'admin' THEN 2
              WHEN 'member' THEN 3
              WHEN 'viewer' THEN 4
              ELSE 5
            END ASC,
            datetime(
              workspace_members.joined_at
            ) ASC,
            users.email COLLATE NOCASE ASC
        `,
      )
      .bind(activeWorkspace.id)
      .all<WorkspaceMemberRow>(),

    db
      .prepare(
        `
          SELECT
            workspace_invitations.id,
            workspace_invitations.workspace_id,
            workspace_invitations.email,
            workspace_invitations.role,
            workspace_invitations.status,
            workspace_invitations.invited_by,
            users.name AS invited_by_name,
            users.email AS invited_by_email,
            workspace_invitations.created_at,
            workspace_invitations.updated_at

          FROM workspace_invitations

          INNER JOIN users
            ON users.id =
               workspace_invitations.invited_by

          WHERE workspace_invitations.workspace_id = ?
            AND workspace_invitations.status = 'pending'

          ORDER BY
            datetime(
              workspace_invitations.created_at
            ) DESC,
            workspace_invitations.email COLLATE NOCASE ASC
        `,
      )
      .bind(activeWorkspace.id)
      .all<WorkspaceInvitationRow>(),

    db
      .prepare(
        `
          SELECT
            email
          FROM users
          WHERE id = ?
          LIMIT 1
        `,
      )
      .bind(userId)
      .first<{ email: string }>(),
  ]);

  const incomingResult = userRow?.email
    ? await db
        .prepare(
          `
            SELECT
              workspace_invitations.id,
              workspace_invitations.workspace_id,
              workspaces.name AS workspace_name,
              workspace_invitations.role,
              inviter.name AS invited_by_name,
              inviter.email AS invited_by_email,
              workspace_invitations.created_at

            FROM workspace_invitations

            INNER JOIN workspaces
              ON workspaces.id =
                 workspace_invitations.workspace_id

            INNER JOIN users AS inviter
              ON inviter.id =
                 workspace_invitations.invited_by

            WHERE LOWER(workspace_invitations.email) = ?
              AND workspace_invitations.status = 'pending'
              AND NOT EXISTS (
                SELECT 1
                FROM workspace_members
                WHERE workspace_members.workspace_id =
                      workspace_invitations.workspace_id
                  AND workspace_members.user_id = ?
              )

            ORDER BY
              datetime(
                workspace_invitations.created_at
              ) DESC
          `,
        )
        .bind(
          normalizeEmail(userRow.email),
          userId,
        )
        .all<IncomingInvitationRow>()
    : { results: [] };

  const rawMembers = membersResult.results ?? [];
  const ownerCount = rawMembers.filter(
    (member) =>
      normalizeWorkspaceRole(
        member.role,
        "viewer",
      ) === "owner",
  ).length;

  const hasMultipleWorkspaces =
    workspaces.length > 1;

  const members: WorkspaceMemberView[] =
    rawMembers.map((row) => {
      const role = normalizeWorkspaceRole(
        row.role,
        "viewer",
      );
      const isCurrentUser =
        row.user_id === userId;
      const isLastOwner =
        role === "owner" && ownerCount <= 1;

      const canManageTarget =
        canManageTeamMembers(
          activeWorkspace.role,
        ) &&
        canManageTargetMemberRole(
          activeWorkspace.role,
          role,
        );

      const canChangeRole =
        canManageTarget &&
        (!isLastOwner ||
          activeWorkspace.role === "owner");

      const canRemove = isCurrentUser
        ? hasMultipleWorkspaces && !isLastOwner
        : canManageTarget && !isLastOwner;

      return {
        userId: row.user_id,
        name: row.name,
        email: row.email,
        emailVerified: row.email_verified === 1,
        role,
        joinedAt: row.joined_at,
        isCurrentUser,
        canChangeRole,
        canRemove,
      };
    });

  const pendingInvitations: WorkspaceInvitationView[] =
    (invitationsResult.results ?? []).map(
      (row) => {
        const normalizedRole =
          normalizeWorkspaceRole(
            row.role,
            "member",
          );
        const invitableRole: InvitableWorkspaceRole =
          normalizedRole === "admin" ||
          normalizedRole === "viewer"
            ? normalizedRole
            : "member";

        return {
          id: row.id,
          workspaceId: row.workspace_id,
          email: row.email,
          role: invitableRole,
          status:
            row.status === "accepted" ||
            row.status === "revoked"
              ? row.status
              : "pending",
          invitedByUserId: row.invited_by,
          invitedByName: row.invited_by_name,
          invitedByEmail: row.invited_by_email,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          canRevoke:
            canManageTeamMembers(
              activeWorkspace.role,
            ) &&
            canManageTargetMemberRole(
              activeWorkspace.role,
              invitableRole,
            ),
        };
      },
    );

  const incomingInvitations: PendingUserInvitationView[] =
    (incomingResult.results ?? []).map((row) => {
      const normalizedRole =
        normalizeWorkspaceRole(
          row.role,
          "member",
        );
      const invitableRole: InvitableWorkspaceRole =
        normalizedRole === "admin" ||
        normalizedRole === "viewer"
          ? normalizedRole
          : "member";

      return {
        id: row.id,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        role: invitableRole,
        invitedByName: row.invited_by_name,
        invitedByEmail: row.invited_by_email,
        createdAt: row.created_at,
      };
    });

  const canLeaveWorkspace =
    hasMultipleWorkspaces &&
    !(
      activeWorkspace.role === "owner" &&
      ownerCount <= 1
    );

  return {
    activeWorkspace,
    workspaces,
    members,
    pendingInvitations,
    incomingInvitations,
    ownerCount,
    canLeaveWorkspace,
  };
}
