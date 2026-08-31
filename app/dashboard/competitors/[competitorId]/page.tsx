import { auth } from "@/lib/auth";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  createMonitoredPage,
  toggleMonitoredPageStatus,
  updateMonitoredPageFrequency,
  removeMonitoredPage,
  updateMonitoredPage
} from "./actions";

interface Competitor {
  id: string;
  name: string;
  domain: string;
  status: string;
  created_at: string;
}

interface MonitoredPage {
  id: string;
  url: string;
  label: string | null;
  frequency_minutes: number;
  status: string;
  last_checked_at: string | null;
}

interface CompetitorPageProps {
  params: Promise<{
    competitorId: string;
  }>;
}

export default async function CompetitorPage({
  params,
}: CompetitorPageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const { competitorId } = await params;

  const competitor = await env.DB.prepare(
    `
      SELECT
        competitors.id,
        competitors.name,
        competitors.domain,
        competitors.status,
        competitors.created_at
      FROM competitors
      INNER JOIN workspace_members
        ON workspace_members.workspace_id = competitors.workspace_id
      WHERE competitors.id = ?
        AND workspace_members.user_id = ?
      LIMIT 1
    `
  )
    .bind(competitorId, session.user.id)
    .first<Competitor>();

  if (!competitor) {
    notFound();
  }

  const { results: monitoredPages } = await env.DB.prepare(
    `
      SELECT
        id,
        url,
        label,
        frequency_minutes,
        status,
        last_checked_at
      FROM monitored_pages
      WHERE competitor_id = ?
      ORDER BY created_at DESC
    `
  )
    .bind(competitor.id)
    .all<MonitoredPage>();

  return (
    <main>
      <a href="/dashboard/competitors">
        ← Back to competitors
      </a>

      <h1>{competitor.name}</h1>

      <p>{competitor.domain}</p>

      <p>Status: {competitor.status}</p>

      <section>
        <h2>Monitored pages</h2>

        <form action={createMonitoredPage}>
          <input
            type="hidden"
            name="competitorId"
            value={competitor.id}
          />

          <div>
            <label htmlFor="url">
              Page URL
            </label>

            <input
              id="url"
              name="url"
              type="text"
              placeholder="https://stripe.com/pricing"
              required
            />
          </div>

          <div>
            <label htmlFor="label">
              Label
            </label>

            <input
              id="label"
              name="label"
              type="text"
              placeholder="Pricing page"
            />
          </div>

          <button type="submit">
            Add monitored page
          </button>
        </form>

        {monitoredPages.length === 0 ? (
          <p>No monitored pages yet.</p>
        ) : (
          <ul>
            {monitoredPages.map((page) => (
              <li key={page.id}>
                <strong>
                  {page.label || "Unlabelled page"}
                </strong>

                <div>
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {page.url}
                  </a>
                </div>

                <form action={updateMonitoredPage}>
                  <input
                    type="hidden"
                    name="monitoredPageId"
                    value={page.id}
                  />

                  <input
                    type="hidden"
                    name="competitorId"
                    value={competitor.id}
                  />

                  <div>
                    <label
                      htmlFor={`label-${page.id}`}
                    >
                      Label
                    </label>

                    <input
                      id={`label-${page.id}`}
                      name="label"
                      type="text"
                      defaultValue={page.label || ""}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`url-${page.id}`}
                    >
                      Page URL
                    </label>

                    <input
                      id={`url-${page.id}`}
                      name="url"
                      type="text"
                      defaultValue={page.url}
                      required
                    />
                  </div>

                  <button type="submit">
                    Save page details
                  </button>
                </form>

                <div>
                  Status: {page.status}
                </div>

                <form action={toggleMonitoredPageStatus}>
                  <input
                    type="hidden"
                    name="monitoredPageId"
                    value={page.id}
                  />

                  <input
                    type="hidden"
                    name="competitorId"
                    value={competitor.id}
                  />

                  <button type="submit">
                    {page.status === "active"
                      ? "Pause page"
                      : "Resume page"}
                  </button>
                </form>

                <form action={updateMonitoredPageFrequency}>
                  <input
                    type="hidden"
                    name="monitoredPageId"
                    value={page.id}
                  />

                  <input
                    type="hidden"
                    name="competitorId"
                    value={competitor.id}
                  />

                  <label
                    htmlFor={`frequency-${page.id}`}
                  >
                    Monitoring frequency
                  </label>

                  <select
                    id={`frequency-${page.id}`}
                    name="frequencyMinutes"
                    defaultValue={page.frequency_minutes}
                  >
                    <option value="60">
                      Every hour
                    </option>

                    <option value="360">
                      Every 6 hours
                    </option>

                    <option value="720">
                      Every 12 hours
                    </option>

                    <option value="1440">
                      Every 24 hours
                    </option>

                    <option value="10080">
                      Every 7 days
                    </option>
                  </select>

                  <button type="submit">
                    Save frequency
                  </button>
                </form>
                <div>
                  Last checked:{" "}
                  {page.last_checked_at || "Never"}
                </div>
                <form action={removeMonitoredPage}>
                  <input
                    type="hidden"
                    name="monitoredPageId"
                    value={page.id}
                  />

                  <input
                    type="hidden"
                    name="competitorId"
                    value={competitor.id}
                  />

                  <button type="submit">
                    Remove page
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}