import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createWorkspaceExternalChannel,
  getWorkspaceNotificationSettings,
  removeWorkspaceExternalChannel,
  saveUserEmailNotificationPreferences,
  toggleWorkspaceExternalChannelStatus,
  updateWorkspaceExternalChannel,
} from "../lib/notification-settings.ts";
import {
  acceptPendingWorkspaceInvitationsForUser,
  acceptWorkspaceInvitation,
  createTeamWorkspace,
  getActiveWorkspaceMembership,
  getWorkspaceTeamSnapshot,
  inviteOrAddWorkspaceMember,
  listUserWorkspaces,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  switchActiveWorkspace,
  updateWorkspaceMemberRole,
  updateWorkspaceName,
} from "../lib/team-workspaces.ts";
import {
  INVITABLE_WORKSPACE_ROLES,
  WORKSPACE_ROLES,
  canAssignWorkspaceRole,
  canDeleteMonitoringResources,
  canEditMonitoring,
  canInviteWithWorkspaceRole,
  canManageTargetMemberRole,
  canManageTeamMembers,
  canManageWorkspaceChannels,
  canManageWorkspaceSettings,
  canReadWorkspace,
  getWorkspaceRolePermissions,
  hasWorkspaceRoleAtLeast,
  isWorkspaceRole,
  normalizeWorkspaceRole,
} from "../lib/workspace-roles.ts";

function createD1Fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const migrationFiles = readdirSync(
    new URL("../migrations/", import.meta.url),
  )
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    sqlite.exec(
      readFileSync(
        new URL(`../migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  }

  t.after(() => sqlite.close());

  const db = {
    prepare(sql) {
      let boundValues = [];
      return {
        bind(...args) {
          boundValues = args;
          return this;
        },
        async all() {
          const results = sqlite
            .prepare(sql)
            .all(...boundValues);
          const meta = sqlite
            .prepare("SELECT changes() AS changes")
            .get();
          return {
            results,
            meta,
            success: true,
          };
        },
        async first() {
          return (
            sqlite.prepare(sql).get(...boundValues) ?? null
          );
        },
        async run() {
          const info = sqlite
            .prepare(sql)
            .run(...boundValues);
          return {
            results: [],
            meta: {
              changes: Number(info.changes ?? 0),
            },
            success: true,
          };
        },
      };
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    },
  };

  sqlite
    .prepare(
      `
        INSERT INTO users (id, email, name, email_verified)
        VALUES
          ('usr_owner', 'owner@acme.test', 'Alice Owner', 1),
          ('usr_admin', 'admin@acme.test', 'Bob Admin', 1),
          ('usr_member', 'member@acme.test', 'Charlie Member', 1),
          ('usr_viewer', 'viewer@acme.test', 'Dana Viewer', 1),
          ('usr_external', 'external@other.test', 'Eve External', 1)
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO workspaces (id, name, created_by)
        VALUES
          ('ws_acme', 'Acme Workspace', 'usr_owner'),
          ('ws_admin_home', 'Bob Personal', 'usr_admin'),
          ('ws_member_home', 'Charlie Personal', 'usr_member'),
          ('ws_viewer_home', 'Dana Personal', 'usr_viewer'),
          ('ws_external_home', 'Eve Personal', 'usr_external')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
        VALUES
          ('ws_acme', 'usr_owner', 'owner', '2026-01-01T00:00:00Z'),
          ('ws_admin_home', 'usr_admin', 'owner', '2026-01-01T00:00:00Z'),
          ('ws_acme', 'usr_admin', 'admin', '2026-01-02T00:00:00Z'),
          ('ws_member_home', 'usr_member', 'owner', '2026-01-01T00:00:00Z'),
          ('ws_acme', 'usr_member', 'member', '2026-01-03T00:00:00Z'),
          ('ws_viewer_home', 'usr_viewer', 'owner', '2026-01-01T00:00:00Z'),
          ('ws_acme', 'usr_viewer', 'viewer', '2026-01-04T00:00:00Z'),
          ('ws_external_home', 'usr_external', 'owner', '2026-01-01T00:00:00Z')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        UPDATE users
        SET active_workspace_id = 'ws_acme'
        WHERE id IN ('usr_owner', 'usr_admin', 'usr_member', 'usr_viewer')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        UPDATE users
        SET active_workspace_id = 'ws_external_home'
        WHERE id = 'usr_external'
      `,
    )
    .run();

  return { sqlite, db };
}

test("workspace-roles enforces canonical hierarchy and role capabilities", () => {
  assert.deepEqual(WORKSPACE_ROLES, [
    "owner",
    "admin",
    "member",
    "viewer",
  ]);
  assert.deepEqual(INVITABLE_WORKSPACE_ROLES, [
    "admin",
    "member",
    "viewer",
  ]);

  assert.equal(isWorkspaceRole("owner"), true);
  assert.equal(isWorkspaceRole("admin"), true);
  assert.equal(isWorkspaceRole("member"), true);
  assert.equal(isWorkspaceRole("viewer"), true);
  assert.equal(isWorkspaceRole("guest"), false);

  assert.equal(normalizeWorkspaceRole(" ADMIN "), "admin");
  assert.equal(
    normalizeWorkspaceRole("invalid", "viewer"),
    "viewer",
  );

  assert.equal(
    hasWorkspaceRoleAtLeast("owner", "admin"),
    true,
  );
  assert.equal(
    hasWorkspaceRoleAtLeast("admin", "owner"),
    false,
  );
  assert.equal(
    hasWorkspaceRoleAtLeast("member", "viewer"),
    true,
  );

  for (const role of WORKSPACE_ROLES) {
    assert.equal(canReadWorkspace(role), true);
  }

  assert.equal(canEditMonitoring("owner"), true);
  assert.equal(canEditMonitoring("admin"), true);
  assert.equal(canEditMonitoring("member"), true);
  assert.equal(canEditMonitoring("viewer"), false);

  assert.equal(canDeleteMonitoringResources("owner"), true);
  assert.equal(canDeleteMonitoringResources("admin"), true);
  assert.equal(
    canDeleteMonitoringResources("member"),
    false,
  );
  assert.equal(
    canDeleteMonitoringResources("viewer"),
    false,
  );

  assert.equal(canManageWorkspaceChannels("owner"), true);
  assert.equal(canManageWorkspaceChannels("admin"), true);
  assert.equal(canManageWorkspaceChannels("member"), false);
  assert.equal(canManageWorkspaceChannels("viewer"), false);

  assert.equal(canManageWorkspaceSettings("owner"), true);
  assert.equal(canManageWorkspaceSettings("admin"), true);
  assert.equal(canManageWorkspaceSettings("member"), false);
  assert.equal(canManageWorkspaceSettings("viewer"), false);

  assert.equal(canManageTeamMembers("owner"), true);
  assert.equal(canManageTeamMembers("admin"), true);
  assert.equal(canManageTeamMembers("member"), false);
  assert.equal(canManageTeamMembers("viewer"), false);

  assert.equal(canAssignWorkspaceRole("owner", "owner"), true);
  assert.equal(canAssignWorkspaceRole("owner", "admin"), true);
  assert.equal(
    canAssignWorkspaceRole("admin", "owner"),
    false,
  );
  assert.equal(
    canAssignWorkspaceRole("admin", "admin"),
    false,
  );
  assert.equal(
    canAssignWorkspaceRole("admin", "member"),
    true,
  );
  assert.equal(
    canAssignWorkspaceRole("admin", "viewer"),
    true,
  );

  assert.equal(
    canInviteWithWorkspaceRole("owner", "admin"),
    true,
  );
  assert.equal(
    canInviteWithWorkspaceRole("admin", "admin"),
    false,
  );
  assert.equal(
    canInviteWithWorkspaceRole("admin", "member"),
    true,
  );

  assert.equal(
    canManageTargetMemberRole("owner", "admin"),
    true,
  );
  assert.equal(
    canManageTargetMemberRole("admin", "admin"),
    false,
  );
  assert.equal(
    canManageTargetMemberRole("admin", "owner"),
    false,
  );
  assert.equal(
    canManageTargetMemberRole("admin", "member"),
    true,
  );

  const viewerPermissions =
    getWorkspaceRolePermissions("viewer");
  assert.equal(viewerPermissions.canEditMonitoring, false);
  assert.deepEqual(viewerPermissions.assignableRoles, []);
  assert.deepEqual(viewerPermissions.invitableRoles, []);
});

test("resolves active workspace, creates team workspaces, and switches active workspace", async (t) => {
  const { db, sqlite } = createD1Fixture(t);

  const initialActive = await getActiveWorkspaceMembership(
    db,
    "usr_admin",
  );
  assert.equal(initialActive?.id, "ws_acme");
  assert.equal(initialActive?.role, "admin");

  const switched = await switchActiveWorkspace(db, {
    userId: "usr_admin",
    workspaceId: "ws_admin_home",
  });
  assert.equal(switched.id, "ws_admin_home");
  assert.equal(switched.role, "owner");

  const created = await createTeamWorkspace(db, {
    userId: "usr_admin",
    name: "Acme EMEA Intelligence",
  });
  assert.equal(created.name, "Acme EMEA Intelligence");
  assert.equal(created.role, "owner");

  const workspaces = await listUserWorkspaces(
    db,
    "usr_admin",
  );
  assert.equal(workspaces.length, 3);
  const activeInList = workspaces.find(
    (item) => item.isActive,
  );
  assert.equal(activeInList?.id, created.id);

  // If active_workspace_id points to a workspace the user is no longer in, it falls back and heals
  sqlite
    .prepare(
      `
        UPDATE users
        SET active_workspace_id = 'ws_external_home'
        WHERE id = 'usr_admin'
      `,
    )
    .run();

  const healed = await getActiveWorkspaceMembership(
    db,
    "usr_admin",
  );
  assert.equal(healed?.id, "ws_admin_home");
});

test("invites new emails, auto-accepts on signup, and adds existing users directly", async (t) => {
  const { db, sqlite } = createD1Fixture(t);

  // 1. Invite an email that does not exist yet
  const inviteOutcome = await inviteOrAddWorkspaceMember(
    db,
    {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      email: "NewHire@Acme.test",
      role: "member",
    },
  );
  assert.equal(inviteOutcome.outcome, "invitation_sent");
  assert.equal(inviteOutcome.email, "newhire@acme.test");
  assert.equal(inviteOutcome.role, "member");

  const snapshotBeforeSignup =
    await getWorkspaceTeamSnapshot(db, "usr_owner");
  assert.equal(
    snapshotBeforeSignup.pendingInvitations.length,
    1,
  );
  assert.equal(
    snapshotBeforeSignup.pendingInvitations[0].email,
    "newhire@acme.test",
  );

  // 2. Simulate new user signup and auto-accept pending invitations
  sqlite
    .prepare(
      `
        INSERT INTO users (id, email, name, email_verified)
        VALUES ('usr_newhire', 'newhire@acme.test', 'New Hire', 1)
      `,
    )
    .run();

  const acceptedCount =
    await acceptPendingWorkspaceInvitationsForUser(db, {
      userId: "usr_newhire",
      email: "newhire@acme.test",
    });
  assert.equal(acceptedCount, 1);

  const newHireActive = await getActiveWorkspaceMembership(
    db,
    "usr_newhire",
  );
  assert.equal(newHireActive?.id, "ws_acme");
  assert.equal(newHireActive?.role, "member");

  // 3. Invite an existing user directly
  const directAddOutcome = await inviteOrAddWorkspaceMember(
    db,
    {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      email: "external@other.test",
      role: "viewer",
    },
  );
  assert.equal(directAddOutcome.outcome, "member_added");
  assert.equal(directAddOutcome.role, "viewer");
});

test("supports manual invitation acceptance and revocation with RBAC checks", async (t) => {
  const { db, sqlite } = createD1Fixture(t);

  // Create a pending invitation for external@other.test
  sqlite
    .prepare(
      `
        INSERT INTO workspace_invitations (
          id,
          workspace_id,
          email,
          role,
          invited_by,
          status
        )
        VALUES (
          'inv_1',
          'ws_acme',
          'external@other.test',
          'member',
          'usr_owner',
          'pending'
        )
      `,
    )
    .run();

  const externalSnapshot = await getWorkspaceTeamSnapshot(
    db,
    "usr_external",
  );
  assert.equal(
    externalSnapshot.incomingInvitations.length,
    1,
  );
  assert.equal(
    externalSnapshot.incomingInvitations[0].workspaceId,
    "ws_acme",
  );

  // Wrong user cannot accept someone else's invitation
  await assert.rejects(
    () =>
      acceptWorkspaceInvitation(db, {
        userId: "usr_viewer",
        invitationId: "inv_1",
      }),
    /Invitation not found or already processed/,
  );

  // Invited user accepts and switches active workspace
  const joinedWorkspace = await acceptWorkspaceInvitation(
    db,
    {
      userId: "usr_external",
      invitationId: "inv_1",
    },
  );
  assert.equal(joinedWorkspace.id, "ws_acme");
  assert.equal(joinedWorkspace.role, "member");

  // Owner creates an invite for admin
  const adminInvite = await inviteOrAddWorkspaceMember(
    db,
    {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      email: "future-admin@acme.test",
      role: "admin",
    },
  );
  assert.equal(adminInvite.outcome, "invitation_sent");

  const ownerSnapshot = await getWorkspaceTeamSnapshot(
    db,
    "usr_owner",
  );
  const pendingAdminInvite =
    ownerSnapshot.pendingInvitations.find(
      (item) => item.email === "future-admin@acme.test",
    );
  assert.ok(pendingAdminInvite);

  // Admin cannot revoke an invitation for the Admin role
  await assert.rejects(
    () =>
      revokeWorkspaceInvitation(db, {
        actorUserId: "usr_admin",
        workspaceId: "ws_acme",
        invitationId: pendingAdminInvite.id,
      }),
    /Only workspace Owners can revoke Admin invitations/,
  );

  // Owner can revoke the Admin invitation
  await revokeWorkspaceInvitation(db, {
    actorUserId: "usr_owner",
    workspaceId: "ws_acme",
    invitationId: pendingAdminInvite.id,
  });
});

test("enforces role boundaries on workspace renaming, role updates, last-owner protection, and member removal", async (t) => {
  const { db } = createD1Fixture(t);

  // Member and Viewer cannot rename workspace
  await assert.rejects(
    () =>
      updateWorkspaceName(db, {
        userId: "usr_member",
        workspaceId: "ws_acme",
        name: "Unauthorized Rename",
      }),
    /Only workspace Owners and Admins can rename a workspace/,
  );

  // Admin can rename workspace
  await updateWorkspaceName(db, {
    userId: "usr_admin",
    workspaceId: "ws_acme",
    name: "Acme Global Intel",
  });
  const renamed = await getActiveWorkspaceMembership(
    db,
    "usr_admin",
  );
  assert.equal(renamed?.name, "Acme Global Intel");

  // Admin can promote Viewer to Member, but cannot promote Member to Admin or Owner
  await updateWorkspaceMemberRole(db, {
    actorUserId: "usr_admin",
    workspaceId: "ws_acme",
    targetUserId: "usr_viewer",
    nextRole: "member",
  });

  await assert.rejects(
    () =>
      updateWorkspaceMemberRole(db, {
        actorUserId: "usr_admin",
        workspaceId: "ws_acme",
        targetUserId: "usr_member",
        nextRole: "admin",
      }),
    /Only workspace Owners can grant Owner or Admin roles/,
  );

  // Admin cannot modify or remove an Owner
  await assert.rejects(
    () =>
      updateWorkspaceMemberRole(db, {
        actorUserId: "usr_admin",
        workspaceId: "ws_acme",
        targetUserId: "usr_owner",
        nextRole: "member",
      }),
    /Only workspace Owners can change the role of an Owner or Admin/,
  );

  await assert.rejects(
    () =>
      removeWorkspaceMember(db, {
        actorUserId: "usr_admin",
        workspaceId: "ws_acme",
        targetUserId: "usr_owner",
      }),
    /Only workspace Owners can remove an Owner or Admin/,
  );

  // Last-owner protection: sole owner cannot demote or remove themselves
  await assert.rejects(
    () =>
      updateWorkspaceMemberRole(db, {
        actorUserId: "usr_owner",
        workspaceId: "ws_acme",
        targetUserId: "usr_owner",
        nextRole: "admin",
      }),
    /Each workspace must keep at least one Owner/,
  );

  await assert.rejects(
    () =>
      removeWorkspaceMember(db, {
        actorUserId: "usr_viewer",
        workspaceId: "ws_viewer_home",
        targetUserId: "usr_viewer",
      }),
    /You are the only Owner of this workspace/,
  );

  // Admin can remove a Member who has another workspace
  await removeWorkspaceMember(db, {
    actorUserId: "usr_admin",
    workspaceId: "ws_acme",
    targetUserId: "usr_viewer",
  });

  // Removed user's active workspace automatically falls back to their remaining workspace
  const viewerAfterRemoval =
    await getActiveWorkspaceMembership(db, "usr_viewer");
  assert.equal(viewerAfterRemoval?.id, "ws_viewer_home");

  // Demote usr_viewer in ws_viewer_home after adding a second owner, then verify sole-workspace protection
  await inviteOrAddWorkspaceMember(db, {
    actorUserId: "usr_viewer",
    workspaceId: "ws_viewer_home",
    email: "owner@acme.test",
    role: "admin",
  });
  await updateWorkspaceMemberRole(db, {
    actorUserId: "usr_viewer",
    workspaceId: "ws_viewer_home",
    targetUserId: "usr_owner",
    nextRole: "owner",
  });
  await updateWorkspaceMemberRole(db, {
    actorUserId: "usr_owner",
    workspaceId: "ws_viewer_home",
    targetUserId: "usr_viewer",
    nextRole: "member",
  });

  await assert.rejects(
    () =>
      removeWorkspaceMember(db, {
        actorUserId: "usr_viewer",
        workspaceId: "ws_viewer_home",
        targetUserId: "usr_viewer",
      }),
    /You cannot leave your only workspace/,
  );

  await assert.rejects(
    () =>
      removeWorkspaceMember(db, {
        actorUserId: "usr_owner",
        workspaceId: "ws_viewer_home",
        targetUserId: "usr_viewer",
      }),
    /Cannot remove a user from their only workspace/,
  );
});

test("enforces RBAC on workspace external notification channels while allowing personal email preferences for all roles", async (t) => {
  const { db } = createD1Fixture(t);

  // Viewer and Member can save personal email notification preferences
  const viewerPrefs =
    await saveUserEmailNotificationPreferences(db, {
      userId: "usr_viewer",
      emailEnabled: true,
      digestEmailEnabled: false,
      minSignificance: "major",
      categories: ["pricing"],
      competitorIds: [],
      digestPeriods: ["daily"],
    });
  assert.equal(viewerPrefs.minSignificance, "major");

  const viewerSettings =
    await getWorkspaceNotificationSettings(
      db,
      "usr_viewer",
    );
  assert.equal(viewerSettings.workspace.role, "viewer");
  assert.equal(
    viewerSettings.workspace.canManageExternalChannels,
    false,
  );

  // Member and Viewer cannot create external channels
  for (const userId of ["usr_member", "usr_viewer"]) {
    await assert.rejects(
      () =>
        createWorkspaceExternalChannel(db, {
          userId,
          name: "Unauthorized Slack",
          channel: "slack",
          slackWebhookUrl:
            "https://hooks.slack.com/services/T000/B000/XXXX",
          telegramBotToken: "",
          telegramChatId: "",
          webhookUrl: "",
          webhookSecret: "",
          sendChanges: true,
          sendDigests: false,
          minSignificance: "minor",
          categories: [],
          competitorIds: [],
          digestPeriods: ["daily"],
        }),
      /Only workspace Owners and Admins can manage external delivery channels/,
    );
  }

  // Admin can create external channels
  const channel = await createWorkspaceExternalChannel(db, {
    userId: "usr_admin",
    name: "Acme Alerts Slack",
    channel: "slack",
    slackWebhookUrl:
      "https://hooks.slack.com/services/T000/B000/XXXX",
    telegramBotToken: "",
    telegramChatId: "",
    webhookUrl: "",
    webhookSecret: "",
    sendChanges: true,
    sendDigests: true,
    minSignificance: "moderate",
    categories: ["pricing"],
    competitorIds: [],
    digestPeriods: ["daily", "weekly"],
  });
  assert.ok(channel.id);

  // Member cannot update, toggle, or remove the channel
  await assert.rejects(
    () =>
      updateWorkspaceExternalChannel(db, {
        userId: "usr_member",
        channelId: channel.id,
        name: "Tampered Slack",
        channel: "slack",
        slackWebhookUrl: "",
        telegramBotToken: "",
        telegramChatId: "",
        webhookUrl: "",
        webhookSecret: "",
        sendChanges: true,
        sendDigests: true,
        minSignificance: "minor",
        categories: [],
        competitorIds: [],
        digestPeriods: ["daily"],
      }),
    /Only workspace Owners and Admins can manage external delivery channels/,
  );

  await assert.rejects(
    () =>
      toggleWorkspaceExternalChannelStatus(db, {
        userId: "usr_member",
        channelId: channel.id,
        currentStatus: "active",
      }),
    /Only workspace Owners and Admins can manage external delivery channels/,
  );

  await assert.rejects(
    () =>
      removeWorkspaceExternalChannel(db, {
        userId: "usr_member",
        channelId: channel.id,
      }),
    /Only workspace Owners and Admins can manage external delivery channels/,
  );

  // Admin can toggle and Owner can remove the channel
  const nextStatus =
    await toggleWorkspaceExternalChannelStatus(db, {
      userId: "usr_admin",
      channelId: channel.id,
      currentStatus: "active",
    });
  assert.equal(nextStatus, "paused");

  await removeWorkspaceExternalChannel(db, {
    userId: "usr_owner",
    channelId: channel.id,
  });
});
