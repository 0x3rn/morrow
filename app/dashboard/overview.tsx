import { ArrowUpRightIcon } from "@/components/morrow-icons";
import Link from "next/link";

export interface DashboardOverviewRow {
  competitor_count: number;
  active_competitor_count: number;
  monitored_page_count: number;
  active_page_count: number;
  healthy_page_count: number;
  overdue_page_count: number;
  awaiting_page_count: number;
  error_page_count: number;
  paused_page_count: number;
  change_count: number;
  major_change_count: number;
  latest_checked_at: string | null;
  latest_change_at: string | null;
}

export interface DashboardMonitoringRow {
  id: string;
  competitor_id: string;
  competitor_name: string;
  competitor_domain: string;
  url: string;
  label: string | null;
  frequency_minutes: number;
  page_status: string;
  competitor_status: string;
  last_checked_at: string | null;
  next_check_at: string | null;
  latest_http_status: number | null;
  latest_captured_at: string | null;
  health: "healthy" | "overdue" | "awaiting_first_capture" | "error" | "paused";
}

export interface DashboardRecentChange {
  id: string;
  category: string;
  significance: string;
  summary: string | null;
  why_it_matters: string | null;
  detected_at: string;
  competitor_id: string;
  competitor_name: string;
  monitored_page_url: string;
  monitored_page_label: string | null;
}

interface DashboardOverviewProps {
  metrics: {
    competitors: number; activeCompetitors: number; monitoredPages: number; activePages: number;
    healthyPages: number; overduePages: number; awaitingPages: number; errorPages: number;
    pausedPages: number; changes: number; majorChanges: number;
    latestCheckedAt: string | null; latestChangeAt: string | null;
  };
  usage: {
    competitorLimit: number; pageLimit: number; perCompetitorPageLimit: number;
    competitorRemaining: number; pageRemaining: number;
  };
  monitoringRows: DashboardMonitoringRow[];
  recentChanges: DashboardRecentChange[];
}

function formatDateTime(value: string | null, compact = false) {
  if (!value) return "Never";
  const normalized = value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value)
    ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return compact
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date)
    : `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

function frequencyLabel(minutes: number) {
  return ({ 60: "Hourly", 360: "Every 6 hours", 720: "Every 12 hours", 1440: "Daily", 10080: "Weekly" } as Record<number, string>)[minutes] || `Every ${minutes} min`;
}

const healthLabels = {
  healthy: "Healthy", overdue: "Overdue", awaiting_first_capture: "Awaiting first capture",
  error: "Capture error", paused: "Paused",
};

export function DashboardOverview({ metrics, usage, monitoringRows, recentChanges }: DashboardOverviewProps) {
  const pausedCount = Math.max(
    metrics.competitors - metrics.activeCompetitors,
    metrics.pausedPages,
  );
  const needsAttentionCount = metrics.overduePages + metrics.errorPages;

  return (
    <main className="workspace-page dashboard-overview">
      <header className="workspace-page-heading">
        <h1>Monitoring Overview</h1>
        <p>Track your competitors, monitored pages, recent changes, and workspace usage.</p>
      </header>
      <section className="workspace-metrics" aria-label="Monitoring overview">
        <article>
          <div className="workspace-metric-label">Competitors</div>
          <div className="workspace-metric-value">{metrics.competitors}</div>
          <div className="workspace-meta workspace-meta-inline">
            <span>{metrics.activeCompetitors} active</span>
            {pausedCount > 0 ? (
              <>
                <span>·</span>
                <span className="workspace-meta-amber">{pausedCount} paused</span>
              </>
            ) : null}
          </div>
        </article>

        <article>
          <div className="workspace-metric-label">Monitored pages</div>
          <div className="workspace-metric-value">{metrics.monitoredPages}</div>
          <div className="workspace-meta">{metrics.activePages} actively scheduled</div>
        </article>

        <article>
          <div className="workspace-metric-label">Meaningful changes</div>
          <div className="workspace-metric-value">{metrics.changes}</div>
          <div className="workspace-meta">{metrics.majorChanges} major</div>
        </article>

        <article>
          <div className="workspace-metric-label">Needs attention</div>
          <div className="workspace-metric-value">{needsAttentionCount}</div>
          <div className="workspace-meta">
            {metrics.overduePages > 0 && metrics.errorPages > 0 ? (
              <span className="workspace-meta-inline">
                <span className="workspace-meta-amber">{metrics.overduePages} overdue</span>
                <span>·</span>
                <span className="workspace-meta-red">
                  {metrics.errorPages} capture {metrics.errorPages === 1 ? "error" : "errors"}
                </span>
              </span>
            ) : metrics.overduePages > 0 ? (
              <span className="workspace-meta-amber">
                {metrics.overduePages === 1 ? "overdue page" : "overdue pages"}
              </span>
            ) : metrics.errorPages > 0 ? (
              <span className="workspace-meta-red">
                {metrics.errorPages === 1 ? "capture error" : "capture errors"}
              </span>
            ) : (
              "overdue or capture errors"
            )}
          </div>
        </article>
      </section>
      <div className="dashboard-columns">
        <div className="dashboard-operations">
        <section className="dashboard-monitoring workspace-surface">
          <div className="workspace-section-heading">
            <h2>Monitoring status</h2>
            <Link className="workspace-link" href="/dashboard/competitors">Manage competitors<ArrowUpRightIcon /></Link>
          </div>
          <p className="workspace-section-helper">Current health derived from scheduler state and the latest capture.</p>
          {monitoringRows.length === 0 ? (
            <div className="workspace-empty">
              <h3>Nothing is being monitored yet</h3>
              <p>Add a competitor and monitored page to start building your monitoring feed.</p>
              <Link className="workspace-primary" href="/dashboard/competitors">Add competitor</Link>
            </div>
          ) : (
            <div className="workspace-records">
              {monitoringRows.map(page => (
                <article key={page.id} className="workspace-record monitoring-record">
                  <div className="monitoring-identity">
                    <a href={`/dashboard/competitors/${page.competitor_id}`}>{page.competitor_name}</a>
                    <span className="workspace-meta">{page.label || "Unlabelled page"}</span>
                  </div>
                  <a className="workspace-url" href={page.url} target="_blank" rel="noreferrer">{page.url}</a>
                  <div className="workspace-record-meta">
                    <span className={`workspace-badge health-${page.health}`}>{healthLabels[page.health]}</span>
                    <span>{frequencyLabel(page.frequency_minutes)}</span>
                    <span>HTTP <strong>{page.latest_http_status ?? "—"}</strong></span>
                  </div>
                  <dl className="monitoring-timings">
                    <div><dt>Last checked</dt><dd>{formatDateTime(page.last_checked_at, true)}</dd></div>
                    <div><dt>Latest capture</dt><dd>{formatDateTime(page.latest_captured_at, true)}</dd></div>
                    <div><dt>Next check</dt><dd>{page.health === "paused" ? "Paused" : formatDateTime(page.next_check_at, true)}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="dashboard-usage workspace-surface">
          <div className="workspace-section-heading">
            <h2>Workspace usage</h2>
          </div>
          <dl className="workspace-usage-summary">
            <div><dt>Competitors<span className="workspace-meta">Workspace total</span></dt>
              <dd><strong>{metrics.competitors} / {usage.competitorLimit}</strong><span className="workspace-meta">{usage.competitorRemaining} competitor{usage.competitorRemaining === 1 ? "" : "s"} remaining</span></dd></div>
            <div><dt>Monitored pages<span className="workspace-meta">Workspace total</span></dt>
              <dd><strong>{metrics.monitoredPages} / {usage.pageLimit}</strong><span className="workspace-meta">{usage.pageRemaining} page{usage.pageRemaining === 1 ? "" : "s"} remaining</span></dd></div>
            <div><dt>Per-competitor page cap</dt><dd><strong>{usage.perCompetitorPageLimit}</strong></dd></div>
          </dl>
        </section>
        </div>
        <section className="dashboard-changes workspace-surface">
          <div className="workspace-section-heading"><h2>Recent changes</h2><Link className="workspace-link" href="/dashboard/changes">View all<ArrowUpRightIcon /></Link></div>
          {recentChanges.length === 0 ? (
            <div className="workspace-empty"><h3>No changes yet</h3><p>Monitoring is running, but no changes have been recorded yet.</p></div>
          ) : (
            <div className="workspace-records">
              {recentChanges.map(change => (
                <article key={change.id} className="workspace-record change-record">
                  <div className="change-identity"><strong>{change.competitor_name}</strong><span>{change.monitored_page_label || change.monitored_page_url}</span></div>
                  <div className="workspace-record-meta">
                    <span className="workspace-category">{change.category}</span>
                    <span className={`workspace-badge significance-${change.significance}`}>{change.significance}</span>
                    <time>{formatDateTime(change.detected_at)}</time>
                  </div>
                  <details className="workspace-change-disclosure">
                    <summary><h3>{change.summary || "A meaningful competitor change was detected."}</h3></summary>
                    <div className="workspace-change-description">
                      {change.why_it_matters && <p>{change.why_it_matters}</p>}
                      <a className="workspace-link" href={`/dashboard/changes/${change.id}`}>View change<ArrowUpRightIcon /></a>
                    </div>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      <footer className="workspace-latest">
        <div><span>Latest monitoring check</span><strong>{formatDateTime(metrics.latestCheckedAt)}</strong></div>
        <div><span>Latest change</span><strong>{formatDateTime(metrics.latestChangeAt)}</strong></div>
      </footer>
    </main>
  );
}
