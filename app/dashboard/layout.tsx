import "./dashboard.css";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceNav } from "@/components/workspace-nav";
import { AccountSettings } from "@/components/account-settings";
import { env } from "cloudflare:workers";

export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const session = await auth.api.getSession({ headers: await headers() });
  const workspace = session ? await env.DB.prepare(`
    SELECT workspaces.name FROM workspaces
    INNER JOIN workspace_members ON workspace_members.workspace_id = workspaces.id
    WHERE workspace_members.user_id = ? ORDER BY datetime(workspace_members.joined_at) ASC LIMIT 1
  `).bind(session.user.id).first<{ name: string }>() : null;

  return (
    <div className="morrow-dashboard">
      <aside className="workspace-sidebar">
        <div className="workspace-label">Workspace</div>
        <WorkspaceNav />
        {session && (
          <details className="workspace-account">
            <summary>Account</summary>
            <div className="workspace-account-content">
              <div>{session.user.name || "Morrow user"}</div>
              <div className="workspace-account-email">{session.user.email}</div>
               {workspace && <div className="workspace-meta">{workspace.name}</div>}
              <AccountSettings name={session.user.name} email={session.user.email} />
              <SignOutButton />
            </div>
          </details>
        )}
      </aside>
      <div className="workspace-content">{children}</div>
    </div>
  );
}
