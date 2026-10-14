import "./dashboard.css";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceNav } from "@/components/workspace-nav";
import { AccountSettings } from "@/components/account-settings";
import {
  WorkspaceActionForm,
  WorkspaceFeedback,
} from "@/components/workspace-feedback";
import {
  getActiveWorkspaceMembership,
  listUserWorkspaces,
} from "@/lib/team-workspaces";
import { WORKSPACE_ROLE_DETAILS } from "@/lib/workspace-roles";
import { switchWorkspaceAction } from "@/app/dashboard/team/actions";
import { env } from "cloudflare:workers";

export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const session = await auth.api.getSession({ headers: await headers() });
  const workspace = session
    ? await getActiveWorkspaceMembership(env.DB, session.user.id)
    : null;
  const workspaces = session
    ? await listUserWorkspaces(env.DB, session.user.id)
    : [];

  return (
    <div className="morrow-dashboard">
      <WorkspaceFeedback>
      <aside className="workspace-sidebar">
        <div className="workspace-label">
          {workspace ? workspace.name : "Workspace"}
        </div>
        <WorkspaceNav />
        {session && (
          <details className="workspace-account">
            <summary>Account</summary>
            <div className="workspace-account-content">
              <div>{session.user.name || "Morrow user"}</div>
              <div className="workspace-account-email">{session.user.email}</div>
              {workspace && (
                <div className="workspace-meta">
                  {workspace.name} · {WORKSPACE_ROLE_DETAILS[workspace.role].label}
                </div>
              )}
              {workspaces.length > 1 && workspace && (
                <WorkspaceActionForm
                  action={switchWorkspaceAction}
                  successMessage="Switched active workspace."
                  className="workspace-switcher-form"
                >
                  <label htmlFor="sidebar-workspace-select" className="sr-only">
                    Active workspace
                  </label>
                  <select
                    id="sidebar-workspace-select"
                    name="workspaceId"
                    defaultValue={workspace.id}
                  >
                    {workspaces.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({WORKSPACE_ROLE_DETAILS[item.role].label})
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="workspace-panel-trigger workspace-panel-secondary"
                  >
                    Switch workspace
                  </button>
                </WorkspaceActionForm>
              )}
              <AccountSettings name={session.user.name} email={session.user.email} />
              <SignOutButton />
            </div>
          </details>
        )}
      </aside>
      <div className="workspace-content">{children}</div>
      </WorkspaceFeedback>
    </div>
  );
}
