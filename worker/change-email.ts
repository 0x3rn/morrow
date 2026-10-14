import {
  DIGEST_PERIODS,
  parseDigestContent,
  type DigestPeriod,
  type GeneratedDigest,
} from "./digest-generator.ts";
import {
  matchesChangeRoutingPolicy,
  scopeDigestContentToRoutingPolicy,
} from "./notification-routing.ts";

export interface ChangeEmailEnv {
  DB: D1Database;

  RESEND_API_KEY?: string;

  MORROW_EMAIL_FROM?: string;

  MORROW_APP_URL?: string;
}

export interface ChangeNotificationContext {
  change_id: string;

  category: string;

  significance: string;

  summary: string | null;

  why_it_matters: string | null;

  detected_at: string;

  monitored_page_id: string;

  monitored_page_url: string;

  monitored_page_label: string | null;

  competitor_id: string;

  competitor_name: string;

  competitor_domain: string;

  workspace_id: string;
}

export interface NotificationRecipient {
  user_id: string;

  email: string;

  name: string | null;

  email_enabled: number;

  major_only: number;

  min_significance?: string;

  categories_json?: string;

  competitor_ids_json?: string;

  digest_email_enabled?: number;

  digest_periods_json?: string;
}

interface ExistingDelivery {
  id: string;

  status: string;

  attempt_count: number;
}

interface DeliveryClaim {
  claimed: boolean;

  deliveryId: string | null;

  claimToken: string | null;

  reason:
    | "claimed"
    | "already_sent"
    | "in_flight";
}

export interface BuiltChangeEmail {
  subject: string;

  html: string;

  text: string;

  changeUrl: string;

  competitorUrl: string;
}

export interface BuiltDigestEmail {
  subject: string;

  html: string;

  text: string;

  dashboardUrl: string;

  changesUrl: string;
}

export interface ResendEmailRequest {
  apiKey: string;

  from: string;

  to: string;

  subject: string;

  html: string;

  text: string;

  idempotencyKey: string;
}

export interface ResendEmailResult {
  id: string;
}

export interface ChangeEmailRunResult {
  changeId: string;

  changeFound: boolean;

  configured: boolean;

  recipientsFound: number;

  eligibleRecipients: number;

  sent: number;

  alreadySent: number;

  inFlight: number;

  failed: number;
}

export interface DigestEmailRunResult {
  digestId: string;

  digestFound: boolean;

  configured: boolean;

  recipientsFound: number;

  eligibleRecipients: number;

  sent: number;

  alreadySent: number;

  inFlight: number;

  failed: number;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

function getAffectedRows(
  result: D1Result<unknown>
) {
  return Number(
    result.meta?.changes ?? 0
  );
}

function trimError(
  value: unknown
) {
  const message =
    value instanceof Error
      ? value.message
      : String(value);

  return message.slice(
    0,
    2000
  );
}

function capitalize(
  value: string
) {
  if (!value) {
    return value;
  }

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

export function escapeHtml(
  value: string
) {
  return value
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

function getAppOrigin(
  appUrl: string
) {
  const parsed =
    new URL(appUrl);

  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:"
  ) {
    throw new Error(
      "MORROW_APP_URL must use HTTP or HTTPS."
    );
  }

  return parsed.origin;
}

export function shouldEmailRecipient(
  recipient: NotificationRecipient,
  changeOrSignificance:
    | string
    | {
        significance: string;
        category?: string;
        competitor_id?: string;
        competitorId?: string;
      }
) {
  if (
    typeof changeOrSignificance === "string"
  ) {
    return matchesChangeRoutingPolicy(
      {
        category: "other",
        significance: changeOrSignificance,
        competitorId: "",
      },
      {
        enabled: recipient.email_enabled,
        sendChanges: 1,
        minSignificance:
          recipient.min_significance,
        majorOnly: recipient.major_only,
      }
    );
  }

  const competitorId =
    changeOrSignificance.competitor_id ??
    changeOrSignificance.competitorId ??
    "";

  return matchesChangeRoutingPolicy(
    {
      category:
        changeOrSignificance.category ??
        "other",
      significance:
        changeOrSignificance.significance,
      competitorId,
    },
    {
      enabled: recipient.email_enabled,
      sendChanges: 1,
      minSignificance:
        recipient.min_significance,
      majorOnly: recipient.major_only,
      categoriesJson:
        changedFilterJsonIfPresent(
          changeOrSignificance.category,
          recipient.categories_json
        ),
      competitorIdsJson:
        changedFilterJsonIfPresent(
          competitorId,
          recipient.competitor_ids_json
        ),
    }
  );
}

function changedFilterJsonIfPresent(
  candidateValue: string | undefined,
  filterJson: string | undefined
) {
  if (!candidateValue) {
    return "[]";
  }

  return filterJson ?? "[]";
}

export function buildEmailIdempotencyKey(
  changeId: string,
  userId: string
) {
  const key =
    `morrow/change/${changeId}/user/${userId}/email`;

  if (
    key.length > 256
  ) {
    throw new Error(
      "Email idempotency key exceeds 256 characters."
    );
  }

  return key;
}

export function buildDigestEmailIdempotencyKey(
  digestId: string,
  userId: string
) {
  const key =
    `morrow/digest/${digestId}/user/${userId}/email`;

  if (
    key.length > 256
  ) {
    throw new Error(
      "Digest email idempotency key exceeds 256 characters."
    );
  }

  return key;
}

export function buildChangeEmail(
  context: ChangeNotificationContext,
  appUrl: string
): BuiltChangeEmail {
  const origin =
    getAppOrigin(
      appUrl
    );

  const changeUrl =
    new URL(
      `/dashboard/changes/${encodeURIComponent(
        context.change_id
      )}`,
      origin
    ).toString();

  const competitorUrl =
    new URL(
      `/dashboard/competitors/${encodeURIComponent(
        context.competitor_id
      )}`,
      origin
    ).toString();

  const significanceLabel =
    capitalize(
      context.significance
    );

  const categoryLabel =
    capitalize(
      context.category
    );

  const summary =
    context.summary?.trim() ||
    `A meaningful ${context.category} change was detected.`;

  const whyItMatters =
    context.why_it_matters?.trim() ||
    null;

  const subject =
    `${significanceLabel}: ${context.competitor_name} ${context.category} change`;

  const escapedCompetitor =
    escapeHtml(
      context.competitor_name
    );

  const escapedDomain =
    escapeHtml(
      context.competitor_domain
    );

  const escapedCategory =
    escapeHtml(
      categoryLabel
    );

  const escapedSignificance =
    escapeHtml(
      significanceLabel
    );

  const escapedSummary =
    escapeHtml(
      summary
    );

  const escapedWhy =
    whyItMatters
      ? escapeHtml(
          whyItMatters
        )
      : null;

  const escapedMonitoredUrl =
    escapeHtml(
      context.monitored_page_url
    );

  const escapedChangeUrl =
    escapeHtml(
      changeUrl
    );

  const escapedCompetitorUrl =
    escapeHtml(
      competitorUrl
    );

  const html = `
<!doctype html>
<html>
  <body
    style="
      margin:0;
      padding:0;
      background:#f8fafc;
      color:#0f172a;
      font-family:Arial,Helvetica,sans-serif;
    "
  >
    <div
      style="
        max-width:640px;
        margin:0 auto;
        padding:32px 20px;
      "
    >
      <div
        style="
          background:#ffffff;
          border:1px solid #e2e8f0;
          border-radius:16px;
          padding:28px;
        "
      >
        <div
          style="
            font-size:12px;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:.08em;
            color:#4f46e5;
            margin-bottom:12px;
          "
        >
          Morrow competitor alert
        </div>

        <h1
          style="
            margin:0;
            font-size:24px;
            line-height:1.3;
            color:#0f172a;
          "
        >
          ${escapedCompetitor}
        </h1>

        <div
          style="
            margin-top:6px;
            font-size:13px;
            color:#64748b;
          "
        >
          ${escapedDomain}
        </div>

        <div
          style="
            margin-top:20px;
            font-size:13px;
            color:#475569;
          "
        >
          ${escapedCategory}
          &nbsp;•&nbsp;
          ${escapedSignificance}
        </div>

        <p
          style="
            margin:18px 0 0;
            font-size:17px;
            line-height:1.6;
            font-weight:600;
            color:#0f172a;
          "
        >
          ${escapedSummary}
        </p>

        ${
          escapedWhy
            ? `
        <div
          style="
            margin-top:20px;
            padding:16px;
            border-radius:12px;
            background:#f8fafc;
          "
        >
          <div
            style="
              font-size:12px;
              font-weight:700;
              color:#475569;
              margin-bottom:6px;
            "
          >
            Why it matters
          </div>

          <div
            style="
              font-size:14px;
              line-height:1.6;
              color:#475569;
            "
          >
            ${escapedWhy}
          </div>
        </div>
        `
            : ""
        }

        <div
          style="
            margin-top:20px;
            font-size:12px;
            color:#64748b;
            word-break:break-all;
          "
        >
          Monitored page:
          ${escapedMonitoredUrl}
        </div>

        <div
          style="
            margin-top:24px;
          "
        >
          <a
            href="${escapedChangeUrl}"
            style="
              display:inline-block;
              margin-right:10px;
              margin-bottom:10px;
              padding:11px 16px;
              border-radius:10px;
              background:#4f46e5;
              color:#ffffff;
              font-size:14px;
              font-weight:600;
              text-decoration:none;
            "
          >
            View change
          </a>

          <a
            href="${escapedCompetitorUrl}"
            style="
              display:inline-block;
              margin-bottom:10px;
              padding:11px 16px;
              border-radius:10px;
              border:1px solid #cbd5e1;
              color:#334155;
              font-size:14px;
              font-weight:600;
              text-decoration:none;
            "
          >
            Open competitor
          </a>
        </div>
      </div>

      <div
        style="
          margin-top:16px;
          text-align:center;
          font-size:11px;
          color:#94a3b8;
        "
      >
        Morrow detected this change from a page you monitor.
      </div>
    </div>
  </body>
</html>
  `.trim();

  const textParts = [
    "Morrow competitor alert",
    "",
    context.competitor_name,
    context.competitor_domain,
    "",
    `${categoryLabel} • ${significanceLabel}`,
    "",
    summary,
  ];

  if (
    whyItMatters
  ) {
    textParts.push(
      "",
      "Why it matters",
      whyItMatters
    );
  }

  textParts.push(
    "",
    `Monitored page: ${context.monitored_page_url}`,
    "",
    `View change: ${changeUrl}`,
    `Open competitor: ${competitorUrl}`
  );

  return {
    subject,
    html,
    text:
      textParts.join(
        "\n"
      ),
    changeUrl,
    competitorUrl,
  };
}

export async function sendResendEmail(
  request: ResendEmailRequest,
  fetcher: FetchLike = fetch
): Promise<ResendEmailResult> {
  const response =
    await fetcher(
      "https://api.resend.com/emails",
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${request.apiKey}`,

          "Content-Type":
            "application/json",

          "Idempotency-Key":
            request.idempotencyKey,
        },

        body:
          JSON.stringify({
            from:
              request.from,

            to: [
              request.to,
            ],

            subject:
              request.subject,

            html:
              request.html,

            text:
              request.text,

            tags: [
              {
                name:
                  "source",

                value:
                  "morrow_change",
              },
            ],
          }),
      }
    );

  const rawBody =
    await response.text();

  let parsed:
    | {
        id?: string;

        message?: string;

        name?: string;
      }
    | null = null;

  if (
    rawBody
  ) {
    try {
      parsed =
        JSON.parse(
          rawBody
        );
    } catch {
      parsed = null;
    }
  }

  if (
    !response.ok
  ) {
    const providerMessage =
      parsed?.message ||
      rawBody ||
      response.statusText ||
      "Unknown Resend error";

    throw new Error(
      `Resend email failed (${response.status}): ${providerMessage}`
    );
  }

  if (
    !parsed?.id
  ) {
    throw new Error(
      "Resend email succeeded but returned no message ID."
    );
  }

  return {
    id:
      parsed.id,
  };
}

async function getChangeContext(
  db: D1Database,
  changeId: string
) {
  return db
    .prepare(
      `
        SELECT
          changes.id
            AS change_id,

          changes.category,
          changes.significance,
          changes.summary,
          changes.why_it_matters,
          changes.detected_at,

          monitored_pages.id
            AS monitored_page_id,

          monitored_pages.url
            AS monitored_page_url,

          monitored_pages.label
            AS monitored_page_label,

          competitors.id
            AS competitor_id,

          competitors.name
            AS competitor_name,

          competitors.domain
            AS competitor_domain,

          competitors.workspace_id

        FROM changes

        INNER JOIN monitored_pages
          ON monitored_pages.id =
             changes.monitored_page_id

        INNER JOIN competitors
          ON competitors.id =
             monitored_pages.competitor_id

        WHERE changes.id = ?

        LIMIT 1
      `
    )
    .bind(
      changeId
    )
    .first<ChangeNotificationContext>();
}

async function getRecipients(
  db: D1Database,
  workspaceId: string
) {
  const {
    results,
  } = await db
    .prepare(
      `
        SELECT
          users.id
            AS user_id,

          users.email,
          users.name,

          COALESCE(
            notification_preferences.email_enabled,
            1
          ) AS email_enabled,

          COALESCE(
            notification_preferences.major_only,
            0
          ) AS major_only,

          COALESCE(
            notification_preferences.min_significance,
            'minor'
          ) AS min_significance,

          COALESCE(
            notification_preferences.categories_json,
            '[]'
          ) AS categories_json,

          COALESCE(
            notification_preferences.competitor_ids_json,
            '[]'
          ) AS competitor_ids_json,

          COALESCE(
            notification_preferences.digest_email_enabled,
            0
          ) AS digest_email_enabled,

          COALESCE(
            notification_preferences.digest_periods_json,
            '["weekly"]'
          ) AS digest_periods_json

        FROM workspace_members

        INNER JOIN users
          ON users.id =
             workspace_members.user_id

        LEFT JOIN notification_preferences
          ON notification_preferences.user_id =
             users.id

        WHERE workspace_members.workspace_id = ?

          AND TRIM(
            users.email
          ) <> ''

        ORDER BY
          users.id ASC
      `
    )
    .bind(
      workspaceId
    )
    .all<NotificationRecipient>();

  return results;
}

async function claimEmailDelivery(
  db: D1Database,
  changeId: string,
  userId: string
): Promise<DeliveryClaim> {
  const deliveryId =
    crypto.randomUUID();

  const claimToken =
    crypto.randomUUID();

  const insertResult =
    await db
      .prepare(
        `
          INSERT OR IGNORE
          INTO notification_deliveries (
            id,
            change_id,
            user_id,
            channel,
            status,
            attempt_count,
            claim_token,
            claimed_at,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            ?,
            'email',
            'sending',
            1,
            ?,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `
      )
      .bind(
        deliveryId,
        changeId,
        userId,
        claimToken
      )
      .run();

  if (
    getAffectedRows(
      insertResult
    ) > 0
  ) {
    return {
      claimed:
        true,

      deliveryId,

      claimToken,

      reason:
        "claimed",
    };
  }

  /*
   * A previous failed delivery can be retried.
   *
   * A "sending" claim can also be recovered after
   * 15 minutes in case a Worker died between claiming
   * the row and finishing the provider request.
   */
  const retryResult =
    await db
      .prepare(
        `
          UPDATE notification_deliveries

          SET
            status =
              'sending',

            attempt_count =
              attempt_count + 1,

            claim_token =
              ?,

            claimed_at =
              CURRENT_TIMESTAMP,

            last_error =
              NULL,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE change_id = ?

            AND user_id = ?

            AND channel =
              'email'

            AND status <>
              'sent'

            AND (
              status =
                'failed'

              OR (
                status =
                  'sending'

                AND datetime(
                  claimed_at
                ) <= datetime(
                  'now',
                  '-15 minutes'
                )
              )
            )
        `
      )
      .bind(
        claimToken,
        changeId,
        userId
      )
      .run();

  if (
    getAffectedRows(
      retryResult
    ) > 0
  ) {
    const row =
      await db
        .prepare(
          `
            SELECT
              id,
              status,
              attempt_count

            FROM notification_deliveries

            WHERE change_id = ?

              AND user_id = ?

              AND channel =
                'email'

            LIMIT 1
          `
        )
        .bind(
          changeId,
          userId
        )
        .first<ExistingDelivery>();

    if (
      !row
    ) {
      throw new Error(
        "Notification delivery was claimed but could not be reloaded."
      );
    }

    return {
      claimed:
        true,

      deliveryId:
        row.id,

      claimToken,

      reason:
        "claimed",
    };
  }

  const existing =
    await db
      .prepare(
        `
          SELECT
            id,
            status,
            attempt_count

          FROM notification_deliveries

          WHERE change_id = ?

            AND user_id = ?

            AND channel =
              'email'

          LIMIT 1
        `
      )
      .bind(
        changeId,
        userId
      )
      .first<ExistingDelivery>();

  if (
    existing?.status ===
    "sent"
  ) {
    return {
      claimed:
        false,

      deliveryId:
        existing.id,

      claimToken:
        null,

      reason:
        "already_sent",
    };
  }

  return {
    claimed:
      false,

    deliveryId:
      existing?.id ??
      null,

    claimToken:
      null,

    reason:
      "in_flight",
  };
}

async function markDeliverySent(
  db: D1Database,
  deliveryId: string,
  claimToken: string,
  providerMessageId: string
) {
  await db
    .prepare(
      `
        UPDATE notification_deliveries

        SET
          status =
            'sent',

          provider_message_id =
            ?,

          sent_at =
            CURRENT_TIMESTAMP,

          last_error =
            NULL,

          claim_token =
            NULL,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?

          AND claim_token = ?
      `
    )
    .bind(
      providerMessageId,
      deliveryId,
      claimToken
    )
    .run();
}

async function markDeliveryFailed(
  db: D1Database,
  deliveryId: string,
  claimToken: string,
  error: unknown
) {
  await db
    .prepare(
      `
        UPDATE notification_deliveries

        SET
          status =
            'failed',

          last_error =
            ?,

          claim_token =
            NULL,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?

          AND claim_token = ?
      `
    )
    .bind(
      trimError(
        error
      ),
      deliveryId,
      claimToken
    )
    .run();
}

export async function notifyChangeByEmail(
  env: ChangeEmailEnv,
  changeId: string,
  fetcher: FetchLike = fetch
): Promise<ChangeEmailRunResult> {
  const result: ChangeEmailRunResult = {
    changeId,

    changeFound:
      false,

    configured:
      false,

    recipientsFound:
      0,

    eligibleRecipients:
      0,

    sent:
      0,

    alreadySent:
      0,

    inFlight:
      0,

    failed:
      0,
  };

  const context =
    await getChangeContext(
      env.DB,
      changeId
    );

  if (
    !context
  ) {
    return result;
  }

  result.changeFound =
    true;

  const recipients =
    await getRecipients(
      env.DB,
      context.workspace_id
    );

  result.recipientsFound =
    recipients.length;

  const eligible =
    recipients.filter(
      (recipient) =>
        shouldEmailRecipient(
          recipient,
          context
        )
    );

  result.eligibleRecipients =
    eligible.length;

  /*
   * Provider configuration is optional at runtime.
   *
   * This lets local development and the monitoring
   * pipeline keep functioning even before production
   * email secrets are configured.
   */
  if (
    !env.RESEND_API_KEY ||
    !env.MORROW_EMAIL_FROM ||
    !env.MORROW_APP_URL
  ) {
    console.log(
      "Morrow email notification skipped because email delivery is not configured.",
      {
        changeId,
        eligibleRecipients:
          eligible.length,
      }
    );

    return result;
  }

  result.configured =
    true;

  const email =
    buildChangeEmail(
      context,
      env.MORROW_APP_URL
    );

  for (
    const recipient
    of eligible
  ) {
    let claim:
      | DeliveryClaim
      | null = null;

    try {
      claim =
        await claimEmailDelivery(
          env.DB,
          context.change_id,
          recipient.user_id
        );

      if (
        !claim.claimed
      ) {
        if (
          claim.reason ===
          "already_sent"
        ) {
          result.alreadySent +=
            1;
        } else {
          result.inFlight +=
            1;
        }

        continue;
      }

      if (
        !claim.deliveryId ||
        !claim.claimToken
      ) {
        throw new Error(
          "Email delivery claim is missing its delivery ID or claim token."
        );
      }

      const providerResult =
        await sendResendEmail(
          {
            apiKey:
              env.RESEND_API_KEY,

            from:
              env.MORROW_EMAIL_FROM,

            to:
              recipient.email,

            subject:
              email.subject,

            html:
              email.html,

            text:
              email.text,

            idempotencyKey:
              buildEmailIdempotencyKey(
                context.change_id,
                recipient.user_id
              ),
          },
          fetcher
        );

      await markDeliverySent(
        env.DB,
        claim.deliveryId,
        claim.claimToken,
        providerResult.id
      );

      result.sent +=
        1;
    } catch (error) {
      result.failed +=
        1;

      if (
        claim?.claimed &&
        claim.deliveryId &&
        claim.claimToken
      ) {
        try {
          await markDeliveryFailed(
            env.DB,
            claim.deliveryId,
            claim.claimToken,
            error
          );
        } catch (
          markError
        ) {
          console.error(
            "Morrow could not record email delivery failure.",
            {
              changeId,
              userId:
                recipient.user_id,

              deliveryId:
                claim.deliveryId,

              error:
                trimError(
                  markError
                ),
            }
          );
        }
      }

      /*
       * Email is downstream of persisted change
       * intelligence, so one failed recipient does
       * not stop remaining recipients and does not
       * invalidate the change itself.
       */
      console.error(
        "Morrow email delivery failed.",
        {
          changeId,

          userId:
            recipient.user_id,

          error:
            trimError(
              error
            ),
        }
      );
    }
  }

  return result;
}

interface PersistedDigestRow {
  id: string;
  workspace_id: string;
  period: string;
  window_start: string;
  window_end: string;
  status: string;
  change_count: number;
  major_change_count: number;
  moderate_change_count: number;
  minor_change_count: number;
  content_json: string | null;
  generated_at: string | null;
}

function isDigestPeriod(
  value: string
): value is DigestPeriod {
  return (
    DIGEST_PERIODS as readonly string[]
  ).includes(value);
}

async function getGeneratedDigestById(
  db: D1Database,
  digestId: string
): Promise<GeneratedDigest | null> {
  const row =
    await db
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            period,
            window_start,
            window_end,
            status,
            change_count,
            major_change_count,
            moderate_change_count,
            minor_change_count,
            content_json,
            generated_at
          FROM digests
          WHERE id = ?
          LIMIT 1
        `
      )
      .bind(digestId)
      .first<PersistedDigestRow>();

  if (
    !row ||
    row.status !== "generated" ||
    row.content_json === null ||
    row.generated_at === null
  ) {
    return null;
  }

  if (
    !isDigestPeriod(
      row.period
    )
  ) {
    throw new Error(
      `Persisted digest ${row.id} has unsupported period ${row.period}.`
    );
  }

  const content =
    parseDigestContent(
      row.content_json
    );

  return {
    id: row.id,
    workspaceId:
      row.workspace_id,
    period: row.period,
    windowStart:
      row.window_start,
    windowEnd:
      row.window_end,
    status: "generated",
    generatedAt:
      row.generated_at,
    content,
    reused: true,
  };
}

export function buildDigestEmail(
  digest: GeneratedDigest,
  appUrl: string
): BuiltDigestEmail {
  const origin =
    getAppOrigin(appUrl);

  const dashboardUrl =
    new URL(
      "/dashboard",
      origin
    ).toString();

  const changesUrl =
    new URL(
      "/dashboard/changes",
      origin
    ).toString();

  const periodLabel =
    capitalize(
      digest.period
    );

  const { totals, competitors } =
    digest.content;

  const subject = `${periodLabel} competitor digest: ${totals.changes} meaningful ${
    totals.changes === 1
      ? "change"
      : "changes"
  }`;

  const competitorBlocksHtml =
    competitors
      .slice(0, 8)
      .map((group) => {
        const compName =
          escapeHtml(
            group.competitor
              .name
          );
        const compDomain =
          escapeHtml(
            group.competitor
              .domain
          );
        const topChangesHtml =
          group.changes
            .slice(0, 3)
            .map((chg) => {
              const summary =
                escapeHtml(
                  chg.summary?.trim() ||
                    `Meaningful ${chg.category} change detected.`
                );
              const badge =
                escapeHtml(
                  `${capitalize(chg.category)} • ${capitalize(chg.significance)}`
                );
              return `<li style="margin-top:8px;font-size:14px;line-height:1.5;color:#334155;"><strong>${badge}:</strong> ${summary}</li>`;
            })
            .join("");

        return `
          <div style="margin-top:16px;padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
            <div style="font-size:15px;font-weight:700;color:#0f172a;">${compName} <span style="font-weight:400;color:#64748b;font-size:13px;">(${compDomain})</span></div>
            <div style="margin-top:4px;font-size:12px;color:#475569;">${group.changeCount} ${
              group.changeCount === 1
                ? "change"
                : "changes"
            } (${group.majorChangeCount} major)</div>
            ${
              topChangesHtml
                ? `<ul style="margin:8px 0 0;padding-left:18px;">${topChangesHtml}</ul>`
                : ""
            }
          </div>
        `;
      })
      .join("");

  const escapedDashboardUrl =
    escapeHtml(
      dashboardUrl
    );
  const escapedChangesUrl =
    escapeHtml(changesUrl);
  const escapedPeriodLabel =
    escapeHtml(
      periodLabel
    );

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#4f46e5;margin-bottom:12px;">
          Morrow ${escapedPeriodLabel} digest
        </div>
        <h1 style="margin:0;font-size:24px;line-height:1.3;color:#0f172a;">
          ${totals.changes} meaningful ${
            totals.changes === 1
              ? "change"
              : "changes"
          } across ${competitors.length} ${
            competitors.length === 1
              ? "competitor"
              : "competitors"
          }
        </h1>
        <div style="margin-top:8px;font-size:13px;color:#64748b;">
          Major: ${totals.major} &nbsp;•&nbsp; Moderate: ${totals.moderate} &nbsp;•&nbsp; Minor: ${totals.minor}
        </div>
        ${competitorBlocksHtml}
        <div style="margin-top:24px;">
          <a href="${escapedChangesUrl}" style="display:inline-block;margin-right:10px;margin-bottom:10px;padding:11px 16px;border-radius:10px;background:#4f46e5;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
            View change history
          </a>
          <a href="${escapedDashboardUrl}" style="display:inline-block;margin-bottom:10px;padding:11px 16px;border-radius:10px;border:1px solid #cbd5e1;color:#334155;font-size:14px;font-weight:600;text-decoration:none;">
            Open dashboard
          </a>
        </div>
      </div>
    </div>
  </body>
</html>
  `.trim();

  const textLines = [
    `Morrow ${periodLabel} digest`,
    "",
    `${totals.changes} meaningful ${
      totals.changes === 1
        ? "change"
        : "changes"
    } across ${competitors.length} ${
      competitors.length === 1
        ? "competitor"
        : "competitors"
    }`,
    `Major: ${totals.major} • Moderate: ${totals.moderate} • Minor: ${totals.minor}`,
  ];

  for (const group of competitors.slice(
    0,
    8
  )) {
    textLines.push(
      "",
      `${group.competitor.name} (${group.competitor.domain}) — ${group.changeCount} ${
        group.changeCount === 1
          ? "change"
          : "changes"
      }`
    );
    for (const chg of group.changes.slice(
      0,
      3
    )) {
      textLines.push(
        `- [${capitalize(chg.significance)} ${capitalize(chg.category)}] ${
          chg.summary?.trim() ||
          `Meaningful ${chg.category} change detected.`
        }`
      );
    }
  }

  textLines.push(
    "",
    `View change history: ${changesUrl}`,
    `Open dashboard: ${dashboardUrl}`
  );

  return {
    subject,
    html,
    text: textLines.join(
      "\n"
    ),
    dashboardUrl,
    changesUrl,
  };
}

async function claimDigestEmailDelivery(
  db: D1Database,
  digestId: string,
  userId: string
): Promise<DeliveryClaim> {
  const deliveryId =
    crypto.randomUUID();
  const claimToken =
    crypto.randomUUID();

  const insertResult =
    await db
      .prepare(
        `
          INSERT OR IGNORE
          INTO digest_email_deliveries (
            id,
            digest_id,
            user_id,
            status,
            attempt_count,
            claim_token,
            claimed_at,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            ?,
            'sending',
            1,
            ?,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `
      )
      .bind(
        deliveryId,
        digestId,
        userId,
        claimToken
      )
      .run();

  if (
    getAffectedRows(
      insertResult
    ) > 0
  ) {
    return {
      claimed: true,
      deliveryId,
      claimToken,
      reason: "claimed",
    };
  }

  const retryResult =
    await db
      .prepare(
        `
          UPDATE digest_email_deliveries
          SET
            status = 'sending',
            attempt_count = attempt_count + 1,
            claim_token = ?,
            claimed_at = CURRENT_TIMESTAMP,
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE digest_id = ?
            AND user_id = ?
            AND status <> 'sent'
            AND (
              status = 'failed'
              OR (
                status = 'sending'
                AND datetime(claimed_at) <= datetime('now', '-15 minutes')
              )
            )
        `
      )
      .bind(
        claimToken,
        digestId,
        userId
      )
      .run();

  if (
    getAffectedRows(
      retryResult
    ) > 0
  ) {
    const row =
      await db
        .prepare(
          `
            SELECT
              id,
              status,
              attempt_count
            FROM digest_email_deliveries
            WHERE digest_id = ?
              AND user_id = ?
            LIMIT 1
          `
        )
        .bind(
          digestId,
          userId
        )
        .first<ExistingDelivery>();

    if (!row) {
      throw new Error(
        "Digest email delivery was claimed but could not be reloaded."
      );
    }

    return {
      claimed: true,
      deliveryId: row.id,
      claimToken,
      reason: "claimed",
    };
  }

  const existing =
    await db
      .prepare(
        `
          SELECT
            id,
            status,
            attempt_count
          FROM digest_email_deliveries
          WHERE digest_id = ?
            AND user_id = ?
          LIMIT 1
        `
      )
      .bind(
        digestId,
        userId
      )
      .first<ExistingDelivery>();

  if (
    existing?.status ===
    "sent"
  ) {
    return {
      claimed: false,
      deliveryId:
        existing.id,
      claimToken: null,
      reason:
        "already_sent",
    };
  }

  return {
    claimed: false,
    deliveryId:
      existing?.id ??
      null,
    claimToken: null,
    reason: "in_flight",
  };
}

async function markDigestEmailDeliverySent(
  db: D1Database,
  deliveryId: string,
  claimToken: string,
  providerMessageId: string
) {
  await db
    .prepare(
      `
        UPDATE digest_email_deliveries
        SET
          status = 'sent',
          provider_message_id = ?,
          sent_at = CURRENT_TIMESTAMP,
          last_error = NULL,
          claim_token = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND claim_token = ?
      `
    )
    .bind(
      providerMessageId,
      deliveryId,
      claimToken
    )
    .run();
}

async function markDigestEmailDeliveryFailed(
  db: D1Database,
  deliveryId: string,
  claimToken: string,
  error: unknown
) {
  await db
    .prepare(
      `
        UPDATE digest_email_deliveries
        SET
          status = 'failed',
          last_error = ?,
          claim_token = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND claim_token = ?
      `
    )
    .bind(
      trimError(error),
      deliveryId,
      claimToken
    )
    .run();
}

export async function notifyDigestByEmail(
  env: ChangeEmailEnv,
  digestId: string,
  fetcher: FetchLike = fetch
): Promise<DigestEmailRunResult> {
  const result: DigestEmailRunResult = {
    digestId,
    digestFound: false,
    configured: false,
    recipientsFound: 0,
    eligibleRecipients: 0,
    sent: 0,
    alreadySent: 0,
    inFlight: 0,
    failed: 0,
  };

  const digest =
    await getGeneratedDigestById(
      env.DB,
      digestId
    );

  if (!digest) {
    return result;
  }

  result.digestFound =
    true;

  const recipients =
    await getRecipients(
      env.DB,
      digest.workspaceId
    );

  result.recipientsFound =
    recipients.length;

  const eligibleWithScopedDigest =
    recipients
      .map((recipient) => {
        const scopedContent =
          scopeDigestContentToRoutingPolicy(
            digest.content,
            {
              enabled:
                Number(
                  recipient.digest_email_enabled ??
                    0
                ) === 1,
              sendDigests: 1,
              minSignificance:
                recipient.min_significance,
              majorOnly:
                recipient.major_only,
              categoriesJson:
                recipient.categories_json,
              competitorIdsJson:
                recipient.competitor_ids_json,
              digestPeriodsJson:
                recipient.digest_periods_json,
            }
          );

        return scopedContent
          ? {
              recipient,
              scopedDigest: {
                ...digest,
                content:
                  scopedContent,
              },
            }
          : null;
      })
      .filter(
        (
          entry
        ): entry is NonNullable<
          typeof entry
        > =>
          entry !== null
      );

  result.eligibleRecipients =
    eligibleWithScopedDigest.length;

  if (
    !env.RESEND_API_KEY ||
    !env.MORROW_EMAIL_FROM ||
    !env.MORROW_APP_URL
  ) {
    console.log(
      "Morrow digest email notification skipped because email delivery is not configured.",
      {
        digestId,
        eligibleRecipients:
          eligibleWithScopedDigest.length,
      }
    );

    return result;
  }

  result.configured =
    true;

  for (const {
    recipient,
    scopedDigest,
  } of eligibleWithScopedDigest) {
    let claim:
      | DeliveryClaim
      | null = null;

    try {
      claim =
        await claimDigestEmailDelivery(
          env.DB,
          digest.id,
          recipient.user_id
        );

      if (
        !claim.claimed
      ) {
        if (
          claim.reason ===
          "already_sent"
        ) {
          result.alreadySent +=
            1;
        } else {
          result.inFlight +=
            1;
        }
        continue;
      }

      if (
        !claim.deliveryId ||
        !claim.claimToken
      ) {
        throw new Error(
          "Digest email delivery claim is missing its delivery ID or claim token."
        );
      }

      const email =
        buildDigestEmail(
          scopedDigest,
          env.MORROW_APP_URL
        );

      const providerResult =
        await sendResendEmail(
          {
            apiKey:
              env.RESEND_API_KEY,
            from:
              env.MORROW_EMAIL_FROM,
            to:
              recipient.email,
            subject:
              email.subject,
            html:
              email.html,
            text:
              email.text,
            idempotencyKey:
              buildDigestEmailIdempotencyKey(
                digest.id,
                recipient.user_id
              ),
          },
          fetcher
        );

      await markDigestEmailDeliverySent(
        env.DB,
        claim.deliveryId,
        claim.claimToken,
        providerResult.id
      );

      result.sent += 1;
    } catch (error) {
      result.failed += 1;

      if (
        claim?.claimed &&
        claim.deliveryId &&
        claim.claimToken
      ) {
        try {
          await markDigestEmailDeliveryFailed(
            env.DB,
            claim.deliveryId,
            claim.claimToken,
            error
          );
        } catch (
          markError
        ) {
          console.error(
            "Morrow could not record digest email delivery failure.",
            {
              digestId,
              userId:
                recipient.user_id,
              deliveryId:
                claim.deliveryId,
              error:
                trimError(
                  markError
                ),
            }
          );
        }
      }

      console.error(
        "Morrow digest email delivery failed.",
        {
          digestId,
          userId:
            recipient.user_id,
          error:
            trimError(
              error
            ),
        }
      );
    }
  }

  return result;
}