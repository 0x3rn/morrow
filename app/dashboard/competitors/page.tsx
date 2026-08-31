import { auth } from "@/lib/auth";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  createCompetitor,
  toggleCompetitorStatus,
  updateCompetitor,
  removeCompetitor,
} from "./actions";

interface Competitor {
  id: string;
  name: string;
  domain: string;
  favicon_url: string | null;
  status: string;
}

export default async function CompetitorsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const { results: competitors } = await env.DB.prepare(
    `
      SELECT
        competitors.id,
        competitors.name,
        competitors.domain,
        competitors.favicon_url,
        competitors.status
      FROM competitors
      INNER JOIN workspace_members
        ON workspace_members.workspace_id = competitors.workspace_id
      WHERE workspace_members.user_id = ?
      ORDER BY competitors.created_at DESC
    `
  )
    .bind(session.user.id)
    .all<Competitor>();

  return (
    <main>
      <h1>Competitors</h1>

      <form action={createCompetitor}>
        <div>
          <label htmlFor="name">Competitor name</label>

          <input
            id="name"
            name="name"
            type="text"
            placeholder="Stripe"
            required
          />
        </div>

        <div>
          <label htmlFor="domain">Domain</label>

          <input
            id="domain"
            name="domain"
            type="text"
            placeholder="stripe.com"
            required
          />
        </div>

        <button type="submit">Add competitor</button>
      </form>

      <section>
        <h2>Your competitors</h2>

        {competitors.length === 0 ? (
          <p>No competitors yet.</p>
        ) : (
          <ul>
            {competitors.map((competitor) => (
              <li key={competitor.id}>
                {competitor.favicon_url && (
                <img
                    src={competitor.favicon_url}
                    alt={`${competitor.name} favicon`}
                    width={32}
                    height={32}
                />
                )}
                <strong>{competitor.name}</strong>

                <div>{competitor.domain}</div>

                <div>
                  Status: {competitor.status}
                </div>
                
                <form action={updateCompetitor}>
                    <input
                    type="hidden"
                    name="competitorId"
                    value={competitor.id}
                    />

                    <div>
                    <label htmlFor={`name-${competitor.id}`}>
                    Name
                    </label>

                    <input
                        id={`name-${competitor.id}`}
                        name="name"
                        type="text"
                        defaultValue={competitor.name}
                        required
                    />
                    </div>

                    <div>
                    <label htmlFor={`domain-${competitor.id}`}>
                    Domain
                    </label>

                    <input
                    id={`domain-${competitor.id}`}
                    name="domain"
                    type="text"
                    defaultValue={competitor.domain}
                    required
                    />
                    </div>

                    <button type="submit">
                    Save changes
                    </button>
                </form>
                    
                <form action={toggleCompetitorStatus}>
                  <input
                    type="hidden"
                    name="competitorId"
                    value={competitor.id}
                  />

                  <input
                    type="hidden"
                    name="currentStatus"
                    value={competitor.status}
                  />

                  <button type="submit">
                    {competitor.status === "active"
                      ? "Pause"
                      : "Resume"}
                  </button>
                </form>
                <form action={removeCompetitor}>
                  <input
                    type="hidden"
                    name="competitorId"
                    value={competitor.id}
                  />

                  <button type="submit">
                    Remove
                  </button>
                </form>
                <Link
                    href={`/dashboard/competitors/${competitor.id}`}
                >
                    View competitor
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}