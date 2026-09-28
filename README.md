# Morrow

**Competitive intelligence through continuous website monitoring.**

Morrow monitors competitor websites, captures rendered page states, detects meaningful changes, filters out noise, classifies what changed, explains why it matters, and builds a searchable history of competitor activity.

Instead of manually checking pricing pages, product pages, landing pages, policies, promotions, and positioning, teams can use Morrow to continuously observe the competitive landscape and surface the changes worth paying attention to.

---

## What Morrow Does

Morrow turns competitor websites into a continuously updated competitive-intelligence dataset.

The core product loop is:

```text
Add competitor
      ↓
Add pages to monitor
      ↓
Scheduled browser capture
      ↓
Store snapshot + visual evidence
      ↓
Scope relevant page regions
      ↓
Compare against previous snapshot
      ↓
Remove noise and volatile content
      ↓
Classify meaningful change
      ↓
Estimate significance
      ↓
Generate human-readable explanation
      ↓
Persist structured intelligence
      ↓
Notify / report / search / analyze
```

The important distinction is that Morrow does not treat every DOM or text difference as useful intelligence.

The goal is not:

> "This page changed."

The goal is:

> "This competitor increased the price of its Pro plan from $20 to $29 per month. This is a major pricing change that may indicate a shift toward higher-value customers."

---

# Features

## Competitor Monitoring

Create competitor profiles and attach the pages that matter to each competitor.

Typical monitored pages include:

- pricing pages
- product pages
- feature pages
- landing pages
- homepages
- documentation
- changelogs
- promotion pages
- policy pages
- comparison pages
- positioning and messaging pages

Each monitored page maintains its own capture schedule, monitoring configuration, snapshot history, and detected changes.

---

## Scheduled Browser Capture

Morrow uses real browser rendering rather than relying exclusively on raw HTTP responses.

Pages are captured with Cloudflare Browser Rendering and Playwright so monitoring can observe modern JavaScript-driven websites.

The capture engine handles:

- scheduled monitoring
- due-page discovery
- page claiming
- concurrent scheduler protection
- rendered HTML capture
- readable text extraction
- screenshots
- HTTP status metadata
- retry handling
- timeout handling
- capture timestamps
- content hashing
- snapshot persistence
- next-check scheduling

Large snapshot evidence is stored outside the relational database so D1 remains focused on structured application data.

---

## Snapshot History

Every retained page state becomes part of the competitor's historical record.

Snapshots preserve information such as:

- capture timestamp
- content hash
- HTTP status
- rendered text
- rendered HTML
- screenshot evidence
- monitored page relationship

Snapshot history is independent from meaningful changes.

That means Morrow can preserve historical states even when two snapshots do not produce an alert-worthy change.

This makes it possible to browse how a competitor's website evolved over time rather than seeing only isolated alerts.

---

## Section-Level Monitoring

Not every part of a page deserves equal attention.

Morrow supports monitoring specific sections of a page using selectors.

Examples:

```text
#pricing
.pricing-table
[data-section="features"]
main
.product-comparison
```

A page can define:

- **include selectors** — regions that participate in comparison
- **ignore selectors** — regions removed from comparison

This allows monitoring to focus on business-relevant areas without discarding the full captured page evidence.

---

## Ignore Regions

Frequently changing elements can create useless monitoring noise.

Morrow can exclude regions such as:

- timestamps
- visitor counters
- rotating testimonials
- dynamic advertisements
- randomized recommendations
- live counters
- session-specific elements
- animated banners
- frequently changing widgets

Ignored regions affect comparison, not the underlying snapshot evidence.

---

# Meaningful Change Detection

Morrow separates **raw page differences** from **business-relevant changes**.

The detection pipeline is:

```text
Previous snapshot
      +
Current snapshot
      ↓
Scoped readable representation
      ↓
Line-level comparison
      ↓
Noise filtering
      ↓
Volatility suppression
      ↓
Deterministic classification
      ↓
Significance calculation
      ↓
AI explanation
      ↓
Persisted change
```

---

## Noise Filtering

Website monitoring becomes useless if every dynamic element creates an alert.

Morrow suppresses changes that are likely to represent noise rather than competitor activity.

Examples include:

- timestamps
- generated IDs
- transient counters
- formatting-only differences
- insignificant text movement
- frequently rotating content
- volatile regions

The result is a monitoring system designed around **alert trust** rather than raw difference volume.

---

## Volatility Detection

Repeatedly changing content can be recognized as volatile.

Historical snapshots allow Morrow to distinguish between:

```text
stable content → meaningful change
```

and:

```text
constantly changing content → likely noise
```

This reduces recurring false positives from sections that naturally rotate between captures.

---

# Change Classification

Meaningful changes are classified using Morrow's canonical change vocabulary.

### Categories

```text
pricing
product
feature
positioning
promotion
policy
navigation
content
other
```

Examples:

### Pricing

- subscription price changes
- discount changes
- billing-period changes
- free-tier changes
- plan restructuring

### Product

- new product announcements
- product removals
- major product changes

### Feature

- feature launches
- feature removals
- capability changes
- plan-feature changes

### Positioning

- homepage messaging changes
- target-customer changes
- category positioning
- value-proposition changes

### Promotion

- discounts
- campaigns
- seasonal offers
- limited-time promotions

### Policy

- terms changes
- refund changes
- usage-policy changes
- contractual changes

### Navigation

- major site-structure changes
- new product areas
- removed sections

### Content

- meaningful editorial or descriptive changes that do not belong to a more specific category

### Other

- relevant changes outside the canonical categories

---

# Change Significance

Changes are assigned one of three significance levels:

```text
minor
moderate
major
```

Significance allows Morrow to prioritize intelligence instead of presenting every event equally.

For example:

```text
Small copy adjustment
→ minor

New product feature
→ moderate

Concrete pricing change
→ major
```

Classification is deterministic wherever possible.

AI is used downstream to explain already-bounded evidence rather than being responsible for deciding whether arbitrary page content changed.

---

# AI-Powered Change Explanations

Once a meaningful change has been identified and classified, Morrow generates a concise explanation.

Persisted change intelligence includes:

- category
- significance
- summary
- why it matters
- previous evidence
- current evidence
- detection timestamp
- previous snapshot
- current snapshot

The AI layer receives bounded evidence rather than entire uncontrolled pages.

This keeps the intelligence pipeline predictable:

```text
Deterministic capture
        ↓
Deterministic comparison
        ↓
Deterministic classification
        ↓
Bounded evidence
        ↓
AI explanation
```

Historical views consume the persisted explanation instead of calling AI again every time somebody opens a change.

---

# Visual Before / After Comparison

Text alone does not always explain a website change.

Morrow retains screenshot evidence and exposes authenticated visual comparison between the snapshots associated with a change.

Users can inspect:

```text
BEFORE                     AFTER
previous screenshot        current screenshot
```

Visual evidence is protected by workspace authorization and remains connected to the underlying snapshot records.

This is especially useful for:

- pricing redesigns
- homepage repositioning
- new promotional banners
- product launches
- removed sections
- layout changes
- visual merchandising changes

---

# Change History

Morrow maintains a structured historical timeline of competitor activity.

Users can search and filter change history by:

- competitor
- monitored page
- category
- significance
- keyword
- start date
- end date

Historical queries operate on persisted intelligence rather than rerunning monitoring or AI analysis.

---

## Change Detail

Every meaningful change has an individual detail view containing:

- competitor
- monitored page
- category
- significance
- summary
- why it matters
- previous text evidence
- current text evidence
- previous snapshot metadata
- current snapshot metadata
- before/after screenshots
- detection timestamp

This gives every intelligence event a traceable evidence chain.

---

# Competitor Profiles

Each competitor has a dedicated intelligence profile.

A competitor profile can surface:

- competitor information
- monitored pages
- monitoring state
- recent activity
- meaningful-change counts
- major-change counts
- latest detected activity
- page-level history
- complete competitor history
- snapshot evidence

This turns Morrow from a collection of monitoring jobs into a structured competitive landscape.

---

# Monitored Page History

Each monitored page has its own timeline.

A page history can answer:

- what changed on this specific page?
- when did it change?
- how significant was the change?
- what did the page look like previously?
- how frequently is this page changing?

The timeline is paginated and linked to the corresponding competitor, global history, individual changes, and snapshot history.

---

# Competitor History

Competitor history combines activity across all pages belonging to a competitor.

Instead of looking at a single page, users can understand the competitor as a whole.

Examples:

```text
Pricing page changed
        ↓
Feature page changed
        ↓
Homepage positioning changed
        ↓
Promotion launched
```

Together, those events may reveal a broader strategic move that would be difficult to notice by inspecting individual pages manually.

---

# Historical Snapshot Browsing

Morrow retains page states independently from meaningful-change records.

Users can browse historical snapshots to investigate:

- what a page looked like on a particular date
- changes that were intentionally filtered as insignificant
- periods between meaningful events
- visual evolution over time
- historical page content

Snapshot evidence remains workspace-authorized.

---

# Intelligence Dashboard

The dashboard is designed for prioritization rather than raw monitoring volume.

It answers questions such as:

- Which competitors changed recently?
- Which changes were important?
- What types of changes are occurring?
- Which pages require attention?
- Which monitors are healthy?
- Which pages are overdue?
- Which pages are awaiting their first capture?

Dashboard intelligence is derived from persisted structured records.

The dashboard does not rerun the monitoring pipeline simply because somebody opens it.

---

## Monitoring Health

Morrow derives monitoring health from scheduler state.

Typical states include:

```text
healthy
overdue
awaiting first capture
error
paused
```

This makes monitoring reliability visible alongside competitor intelligence.

---

# Reports and Digests

Individual alerts are useful for urgent activity, but competitive intelligence also benefits from periodic synthesis.

Morrow supports recurring:

- daily summaries
- weekly competitor briefings
- monthly competitive-landscape reports

The reporting pipeline follows the same deterministic-data philosophy as the monitoring engine.

```text
Persisted classified changes
        ↓
Closed reporting window
        ↓
Workspace-scoped query
        ↓
Group by competitor
        ↓
Group by significance
        ↓
Group by category
        ↓
Rank important activity
        ↓
Build structured digest
        ↓
Narrative / report
        ↓
Delivery + archive
```

---

## Digest Reporting Windows

Digest windows use explicit closed calendar periods rather than rolling "last N hours" calculations.

### Daily

Previous completed UTC calendar day.

### Weekly

Previous completed UTC Monday-to-Monday week.

### Monthly

Previous completed UTC calendar month.

Queries use half-open intervals:

```text
detected_at >= windowStart
detected_at < windowEnd
```

This prevents events on reporting boundaries from being counted twice.

---

## Digest Intelligence

Reports aggregate already-classified changes.

Digest intelligence includes:

- total change count
- major change count
- moderate change count
- minor change count
- category counts
- competitor activity
- ranked changes
- structured reporting metadata

Changes are deterministically ranked before narrative generation.

Example weekly briefing:

```text
Weekly Competitive Briefing

Top Changes
Pricing Moves
Product & Feature Launches
Positioning Shifts
Promotions
Most Active Competitors
Items Worth Investigating
```

---

## Digest Reliability

Digest persistence is idempotent.

A reporting window is uniquely identified by:

```text
workspace
+
period
+
window start
+
window end
```

Generation states are:

```text
pending
generated
failed
```

Concurrent scheduler invocations use atomic ownership semantics so only one process generates a reporting window.

Failed generation can be retried without creating duplicate reports.

The scheduler provides a bounded retry window for scheduled digest generation.

---

# Notifications

Morrow delivers intelligence without coupling notification failures to the monitoring pipeline.

The architecture is:

```text
Meaningful change persisted
        ↓
Resolve workspace recipients
        ↓
Apply notification policy
        ↓
Claim delivery
        ↓
Send
        ↓
Record delivery state
```

A failed notification cannot invalidate an already-persisted competitor change.

---

## Email Alerts

Email notifications can include:

- competitor
- monitored page
- category
- significance
- summary
- why the change matters
- link to change detail
- link to competitor profile

Notification preferences support controls such as:

- email enabled
- major changes only
- immediate alerts
- digest mode

Persistent delivery state prevents duplicate notifications and allows failed deliveries to be retried safely.

---

## Integrations

Morrow's notification architecture supports multiple delivery adapters.

Channels include:

- Email
- Slack
- Telegram
- Webhooks

All channels consume the same persisted intelligence.

They do not create separate monitoring or classification pipelines.

---

## Webhooks

Technical teams can receive structured Morrow events in their own systems.

Webhook use cases include:

- internal dashboards
- CRM workflows
- competitive-intelligence pipelines
- data warehouses
- automation platforms
- custom alerting systems

Example event shape:

```json
{
  "type": "change.detected",
  "competitor": {
    "id": "competitor_id",
    "name": "Example"
  },
  "page": {
    "id": "page_id",
    "url": "https://example.com/pricing"
  },
  "change": {
    "category": "pricing",
    "significance": "major",
    "summary": "The Pro plan price increased.",
    "detectedAt": "2026-09-28T00:00:00.000Z"
  }
}
```

---

# Search and Long-Term Intelligence

Morrow becomes more useful as historical data accumulates.

Over time, competitor history can reveal patterns such as:

- pricing cadence
- launch frequency
- recurring promotions
- repeated messaging themes
- product expansion
- feature expansion
- positioning changes
- promotional seasonality
- competitor activity levels

This moves the product beyond change alerts toward long-term competitive intelligence.

---

# Teams and Collaboration

Morrow uses workspaces as the primary ownership boundary.

```text
User
  ↓
Workspace membership
  ↓
Workspace
  ↓
Competitors
  ↓
Monitored pages
  ↓
Snapshots + changes + reports
```

This architecture supports collaborative competitive-intelligence teams without attaching product data directly to individual users.

---

## Roles

Workspace roles include:

- owner
- admin
- member
- viewer

Permissions can control who may:

- add competitors
- configure monitoring
- pause monitors
- delete data
- invite users
- manage integrations
- manage reports
- manage billing

---

## Collaboration

Team workflows can include:

- shared competitor watchlists
- comments on changes
- assignments
- saved views
- change acknowledgements
- investigation tracking
- shared reports

---

# Usage Limits and Plans

Morrow enforces resource limits on the server rather than relying on frontend restrictions.

Usage dimensions include:

- competitors
- monitored pages
- pages per competitor
- monitoring frequency
- retained history
- team members
- advanced integrations
- reporting capabilities

Server-side enforcement prevents clients from bypassing plan restrictions by submitting requests directly.

---

## Billing Architecture

Billing is separated from monitoring.

```text
Payment provider
      ↓
Subscription
      ↓
Internal entitlement model
      ↓
Workspace capabilities
```

The rest of Morrow asks the entitlement layer what a workspace is allowed to do rather than depending directly on payment-provider state.

Entitlements can describe:

```text
subscription status
plan
competitor limit
page limit
capture frequency
history retention
team limit
integration access
feature flags
```

This keeps monitoring logic independent from billing infrastructure.

---

# Architecture

Morrow is built around a strict separation between **capture**, **analysis**, **persistence**, and **delivery**.

```text
                       ┌─────────────────────┐
                       │   Cloudflare Cron   │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Scheduler / Claims  │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Browser Rendering   │
                       │     Playwright      │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Snapshot Extraction │
                       │  HTML / Text / PNG  │
                       └──────────┬──────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
             ┌─────────────┐             ┌─────────────┐
             │ Cloudflare  │             │ Cloudflare  │
             │     R2      │             │     D1      │
             │  Evidence   │             │  Metadata   │
             └──────┬──────┘             └──────┬──────┘
                    │                           │
                    └─────────────┬─────────────┘
                                  ▼
                       ┌─────────────────────┐
                       │ Change Comparison   │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Noise / Volatility  │
                       │      Filtering      │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Classification      │
                       │ + Significance      │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Workers AI Summary  │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Persisted Change    │
                       └──────────┬──────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
       ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
       │  Dashboard  │     │   Digests   │     │Notifications│
       │  + History  │     │ + Reports   │     │+ Integrations│
       └─────────────┘     └─────────────┘     └─────────────┘
```

---

# Design Principles

## Persist intelligence once

Expensive monitoring and analysis happen when a capture occurs.

Views consume persisted results.

```text
capture + analyze once
        ↓
persist
        ↓
read many times
```

---

## Deterministic data before AI

AI does not decide the entire monitoring pipeline.

Morrow first determines:

- what changed
- whether it matters
- its category
- its significance
- the bounded evidence

AI then explains that structured result.

---

## Evidence is first-class

Every meaningful change remains connected to the snapshots that produced it.

Morrow is designed so intelligence can be investigated rather than simply trusted as an opaque model response.

---

## Workspace authorization everywhere

Competitors, monitored pages, snapshots, changes, reports, and notification activity are always resolved through workspace ownership.

An authenticated session alone is not sufficient authorization to read arbitrary records.

---

## Failure isolation

Independent systems should fail independently.

Examples:

```text
email failure
≠ monitoring failure

digest failure
≠ page capture failure

AI summary failure
≠ loss of snapshot evidence

one competitor failure
≠ scheduler failure
```

---

## Idempotency

Scheduled and asynchronous systems may execute more than once.

Morrow therefore uses persistent uniqueness and ownership mechanisms where duplicate execution could otherwise produce duplicate state.

---

# Technology Stack

| Layer | Technology |
|---|---|
| Application | Next.js 16 |
| UI | React |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Cloud runtime | Cloudflare Workers |
| Next.js on Workers | Vinext |
| Database | Cloudflare D1 |
| Object storage | Cloudflare R2 |
| Authentication | Better Auth |
| Browser automation | Cloudflare Browser Rendering + Playwright |
| HTML extraction | Cheerio |
| AI | Cloudflare Workers AI |
| Cache | Cloudflare KV + Workers Cache |
| Image infrastructure | Cloudflare Images |
| Email | Resend |
| Testing | Node scripts, isolated D1 fixtures, Playwright |
| Deployment tooling | Wrangler |

---

# Cloudflare Resources

The Worker uses the following bindings:

| Binding | Purpose |
|---|---|
| `DB` | D1 application database |
| `morrow_snapshots` | R2 snapshot evidence |
| `VINEXT_KV_CACHE` | Vinext / application cache |
| `BROWSER` | Browser Rendering |
| `AI` | Workers AI |
| `IMAGES` | Cloudflare Images |
| `ASSETS` | Static application assets |

The Worker also runs from a scheduled Cloudflare cron trigger.

---

# Data Model

The core relational model is:

```text
users
  │
  ├── workspace_members
  │         │
  │         ▼
  │     workspaces
  │         │
  │         ▼
  │     competitors
  │         │
  │         ▼
  │   monitored_pages
  │      │       │
  │      │       ▼
  │      │    snapshots
  │      │       │
  │      └───────┴──────► changes
  │
  ├── notification_preferences
  │
  └── notification_deliveries

workspaces
  │
  └── digests
```

---

## Snapshots vs Changes

These are intentionally different concepts.

### Snapshot

A captured state of a monitored page.

### Change

A meaningful interpreted transition between two snapshots.

Therefore:

```text
snapshot ≠ change
```

A page can accumulate snapshots without producing meaningful changes.

---

# Scheduler

Morrow uses a recurring Cloudflare Worker scheduler.

The scheduler is responsible for independent workloads including:

```text
Monitoring scheduler
    ├── discover due pages
    ├── claim pages
    ├── capture
    ├── compare
    ├── analyze
    └── persist

Digest scheduler
    ├── calculate due reporting windows
    ├── discover workspaces
    ├── generate reports
    └── persist digest state
```

The responsibilities are isolated so failure in one does not prevent the other from running.

---

# Authentication and Authorization

Authentication is handled by Better Auth.

New accounts are provisioned into a workspace model.

Authorization follows relationships such as:

```text
session.user.id
      ↓
workspace_members
      ↓
workspace
      ↓
competitor
      ↓
monitored page
      ↓
snapshot / change
```

Queries that expose competitive intelligence enforce workspace membership on the server.

---

# Repository Structure

```text
morrow/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   ├── changes/
│   │   └── snapshots/
│   │
│   ├── dashboard/
│   │   ├── changes/
│   │   ├── competitors/
│   │   └── pages/
│   │
│   ├── login/
│   └── register/
│
├── lib/
│   ├── auth.ts
│   └── usage-limits.ts
│
├── migrations/
│   ├── 0001_initial_schema.sql
│   ├── 0002_add_auth_tables.sql
│   ├── 0003_add_notification_deliveries.sql
│   ├── 0004_align_change_categories.sql
│   ├── 0005_repair_remote_change_categories.sql
│   ├── 0006_add_monitoring_selectors.sql
│   └── 0007_add_digests.sql
│
├── worker/
│   ├── index.ts
│   ├── monitoring-scope.ts
│   ├── change-classifier.ts
│   ├── change-summarizer.ts
│   ├── change-email.ts
│   ├── digest-query.ts
│   ├── digest-generator.ts
│   └── digest-scheduler.ts
│
├── scripts/
│   └── verification and acceptance harnesses
│
├── wrangler.jsonc
├── package.json
└── README.md
```

---

# Local Development

## Requirements

Install:

- Node.js
- npm
- Wrangler
- a Cloudflare account for Cloudflare-backed runtime functionality

Clone the repository and install dependencies:

```bash
npm install
```

---

## Development Server

Standard Next.js development:

```bash
npm run dev
```

Vinext / Cloudflare-oriented development:

```bash
npm run dev:vinext
```

The Vinext development server uses port `3001`.

---

# Database

Morrow uses Cloudflare D1 with forward SQL migrations.

List local migration state:

```bash
npx wrangler d1 migrations list DB --local
```

Apply local migrations:

```bash
npx wrangler d1 migrations apply DB --local
```

List production migration state:

```bash
npx wrangler d1 migrations list DB --remote
```

Apply production migrations:

```bash
npx wrangler d1 migrations apply DB --remote
```

Remote migrations should be reviewed before application.

---

# Environment Configuration

Application configuration includes values such as:

```text
BETTER_AUTH_SECRET
BETTER_AUTH_URL
MORROW_APP_URL

RESEND_API_KEY
MORROW_EMAIL_FROM
```

Cloudflare resource bindings are configured through Wrangler rather than exposed as ordinary client-side environment variables.

Secrets must not be committed to the repository.

---

# Build

Generate Next.js route types:

```bash
npx next typegen
```

Run TypeScript verification:

```bash
npx tsc --noEmit
```

Run ESLint:

```bash
npm run lint
```

Build the Cloudflare/Vinext production application:

```bash
npm run build:vinext
```

---

# Production Runtime

The application is built for Cloudflare Workers through Vinext.

The production runtime combines:

```text
Next.js
+
Vinext
+
Cloudflare Workers
+
D1
+
R2
+
Browser Rendering
+
Workers AI
+
KV
```

This keeps the web application and monitoring Worker close to the Cloudflare infrastructure used for persistence, capture, scheduling, and AI.

---

# Testing Strategy

Morrow uses layered verification rather than relying on compilation alone.

The testing model includes:

### Pure deterministic tests

Used for logic such as:

- classification
- reporting windows
- ranking
- category aggregation
- significance aggregation
- selector parsing
- digest construction

### Isolated D1 tests

Used for:

- migrations
- foreign keys
- uniqueness
- persistence
- authorization queries
- idempotency
- concurrency
- retry behavior

### Worker integration tests

Used for:

- scheduler behavior
- monitoring orchestration
- notification isolation
- digest orchestration
- capture lifecycle

### Browser tests

Used for:

- authenticated routes
- dashboard behavior
- history navigation
- competitor pages
- visual evidence

### Production build verification

```bash
npx next typegen
npx tsc --noEmit
npm run lint
npm run build:vinext
```

Generated `.next` artifacts from Vinext should not be treated as canonical Next.js route types after a Vinext production build. When canonical Next type validation is needed again, regenerate `.next/types` with `next typegen`.

---

# Reliability Model

Morrow treats monitoring as a distributed scheduled system where retries and duplicate execution are normal possibilities.

Reliability mechanisms include:

- page claim leases
- deterministic reporting windows
- unique persistence constraints
- delivery idempotency
- digest generation ownership
- bounded retry behavior
- workspace isolation
- failure boundaries
- persisted provider delivery state
- snapshot evidence preservation

---

# Security Model

Security-sensitive operations are enforced on the server.

Important boundaries include:

- authenticated sessions
- workspace membership authorization
- protected snapshot evidence
- server-side usage limits
- parameter-bound D1 queries
- output escaping for notification content
- secrets stored outside source control
- least-privilege provider credentials
- workspace-scoped history queries

An identifier supplied by a browser is never sufficient proof that the current user may access the corresponding resource.

---

# Product Direction

Morrow is designed to evolve from website monitoring into a durable competitive-intelligence system.

The progression is:

```text
Website monitoring
        ↓
Meaningful change detection
        ↓
Structured competitor history
        ↓
Searchable intelligence
        ↓
Recurring reports
        ↓
Multi-channel delivery
        ↓
Historical pattern analysis
        ↓
Team competitive intelligence
```

The long-term value comes from accumulation.

A single capture tells you what a competitor looks like today.

A single change tells you what happened.

A historical intelligence system tells you **how that competitor is evolving**.

---

# Example Use Cases

## SaaS Competitive Monitoring

Track:

- pricing
- packaging
- feature launches
- free-tier changes
- positioning
- product announcements

---

## E-commerce Intelligence

Track:

- promotions
- category pages
- merchandising
- pricing
- product launches
- seasonal campaigns

---

## Product Teams

Monitor competitors for:

- new capabilities
- removed capabilities
- feature positioning
- product expansion
- pricing strategy

---

## Marketing Teams

Monitor:

- homepage messaging
- campaign launches
- landing pages
- positioning
- promotions
- target-audience changes

---

## Founders and Strategy Teams

Use accumulated history to understand:

- competitor activity
- strategic direction
- pricing behavior
- launch cadence
- positioning evolution
- market movement

---

# Why Morrow

Traditional website-change monitors answer:

```text
Did this page change?
```

Morrow is built to answer:

```text
What changed?

Was it meaningful?

How important was it?

What category of business change was it?

What exactly changed before and after?

Why might it matter?

Has this competitor done something similar before?

What broader pattern is emerging?
```

That difference is the foundation of Morrow.

---

# Roadmap

Morrow's product roadmap is organized around ten major areas:

1. **Core Monitoring**
   - accounts and workspaces
   - competitors
   - monitored pages
   - scheduled browser capture
   - snapshot persistence

2. **Meaningful Change Detection**
   - comparison
   - noise filtering
   - volatility suppression
   - classification
   - significance
   - AI explanations

3. **Competitor Profiles**
   - page management
   - competitor intelligence
   - activity summaries

4. **Advanced Monitoring**
   - section-level monitoring
   - ignore regions
   - visual comparison
   - richer capture evidence

5. **Intelligence Dashboard**
   - recent activity
   - high-significance changes
   - monitoring health
   - competitor activity

6. **Search and Historical Intelligence**
   - global history
   - page timelines
   - competitor timelines
   - snapshot browsing
   - historical filters
   - long-term patterns

7. **Reports and Digests**
   - daily summaries
   - weekly briefings
   - monthly reports
   - structured aggregation
   - report archives

8. **Notifications and Integrations**
   - email
   - Slack
   - Telegram
   - webhooks
   - notification routing

9. **Teams and Collaboration**
   - roles
   - invitations
   - shared watchlists
   - comments
   - assignments
   - saved views

10. **Billing and Plans**
    - subscriptions
    - entitlements
    - resource limits
    - monitoring-frequency limits
    - history retention
    - team limits
    - integration access

---

# Engineering Philosophy

Morrow favors correctness and traceability over opaque automation.

The system is built around several rules:

1. **Capture evidence before interpreting it.**
2. **Separate snapshots from meaningful changes.**
3. **Filter noise before generating intelligence.**
4. **Use deterministic logic before AI.**
5. **Persist intelligence once and read it many times.**
6. **Keep every change connected to evidence.**
7. **Enforce authorization at the database/query boundary.**
8. **Expect retries and design for idempotency.**
9. **Isolate external-service failures from core monitoring.**
10. **Treat historical data as a long-term product asset.**

---

# Morrow

**Monitor competitors. Detect what matters. Understand what changed.**
