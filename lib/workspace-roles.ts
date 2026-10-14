export const WORKSPACE_ROLES = [
  "owner",
  "admin",
  "member",
  "viewer",
] as const;

export type WorkspaceRole =
  (typeof WORKSPACE_ROLES)[number];

export const INVITABLE_WORKSPACE_ROLES = [
  "admin",
  "member",
  "viewer",
] as const;

export type InvitableWorkspaceRole =
  (typeof INVITABLE_WORKSPACE_ROLES)[number];

const WORKSPACE_ROLE_RANK: Record<
  WorkspaceRole,
  number
> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export interface WorkspaceRoleMetadata {
  role: WorkspaceRole;
  label: string;
  summary: string;
}

export const WORKSPACE_ROLE_DETAILS: Record<
  WorkspaceRole,
  WorkspaceRoleMetadata
> = {
  owner: {
    role: "owner",
    label: "Owner",
    summary:
      "Full control over workspace settings, admins, team members, external channels, and monitored competitors.",
  },
  admin: {
    role: "admin",
    label: "Admin",
    summary:
      "Can rename the workspace, manage external notification channels, delete competitors or pages, and manage Member and Viewer access.",
  },
  member: {
    role: "member",
    label: "Member",
    summary:
      "Can add, edit, pause, and resume competitors, monitored pages, and selector rules, plus manage personal email alerts.",
  },
  viewer: {
    role: "viewer",
    label: "Viewer",
    summary:
      "Read-only access to workspace competitors, monitored pages, change history, and personal email notification preferences.",
  },
};

export interface WorkspaceRolePermissions {
  role: WorkspaceRole;
  canReadWorkspace: boolean;
  canEditMonitoring: boolean;
  canDeleteMonitoringResources: boolean;
  canManageWorkspaceChannels: boolean;
  canManageWorkspaceSettings: boolean;
  canManageTeamMembers: boolean;
  canManageWorkspaceBilling: boolean;
  assignableRoles: WorkspaceRole[];
  invitableRoles: InvitableWorkspaceRole[];
}

export function isWorkspaceRole(
  value: unknown,
): value is WorkspaceRole {
  return (
    typeof value === "string" &&
    (WORKSPACE_ROLES as readonly string[]).includes(
      value,
    )
  );
}

export function normalizeWorkspaceRole(
  value: unknown,
  fallback: WorkspaceRole = "viewer",
): WorkspaceRole {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (isWorkspaceRole(normalized)) {
      return normalized;
    }
  }

  return fallback;
}

export function hasWorkspaceRoleAtLeast(
  role: WorkspaceRole,
  minimumRole: WorkspaceRole,
): boolean {
  return (
    WORKSPACE_ROLE_RANK[role] >=
    WORKSPACE_ROLE_RANK[minimumRole]
  );
}

export function canReadWorkspace(
  role: WorkspaceRole,
): boolean {
  return hasWorkspaceRoleAtLeast(role, "viewer");
}

export function canEditMonitoring(
  role: WorkspaceRole,
): boolean {
  return hasWorkspaceRoleAtLeast(role, "member");
}

export function canDeleteMonitoringResources(
  role: WorkspaceRole,
): boolean {
  return hasWorkspaceRoleAtLeast(role, "admin");
}

export function canManageWorkspaceChannels(
  role: WorkspaceRole,
): boolean {
  return hasWorkspaceRoleAtLeast(role, "admin");
}

export function canManageWorkspaceSettings(
  role: WorkspaceRole,
): boolean {
  return hasWorkspaceRoleAtLeast(role, "admin");
}

export function canManageTeamMembers(
  role: WorkspaceRole,
): boolean {
  return hasWorkspaceRoleAtLeast(role, "admin");
}

export function canManageWorkspaceBilling(
  role: WorkspaceRole,
): boolean {
  return role === "owner";
}

export function getAssignableWorkspaceRoles(
  actorRole: WorkspaceRole,
): WorkspaceRole[] {
  if (actorRole === "owner") {
    return ["owner", "admin", "member", "viewer"];
  }

  if (actorRole === "admin") {
    return ["member", "viewer"];
  }

  return [];
}

export function getInvitableWorkspaceRoles(
  actorRole: WorkspaceRole,
): InvitableWorkspaceRole[] {
  if (actorRole === "owner") {
    return ["admin", "member", "viewer"];
  }

  if (actorRole === "admin") {
    return ["member", "viewer"];
  }

  return [];
}

export function canAssignWorkspaceRole(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
): boolean {
  return getAssignableWorkspaceRoles(
    actorRole,
  ).includes(targetRole);
}

export function canInviteWithWorkspaceRole(
  actorRole: WorkspaceRole,
  invitedRole: WorkspaceRole,
): invitedRole is InvitableWorkspaceRole {
  return (
    getInvitableWorkspaceRoles(actorRole) as readonly string[]
  ).includes(invitedRole);
}

export function canManageTargetMemberRole(
  actorRole: WorkspaceRole,
  targetCurrentRole: WorkspaceRole,
): boolean {
  if (actorRole === "owner") {
    return true;
  }

  if (actorRole === "admin") {
    return (
      targetCurrentRole === "member" ||
      targetCurrentRole === "viewer"
    );
  }

  return false;
}

export function getWorkspaceRolePermissions(
  role: WorkspaceRole,
): WorkspaceRolePermissions {
  return {
    role,
    canReadWorkspace: canReadWorkspace(role),
    canEditMonitoring: canEditMonitoring(role),
    canDeleteMonitoringResources:
      canDeleteMonitoringResources(role),
    canManageWorkspaceChannels:
      canManageWorkspaceChannels(role),
    canManageWorkspaceSettings:
      canManageWorkspaceSettings(role),
    canManageTeamMembers:
      canManageTeamMembers(role),
    canManageWorkspaceBilling:
      canManageWorkspaceBilling(role),
    assignableRoles:
      getAssignableWorkspaceRoles(role),
    invitableRoles:
      getInvitableWorkspaceRoles(role),
  };
}
