import { WorkspaceActionForm } from "@/components/workspace-feedback";
import { WorkspacePanel } from "@/components/workspace-panel";
import { auth } from "@/lib/auth";
import { getWorkspaceTeamSnapshot } from "@/lib/team-workspaces";
import {
  WORKSPACE_ROLES,
  WORKSPACE_ROLE_DETAILS,
  canInviteWithWorkspaceRole,
  canManageTargetMemberRole,
  type WorkspaceRole,
} from "@/lib/workspace-roles";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  acceptInvitationAction,
  createWorkspaceAction,
  inviteWorkspaceMemberAction,
  removeMemberAction,
  renameWorkspaceAction,
  revokeInvitationAction,
  switchWorkspaceAction,
  updateMemberRoleAction,
} from "./actions";

function normalizeDatabaseTimestamp(value: string): string {
  if (
    value.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(value)
  ) {
    return value;
  }

  return `${value.replace(" ", "T")}Z`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(
    normalizeDatabaseTimestamp(value),
  );

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function getRoleBadgeClassName(
  role: WorkspaceRole,
): string {
  switch (role) {
    case "owner":
      return "workspace-badge health-healthy";
    case "admin":
      return "workspace-badge significance-moderate";
    case "member":
      return "workspace-badge";
    case "viewer":
      return "workspace-badge health-paused";
  }
}

export default async function TeamWorkspacesPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const snapshot = await getWorkspaceTeamSnapshot(
    env.DB,
    session.user.id,
  );

  const {
    activeWorkspace,
    workspaces,
    members,
    pendingInvitations,
    incomingInvitations,
    ownerCount,
  } = snapshot;
  const { permissions } = activeWorkspace;
  const adminOrOwnerCount = members.filter(
    (member) =>
      member.role === "owner" ||
      member.role === "admin",
  ).length;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
              Team &amp; workspaces
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
              Collaborate on shared competitor intelligence across workspaces with role-based permissions for Owners, Admins, Members, and Viewers.
            </p>
          </div>

          <div className="workspace-record-actions shrink-0">
            <WorkspacePanel
              label="New workspace"
              title="Create a team workspace"
            >
              <div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Create a dedicated workspace to separate competitors, monitored pages, and notification channels by team, client, or business unit.
                </p>

                <WorkspaceActionForm
                  key={activeWorkspace.id}
                  action={createWorkspaceAction}
                  successMessage="Workspace created and set as active."
                  className="mt-5 grid gap-4"
                >
                  <div>
                    <label
                      htmlFor="new-workspace-name"
                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
                    >
                      Workspace name
                    </label>
                    <input
                      id="new-workspace-name"
                      name="name"
                      type="text"
                      required
                      maxLength={80}
                      placeholder="Acme Product Marketing"
                    />
                  </div>

                  <div>
                    <button
                      type="submit"
                      className="workspace-primary"
                    >
                      Create workspace
                    </button>
                  </div>
                </WorkspaceActionForm>
              </div>
            </WorkspacePanel>

            {permissions.canManageTeamMembers ? (
              <WorkspacePanel
                label="Invite teammate"
                title={`Invite to ${activeWorkspace.name}`}
              >
                <div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    If the email belongs to an existing Morrow user, they are added to{" "}
                    <strong>{activeWorkspace.name}</strong>{" "}
                    immediately. Otherwise, a pending invitation is created and automatically accepted when they sign up.
                  </p>

                  <WorkspaceActionForm
                    key={activeWorkspace.id}
                    action={inviteWorkspaceMemberAction}
                    successMessage="Team invitation saved."
                    className="mt-5 grid gap-4"
                  >
                    <div>
                      <label
                        htmlFor="invite-member-email"
                        className="mb-1.5 block text-xs font-medium text-muted-foreground"
                      >
                        Teammate email address
                      </label>
                      <input
                        id="invite-member-email"
                        name="email"
                        type="email"
                        required
                        placeholder="teammate@company.com"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="invite-member-role"
                        className="mb-1.5 block text-xs font-medium text-muted-foreground"
                      >
                        Workspace role
                      </label>
                      <select
                        id="invite-member-role"
                        name="role"
                        defaultValue="member"
                      >
                        {permissions.invitableRoles.map(
                          (roleOption) => (
                            <option
                              key={roleOption}
                              value={roleOption}
                            >
                              {
                                WORKSPACE_ROLE_DETAILS[
                                  roleOption
                                ].label
                              }{" "}
                              —{" "}
                              {
                                WORKSPACE_ROLE_DETAILS[
                                  roleOption
                                ].summary
                              }
                            </option>
                          ),
                        )}
                      </select>
                    </div>

                    <div>
                      <button
                        type="submit"
                        className="workspace-primary"
                      >
                        Send invite or add member
                      </button>
                    </div>
                  </WorkspaceActionForm>
                </div>
              </WorkspacePanel>
            ) : null}
          </div>
        </header>

        {incomingInvitations.length > 0 ? (
          <section className="mt-8">
            <div className="workspace-surface">
              <div className="workspace-section-heading">
                <h2>Pending workspace invitations for you</h2>

                <span className="workspace-badge significance-moderate">
                  {incomingInvitations.length} pending
                </span>
              </div>

              <p className="workspace-section-helper">
                You have been invited to collaborate in the following workspaces with{" "}
                <strong>{session.user.email}</strong>.
              </p>

              <div className="workspace-records mt-2">
                {incomingInvitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="workspace-record flex flex-col justify-between gap-4 sm:flex-row sm:items-center"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-base font-semibold text-foreground">
                          {invitation.workspaceName}
                        </strong>
                        <span
                          className={getRoleBadgeClassName(
                            invitation.role,
                          )}
                        >
                          {
                            WORKSPACE_ROLE_DETAILS[
                              invitation.role
                            ].label
                          }
                        </span>
                      </div>
                      <div className="workspace-record-meta">
                        <span>
                          Invited by{" "}
                          {invitation.invitedByName ||
                            invitation.invitedByEmail}
                        </span>
                        <span>•</span>
                        <time>
                          {formatDateTime(
                            invitation.createdAt,
                          )}
                        </time>
                      </div>
                    </div>

                    <div className="shrink-0 self-start sm:self-center">
                      <WorkspaceActionForm
                        action={acceptInvitationAction}
                        successMessage={`Joined ${invitation.workspaceName}.`}
                      >
                        <input
                          type="hidden"
                          name="invitationId"
                          value={invitation.id}
                        />
                        <button
                          type="submit"
                          className="workspace-primary"
                        >
                          Accept &amp; switch workspace
                        </button>
                      </WorkspaceActionForm>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="workspace-metrics mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="workspace-metric-label">
              Active workspace
            </div>
            <div className="workspace-metric-value">
              {activeWorkspace.name}
            </div>
            <div className="workspace-meta">
              Your role:{" "}
              <strong>
                {
                  WORKSPACE_ROLE_DETAILS[
                    activeWorkspace.role
                  ].label
                }
              </strong>
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="workspace-metric-label">
              Team members
            </div>
            <div className="workspace-metric-value">
              {members.length}
            </div>
            <div className="workspace-meta">
              {adminOrOwnerCount}{" "}
              {adminOrOwnerCount === 1
                ? "owner/admin"
                : "owners/admins"}{" "}
              in workspace
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="workspace-metric-label">
              Pending invitations
            </div>
            <div className="workspace-metric-value">
              {pendingInvitations.length}
            </div>
            <div className="workspace-meta">
              awaiting signup or acceptance
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="workspace-metric-label">
              Your workspaces
            </div>
            <div className="workspace-metric-value">
              {workspaces.length}
            </div>
            <div className="workspace-meta">
              shared competitor environments
            </div>
          </article>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="workspace-surface">
            <div className="workspace-section-heading">
              <h2>Your workspaces</h2>
            </div>

            <p className="workspace-section-helper">
              Switch your active workspace to view its competitors, monitored pages, change history, and notification channels.
            </p>

            <div className="workspace-records mt-2">
              {workspaces.map((item) => (
                <div
                  key={item.id}
                  className="workspace-record flex flex-col justify-between gap-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-base font-semibold text-foreground">
                        {item.name}
                      </strong>
                      <span
                        className={getRoleBadgeClassName(
                          item.role,
                        )}
                      >
                        {
                          WORKSPACE_ROLE_DETAILS[item.role]
                            .label
                        }
                      </span>
                      {item.isActive ? (
                        <span className="workspace-badge health-healthy">
                          Active
                        </span>
                      ) : null}
                    </div>

                    <div className="workspace-record-meta">
                      <span>
                        {item.competitorCount}{" "}
                        {item.competitorCount === 1
                          ? "competitor"
                          : "competitors"}
                      </span>
                      <span>•</span>
                      <span>
                        {item.memberCount}{" "}
                        {item.memberCount === 1
                          ? "member"
                          : "members"}
                      </span>
                      <span>•</span>
                      <span>
                        Joined{" "}
                        {formatDateTime(item.joinedAt)}
                      </span>
                    </div>
                  </div>

                  {!item.isActive ? (
                    <div className="shrink-0 self-start sm:self-center">
                      <WorkspaceActionForm
                        action={switchWorkspaceAction}
                        successMessage={`Switched to ${item.name}.`}
                      >
                        <input
                          type="hidden"
                          name="workspaceId"
                          value={item.id}
                        />
                        <button
                          type="submit"
                          className="workspace-panel-trigger workspace-panel-secondary"
                        >
                          Switch
                        </button>
                      </WorkspaceActionForm>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="workspace-surface">
            <div className="workspace-section-heading">
              <h2>Active workspace settings</h2>

              <span
                className={getRoleBadgeClassName(
                  activeWorkspace.role,
                )}
              >
                {
                  WORKSPACE_ROLE_DETAILS[
                    activeWorkspace.role
                  ].label
                }
              </span>
            </div>

            <p className="workspace-section-helper">
              Manage the identity and access level of{" "}
              <strong>{activeWorkspace.name}</strong>.
            </p>

            <p className="mt-3 text-sm text-muted-foreground">
              {
                WORKSPACE_ROLE_DETAILS[
                  activeWorkspace.role
                ].summary
              }
            </p>

            {permissions.canManageWorkspaceSettings ? (
              <WorkspaceActionForm
                key={`${activeWorkspace.id}:${activeWorkspace.name}`}
                action={renameWorkspaceAction}
                successMessage="Workspace name updated."
                className="mt-5 grid gap-4 border-t border-border pt-4"
              >
                <div>
                  <label
                    htmlFor="rename-workspace-input"
                    className="mb-1.5 block text-xs font-medium text-muted-foreground"
                  >
                    Workspace name
                  </label>
                  <input
                    id="rename-workspace-input"
                    name="name"
                    type="text"
                    required
                    maxLength={80}
                    defaultValue={activeWorkspace.name}
                  />
                </div>

                <div>
                  <button
                    type="submit"
                    className="workspace-primary"
                  >
                    Save workspace name
                  </button>
                </div>
              </WorkspaceActionForm>
            ) : (
              <p className="mt-4 rounded-xl border border-border bg-muted px-4 py-3 text-xs text-muted-foreground">
                Only workspace Owners and Admins can rename this workspace or manage delivery channels and team members.
              </p>
            )}
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
                Workspace members
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Everyone in{" "}
                <strong>{activeWorkspace.name}</strong>{" "}
                shares access to its tracked competitors, monitored page snapshots, and change insights according to their role.
              </p>
            </div>

            <div className="text-sm font-medium text-muted-foreground">
              {members.length}{" "}
              {members.length === 1
                ? "member"
                : "members"}
            </div>
          </div>

          <div className="workspace-list space-y-4">
            {members.map((member) => {
              const isSelf =
                member.userId === session.user.id;
              const canManageMember =
                !isSelf &&
                permissions.canManageTeamMembers &&
                canManageTargetMemberRole(
                  activeWorkspace.role,
                  member.role,
                );
              const isLastOwner =
                member.role === "owner" &&
                ownerCount <= 1;
              const canLeaveWorkspace =
                isSelf &&
                workspaces.length > 1 &&
                !isLastOwner;

              const roleSelectOptions = Array.from(
                new Set<WorkspaceRole>([
                  member.role,
                  ...permissions.assignableRoles,
                ]),
              );

              return (
                <article
                  key={`${activeWorkspace.id}:${member.userId}:${member.role}`}
                  className="workspace-competitor-record overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">
                          {member.name || member.email}
                        </h3>

                        {isSelf ? (
                          <span className="workspace-badge">
                            You
                          </span>
                        ) : null}

                        <span
                          className={getRoleBadgeClassName(
                            member.role,
                          )}
                        >
                          {
                            WORKSPACE_ROLE_DETAILS[
                              member.role
                            ].label
                          }
                        </span>

                        {!member.emailVerified ? (
                          <span className="workspace-badge health-overdue">
                            Unverified email
                          </span>
                        ) : null}
                      </div>

                      <div className="workspace-url">
                        {member.email}
                      </div>

                      <div className="workspace-record-meta">
                        <span>
                          Joined{" "}
                          {formatDateTime(member.joinedAt)}
                        </span>
                        <span>•</span>
                        <span>
                          {
                            WORKSPACE_ROLE_DETAILS[
                              member.role
                            ].summary
                          }
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {canManageMember ? (
                        <>
                          <WorkspaceActionForm
                            action={updateMemberRoleAction}
                            successMessage={`Updated role for ${member.email}.`}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <input
                              type="hidden"
                              name="targetUserId"
                              value={member.userId}
                            />
                            <label
                              htmlFor={`member-role-${member.userId}`}
                              className="sr-only"
                            >
                              Role for {member.email}
                            </label>
                            <select
                              id={`member-role-${member.userId}`}
                              name="role"
                              defaultValue={member.role}
                              disabled={
                                isLastOwner &&
                                activeWorkspace.role ===
                                  "owner"
                              }
                            >
                              {roleSelectOptions.map(
                                (roleOption) => (
                                  <option
                                    key={roleOption}
                                    value={roleOption}
                                  >
                                    {
                                      WORKSPACE_ROLE_DETAILS[
                                        roleOption
                                      ].label
                                    }
                                  </option>
                                ),
                              )}
                            </select>
                            <button
                              type="submit"
                              className="workspace-panel-trigger workspace-panel-secondary"
                              disabled={
                                isLastOwner &&
                                activeWorkspace.role ===
                                  "owner"
                              }
                            >
                              Update role
                            </button>
                          </WorkspaceActionForm>

                          {!isLastOwner ? (
                            <WorkspaceActionForm
                              action={removeMemberAction}
                              successMessage={`Removed ${member.email} from workspace.`}
                            >
                              <input
                                type="hidden"
                                name="targetUserId"
                                value={member.userId}
                              />
                              <button
                                type="submit"
                                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-destructive-border bg-card px-3.5 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive-bg"
                              >
                                Remove
                              </button>
                            </WorkspaceActionForm>
                          ) : null}
                        </>
                      ) : null}

                      {canLeaveWorkspace ? (
                        <WorkspaceActionForm
                          action={removeMemberAction}
                          successMessage={`Left ${activeWorkspace.name}.`}
                        >
                          <input
                            type="hidden"
                            name="targetUserId"
                            value={member.userId}
                          />
                          <button
                            type="submit"
                            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-destructive-border bg-card px-3.5 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive-bg"
                          >
                            Leave workspace
                          </button>
                        </WorkspaceActionForm>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {pendingInvitations.length > 0 ? (
          <section className="mt-10">
            <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
                  Pending workspace invitations
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Invited teammates automatically join{" "}
                  <strong>{activeWorkspace.name}</strong>{" "}
                  when they create a Morrow account or accept their invite.
                </p>
              </div>

              <div className="text-sm font-medium text-muted-foreground">
                {pendingInvitations.length} pending
              </div>
            </div>

            <div className="workspace-list space-y-4">
              {pendingInvitations.map((invitation) => {
                const canRevoke =
                  permissions.canManageTeamMembers &&
                  canInviteWithWorkspaceRole(
                    activeWorkspace.role,
                    invitation.role,
                  );

                return (
                  <article
                    key={invitation.id}
                    className="workspace-competitor-record overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                  >
                    <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-foreground">
                            {invitation.email}
                          </h3>
                          <span
                            className={getRoleBadgeClassName(
                              invitation.role,
                            )}
                          >
                            {
                              WORKSPACE_ROLE_DETAILS[
                                invitation.role
                              ].label
                            }
                          </span>
                          <span className="workspace-badge health-overdue">
                            Pending
                          </span>
                        </div>

                        <div className="workspace-record-meta">
                          <span>
                            Invited by{" "}
                            {invitation.invitedByName ||
                              invitation.invitedByEmail ||
                              "Workspace admin"}
                          </span>
                          <span>•</span>
                          <time>
                            {formatDateTime(
                              invitation.createdAt,
                            )}
                          </time>
                        </div>
                      </div>

                      {canRevoke ? (
                        <div className="flex justify-end">
                          <WorkspaceActionForm
                            action={revokeInvitationAction}
                            successMessage={`Revoked invitation for ${invitation.email}.`}
                          >
                            <input
                              type="hidden"
                              name="invitationId"
                              value={invitation.id}
                            />
                            <button
                              type="submit"
                              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-destructive-border bg-card px-3.5 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive-bg"
                            >
                              Revoke invite
                            </button>
                          </WorkspaceActionForm>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="mt-10">
          <div className="workspace-surface">
            <div className="workspace-section-heading">
              <div>
                <h2>Workspace roles &amp; permissions</h2>
                <p className="workspace-section-helper">
                  Reference matrix for what each role can access and modify inside a shared Morrow workspace.
                </p>
              </div>
            </div>

            <div className="workspace-records mt-2">
              {WORKSPACE_ROLES.map((roleKey) => {
                const detail =
                  WORKSPACE_ROLE_DETAILS[roleKey];
                return (
                  <div
                    key={roleKey}
                    className="workspace-record"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={getRoleBadgeClassName(
                          roleKey,
                        )}
                      >
                        {detail.label}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {detail.summary}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
