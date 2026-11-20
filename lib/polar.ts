import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  BILLING_INTERVALS,
  BILLING_PLAN_CATALOG,
  BILLING_PLAN_IDS,
  evaluatePlanTransition,
  getBillingPlanDefinition,
  isBillingInterval,
  isBillingPlanId,
  parseBillingTimestampMs,
  resolveWorkspaceEntitlements,
  type BillingInterval,
  type BillingPlanId,
  type BillingSubscriptionStatus,
  type WorkspaceEntitlements,
} from "./billing-plans.ts";
import type { D1DatabaseLike } from "../worker/external-notifications.ts";
import { getWorkspaceMembershipById } from "./team-workspaces.ts";
import {
  countMaxNonTelegramChannelsAcrossPeers,
  ensureWorkspaceSubscription,
  getOwnerAccountTransitionUsage,
  getWorkspaceSubscription,
  listOwnerPeerWorkspaceIds,
  withWorkspaceBillingLock,
  type WorkspaceBillingEventType,
  type WorkspaceSubscriptionView,
} from "./workspace-billing.ts";
import { canManageWorkspaceBilling } from "./workspace-roles.ts";

const POLAR_PRODUCTION_API_BASE_URL = "https://api.polar.sh/v1";
const POLAR_SANDBOX_API_BASE_URL =
  "https://sandbox-api.polar.sh/v1";
const LOCAL_DEFAULT_APP_URL = "http://localhost:3001";
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

type D1PreparedStatementLike = ReturnType<
  D1DatabaseLike["prepare"]
>;

export interface PolarRuntimeEnv {
  DB: D1DatabaseLike;
  MORROW_APP_URL?: string;
  BETTER_AUTH_URL?: string;
  /** Organization Access Token created in Polar (Settings -> Developers). */
  POLAR_ACCESS_TOKEN?: string;
  /** Polar organization ID (UUID). Used to verify products and webhooks. */
  POLAR_ORGANIZATION_ID?: string;
  /** Webhook endpoint secret configured in Polar. */
  POLAR_WEBHOOK_SECRET?: string;
  /** "production" (default) or "sandbox". */
  POLAR_SERVER?: string;
  /** Optional customer portal URL, e.g. https://polar.sh/<org-slug>/portal */
  POLAR_CUSTOMER_PORTAL_URL?: string;
  POLAR_PERSONAL_MONTHLY_PRODUCT_ID?: string;
  POLAR_PERSONAL_ANNUAL_PRODUCT_ID?: string;
  POLAR_STARTER_MONTHLY_PRODUCT_ID?: string;
  POLAR_STARTER_ANNUAL_PRODUCT_ID?: string;
  POLAR_GROWTH_MONTHLY_PRODUCT_ID?: string;
  POLAR_GROWTH_ANNUAL_PRODUCT_ID?: string;
  POLAR_SCALE_MONTHLY_PRODUCT_ID?: string;
  POLAR_SCALE_ANNUAL_PRODUCT_ID?: string;
}

export interface PolarConfig {
  isConfigured: boolean;
  accessToken: string | null;
  organizationId: string | null;
  webhookSecret: string | null;
  apiBaseUrl: string;
  customerPortalUrl: string | null;
  appOrigin: string;
  products: Record<
    BillingPlanId,
    Record<BillingInterval, string | null>
  >;
  productToPlanMap: Map<
    string,
    {
      planId: BillingPlanId;
      billingInterval: BillingInterval;
    }
  >;
}

export class PolarWebhookAuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "PolarWebhookAuthError";
  }
}

export class PolarWebhookValidationError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "PolarWebhookValidationError";
    this.statusCode = statusCode;
  }
}

export function isPlaceholderEnvValue(
  value: unknown,
): boolean {
  if (typeof value !== "string") {
    return true;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  return (
    /^your[_-]/i.test(trimmed) ||
    /^replace[_-]/i.test(trimmed) ||
    /placeholder/i.test(trimmed) ||
    /^changeme/i.test(trimmed) ||
    /^todo[_-]/i.test(trimmed) ||
    /^<.*>$/.test(trimmed)
  );
}

function readCleanEnvString(
  runtimeEnv: Partial<PolarRuntimeEnv> | undefined,
  key: keyof Omit<PolarRuntimeEnv, "DB">,
): string | null {
  const fromRuntime = runtimeEnv?.[key];
  const fromProcess =
    typeof process !== "undefined" && process.env
      ? process.env[key]
      : undefined;
  const raw =
    typeof fromRuntime === "string" &&
    fromRuntime.trim().length > 0
      ? fromRuntime
      : typeof fromProcess === "string"
        ? fromProcess
        : "";

  const trimmed = raw.trim();
  if (!trimmed || isPlaceholderEnvValue(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Polar identifiers are UUIDs. They are interpolated into API URLs and stored in D1,
 * so only a conservative character set is accepted.
 */
function normalizeProviderId(
  value: string | null,
  fieldName: string,
): string | null {
  if (!value) {
    return null;
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(value)) {
    throw new Error(
      `${fieldName} must be a valid Polar ID (UUID).`,
    );
  }

  return value;
}

function resolveCanonicalAppOrigin(
  runtimeEnv?: Partial<PolarRuntimeEnv>,
): string {
  const candidate =
    readCleanEnvString(runtimeEnv, "MORROW_APP_URL") ||
    readCleanEnvString(runtimeEnv, "BETTER_AUTH_URL") ||
    LOCAL_DEFAULT_APP_URL;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(
      "MORROW_APP_URL must be a valid absolute URL.",
    );
  }

  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:"
  ) {
    throw new Error(
      "MORROW_APP_URL must use HTTP or HTTPS.",
    );
  }

  return parsed.origin;
}

function resolveCustomerPortalUrl(
  runtimeEnv?: Partial<PolarRuntimeEnv>,
): string | null {
  const raw = readCleanEnvString(
    runtimeEnv,
    "POLAR_CUSTOMER_PORTAL_URL",
  );
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol === "https:" &&
      (host === "polar.sh" || host.endsWith(".polar.sh"))
    ) {
      return parsed.toString();
    }
  } catch {
    // fall through
  }

  throw new Error(
    "POLAR_CUSTOMER_PORTAL_URL must be an https URL on a polar.sh domain.",
  );
}

export function resolvePolarConfig(
  runtimeEnv?: Partial<PolarRuntimeEnv>,
): PolarConfig {
  const accessToken = readCleanEnvString(
    runtimeEnv,
    "POLAR_ACCESS_TOKEN",
  );
  const organizationId = normalizeProviderId(
    readCleanEnvString(runtimeEnv, "POLAR_ORGANIZATION_ID"),
    "POLAR_ORGANIZATION_ID",
  );
  const rawWebhookSecret = readCleanEnvString(
    runtimeEnv,
    "POLAR_WEBHOOK_SECRET",
  );
  const webhookSecret =
    rawWebhookSecret && rawWebhookSecret.length >= 16
      ? rawWebhookSecret
      : null;

  const server = (
    readCleanEnvString(runtimeEnv, "POLAR_SERVER") ??
    "production"
  ).toLowerCase();
  if (server !== "production" && server !== "sandbox") {
    throw new Error(
      'POLAR_SERVER must be either "production" or "sandbox".',
    );
  }

  const productIdFor = (
    plan: "PERSONAL" | "STARTER" | "GROWTH" | "SCALE",
    interval: "MONTHLY" | "ANNUAL",
  ): string | null => {
    const key =
      `POLAR_${plan}_${interval}_PRODUCT_ID` as const;
    return normalizeProviderId(
      readCleanEnvString(runtimeEnv, key),
      key,
    );
  };

  const products: Record<
    BillingPlanId,
    Record<BillingInterval, string | null>
  > = {
    free: { monthly: null, annual: null },
    personal: {
      monthly: productIdFor("PERSONAL", "MONTHLY"),
      annual: productIdFor("PERSONAL", "ANNUAL"),
    },
    starter: {
      monthly: productIdFor("STARTER", "MONTHLY"),
      annual: productIdFor("STARTER", "ANNUAL"),
    },
    growth: {
      monthly: productIdFor("GROWTH", "MONTHLY"),
      annual: productIdFor("GROWTH", "ANNUAL"),
    },
    scale: {
      monthly: productIdFor("SCALE", "MONTHLY"),
      annual: productIdFor("SCALE", "ANNUAL"),
    },
  };

  const productToPlanMap = new Map<
    string,
    {
      planId: BillingPlanId;
      billingInterval: BillingInterval;
    }
  >();

  for (const planId of BILLING_PLAN_IDS) {
    for (const billingInterval of BILLING_INTERVALS) {
      const productId = products[planId][billingInterval];
      if (!productId) {
        continue;
      }

      const existing = productToPlanMap.get(productId);
      if (existing) {
        throw new Error(
          `Duplicate Polar product ID (${productId}) configured for both ${existing.planId}/${existing.billingInterval} and ${planId}/${billingInterval}. Each plan and billing interval must map to a unique product ID.`,
        );
      }

      productToPlanMap.set(productId, {
        planId,
        billingInterval,
      });
    }
  }

  const hasPaidProducts = Boolean(
    products.growth.monthly &&
      products.growth.annual &&
      products.scale.monthly &&
      products.scale.annual,
  );

  const isConfigured = Boolean(
    accessToken &&
      organizationId &&
      webhookSecret &&
      hasPaidProducts,
  );

  return {
    isConfigured,
    accessToken,
    organizationId,
    webhookSecret,
    apiBaseUrl:
      server === "sandbox"
        ? POLAR_SANDBOX_API_BASE_URL
        : POLAR_PRODUCTION_API_BASE_URL,
    customerPortalUrl: resolveCustomerPortalUrl(runtimeEnv),
    appOrigin: resolveCanonicalAppOrigin(runtimeEnv),
    products,
    productToPlanMap,
  };
}

export function getProductIdForPlan(
  config: PolarConfig,
  planId: BillingPlanId,
  billingInterval: BillingInterval,
): string | null {
  return config.products[planId]?.[billingInterval] ?? null;
}

export function resolvePlanFromProductId(
  config: PolarConfig,
  productId: unknown,
): {
  planId: BillingPlanId;
  billingInterval: BillingInterval;
} | null {
  if (typeof productId !== "string") {
    return null;
  }

  const normalized = productId.trim();
  if (!normalized) {
    return null;
  }

  return config.productToPlanMap.get(normalized) ?? null;
}

/**
 * Polar webhooks follow the Standard Webhooks specification:
 * signature = base64(HMAC-SHA256(secret, `${webhook-id}.${webhook-timestamp}.${body}`)).
 * Polar uses the UTF-8 bytes of the endpoint secret as the HMAC key.
 * Returns the header form (`v1,<base64>`).
 */
export function computePolarSignature(
  rawBody: string,
  webhookSecret: string,
  webhookId: string,
  webhookTimestamp: string,
): string {
  const digest = createHmac(
    "sha256",
    Buffer.from(webhookSecret, "utf8"),
  )
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`, "utf8")
    .digest("base64");
  return `v1,${digest}`;
}

export function verifyPolarWebhookSignature(input: {
  rawBody: string;
  webhookId: string | null | undefined;
  webhookTimestamp: string | null | undefined;
  signatureHeader: string | null | undefined;
  webhookSecret: string | null | undefined;
  referenceDate?: Date;
}): boolean {
  const secret = input.webhookSecret?.trim() ?? "";
  if (
    !secret ||
    secret.length < 16 ||
    isPlaceholderEnvValue(secret)
  ) {
    return false;
  }

  if (
    typeof input.rawBody !== "string" ||
    input.rawBody.length === 0
  ) {
    return false;
  }

  const webhookId = input.webhookId?.trim() ?? "";
  const webhookTimestamp = input.webhookTimestamp?.trim() ?? "";
  if (!webhookId || !/^\d{1,12}$/.test(webhookTimestamp)) {
    return false;
  }

  const nowSeconds = Math.floor(
    (input.referenceDate ?? new Date()).getTime() / 1000,
  );
  if (
    Math.abs(nowSeconds - Number(webhookTimestamp)) >
    WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const header = input.signatureHeader?.trim() ?? "";
  if (!header) {
    return false;
  }

  const expected = Buffer.from(
    computePolarSignature(
      input.rawBody,
      secret,
      webhookId,
      webhookTimestamp,
    ).slice(3),
    "base64",
  );

  // The header may carry several space-delimited signatures (e.g. `v1,<sig> v1,<sig>`).
  for (const candidate of header.split(/\s+/)) {
    const separator = candidate.indexOf(",");
    if (separator <= 0) {
      continue;
    }
    if (candidate.slice(0, separator) !== "v1") {
      continue;
    }

    const actual = Buffer.from(
      candidate.slice(separator + 1),
      "base64",
    );
    if (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
    ) {
      return true;
    }
  }

  return false;
}

function validatePolarCheckoutUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("Polar did not return a checkout URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Polar returned an invalid checkout URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Polar checkout URL must use HTTPS.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname !== "polar.sh" &&
    !hostname.endsWith(".polar.sh")
  ) {
    throw new Error(
      "Polar checkout URL must point to an official polar.sh domain.",
    );
  }

  return parsed.toString();
}

/**
 * Maps a Polar subscription to Morrow's internal subscription state.
 *
 * Polar statuses: incomplete, incomplete_expired, trialing, active, past_due, canceled, unpaid.
 * A subscription scheduled to cancel keeps `status: "active"` with `cancel_at_period_end: true`
 * until the period ends, when it becomes `canceled` (revoked).
 */
export function mapPolarSubscriptionState(input: {
  providerStatus: unknown;
  cancelledFlag?: unknown;
  endsAt?: string | null;
  renewsAt?: string | null;
  trialEndsAt?: string | null;
  eventName?: string;
  referenceDate?: Date;
}): {
  status: BillingSubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  effectivePeriodEnd: string;
} {
  const now = input.referenceDate ?? new Date();
  const nowMs = now.getTime();
  const rawStatus =
    typeof input.providerStatus === "string"
      ? input.providerStatus.trim().toLowerCase()
      : "";
  const isCancelledFlag = Boolean(input.cancelledFlag);

  const candidateEndIso =
    input.endsAt ||
    input.renewsAt ||
    input.trialEndsAt ||
    new Date(
      nowMs + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
  const endMs = parseBillingTimestampMs(candidateEndIso);

  if (
    rawStatus === "incomplete_expired" ||
    input.eventName === "subscription.revoked"
  ) {
    return {
      status: "canceled",
      cancelAtPeriodEnd: false,
      effectivePeriodEnd: input.endsAt || now.toISOString(),
    };
  }

  if (rawStatus === "canceled") {
    if (endMs !== null && endMs > nowMs) {
      return {
        status: "active",
        cancelAtPeriodEnd: true,
        effectivePeriodEnd: candidateEndIso,
      };
    }

    return {
      status: "canceled",
      cancelAtPeriodEnd: false,
      effectivePeriodEnd: input.endsAt || now.toISOString(),
    };
  }

  if (
    rawStatus === "past_due" ||
    rawStatus === "unpaid" ||
    input.eventName === "subscription.past_due"
  ) {
    return {
      status: "past_due",
      cancelAtPeriodEnd: isCancelledFlag,
      effectivePeriodEnd: candidateEndIso,
    };
  }

  if (rawStatus === "trialing") {
    if (endMs !== null && endMs <= nowMs) {
      return {
        status: "canceled",
        cancelAtPeriodEnd: false,
        effectivePeriodEnd: candidateEndIso,
      };
    }

    return {
      status: "trialing",
      cancelAtPeriodEnd: isCancelledFlag,
      effectivePeriodEnd: input.trialEndsAt || candidateEndIso,
    };
  }

  if (rawStatus === "active") {
    if (isCancelledFlag && endMs !== null && endMs <= nowMs) {
      return {
        status: "canceled",
        cancelAtPeriodEnd: false,
        effectivePeriodEnd: candidateEndIso,
      };
    }

    return {
      status: "active",
      cancelAtPeriodEnd: isCancelledFlag,
      effectivePeriodEnd: candidateEndIso,
    };
  }

  throw new Error(
    `Unrecognized Polar subscription status: ${String(input.providerStatus)}`,
  );
}

export interface PolarRemoteSubscription {
  id: string;
  organizationId: string | null;
  customerId: string | null;
  orderId: string | null;
  productId: string;
  providerStatus: string;
  /** True when the subscription is scheduled to cancel at the end of the period. */
  cancelled: boolean;
  renewsAt: string | null;
  endsAt: string | null;
  trialEndsAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  customerPortalUrl: string | null;
  updatePaymentMethodUrl: string | null;
}

function asIsoString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value
    : null;
}

function readPolarErrorDetail(
  payload: unknown,
  fallback: string,
): string {
  const detail = (payload as { detail?: unknown } | null)
    ?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: unknown } | undefined;
    if (typeof first?.msg === "string" && first.msg.trim()) {
      return first.msg;
    }
  }
  const error = (payload as { error?: unknown } | null)
    ?.error;
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

function parsePolarSubscriptionPayload(
  payload: unknown,
  customerPortalUrl: string | null,
): PolarRemoteSubscription {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(
      "Invalid Polar subscription response payload.",
    );
  }

  const data = payload as Record<string, unknown>;
  const id = String(data.id ?? "").trim();
  if (!id || typeof data.status !== "string") {
    throw new Error(
      "Polar subscription response is missing id or status.",
    );
  }

  const product =
    typeof data.product === "object" && data.product !== null
      ? (data.product as Record<string, unknown>)
      : null;

  const productId = String(
    data.product_id ?? product?.id ?? "",
  ).trim();

  const organizationId =
    typeof product?.organization_id === "string"
      ? product.organization_id
      : null;

  return {
    id,
    organizationId,
    customerId:
      data.customer_id !== undefined &&
      data.customer_id !== null
        ? String(data.customer_id)
        : null,
    orderId: null,
    productId,
    providerStatus: data.status.trim(),
    cancelled: Boolean(data.cancel_at_period_end),
    renewsAt: asIsoString(data.current_period_end),
    endsAt:
      asIsoString(data.ended_at) ?? asIsoString(data.ends_at),
    trialEndsAt: asIsoString(data.trial_end),
    createdAt: asIsoString(data.created_at),
    updatedAt:
      asIsoString(data.modified_at) ??
      asIsoString(data.created_at),
    customerPortalUrl,
    updatePaymentMethodUrl: null,
  };
}

function assertSameOrganization(
  config: PolarConfig,
  remote: PolarRemoteSubscription,
): void {
  if (
    remote.organizationId !== null &&
    config.organizationId !== null &&
    remote.organizationId !== config.organizationId
  ) {
    throw new Error(
      "Polar subscription organization ID does not match the configured organization.",
    );
  }
}

function polarHeaders(
  config: PolarConfig,
  withBody: boolean,
): Record<string, string> {
  return {
    Accept: "application/json",
    ...(withBody
      ? { "Content-Type": "application/json" }
      : {}),
    Authorization: `Bearer ${config.accessToken}`,
  };
}

export async function createPolarCheckout(
  config: PolarConfig,
  input: {
    workspaceId: string;
    actorUserId: string;
    actorEmail?: string | null;
    actorName?: string | null;
    checkoutSessionId: string;
    targetPlanId: BillingPlanId;
    billingInterval: BillingInterval;
    productId: string;
    expiresAtIso: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<{
  providerCheckoutId: string;
  checkoutUrl: string;
}> {
  if (!config.accessToken || !config.organizationId) {
    throw new Error(
      "Polar payment configuration is incomplete. Set POLAR_ACCESS_TOKEN and POLAR_ORGANIZATION_ID in .env.local.",
    );
  }

  const requestBody = {
    products: [input.productId],
    success_url: `${config.appOrigin}/dashboard/billing?checkout=completed`,
    ...(input.actorEmail
      ? { customer_email: input.actorEmail }
      : {}),
    ...(input.actorName
      ? { customer_name: input.actorName }
      : {}),
    // Polar copies checkout metadata onto the resulting subscription,
    // which is how webhooks are linked back to a workspace.
    metadata: {
      workspace_id: input.workspaceId,
      actor_user_id: input.actorUserId,
      checkout_session_id: input.checkoutSessionId,
      target_plan_id: input.targetPlanId,
      billing_interval: input.billingInterval,
    },
  };

  const response = await fetcher(
    `${config.apiBaseUrl}/checkouts/`,
    {
      method: "POST",
      headers: polarHeaders(config, true),
      body: JSON.stringify(requestBody),
    },
  );

  const payload = (await response
    .json()
    .catch(() => null)) as {
    id?: unknown;
    url?: unknown;
  } | null;

  if (!response.ok) {
    throw new Error(
      `Polar checkout creation failed: ${readPolarErrorDetail(payload, `HTTP ${response.status}`)}`,
    );
  }

  const providerCheckoutId = String(payload?.id ?? "").trim();
  if (!providerCheckoutId) {
    throw new Error(
      "Polar checkout response did not include a checkout ID.",
    );
  }

  return {
    providerCheckoutId,
    checkoutUrl: validatePolarCheckoutUrl(payload?.url),
  };
}

export async function getPolarSubscription(
  config: PolarConfig,
  subscriptionId: string,
  fetcher: typeof fetch = fetch,
): Promise<PolarRemoteSubscription> {
  if (!config.accessToken || !config.organizationId) {
    throw new Error("Polar API configuration is missing.");
  }

  const normalizedId = normalizeProviderId(
    subscriptionId.trim(),
    "subscriptionId",
  );
  if (!normalizedId) {
    throw new Error("Subscription ID is required.");
  }

  const response = await fetcher(
    `${config.apiBaseUrl}/subscriptions/${encodeURIComponent(normalizedId)}`,
    {
      method: "GET",
      headers: polarHeaders(config, false),
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Failed to verify subscription with Polar: ${readPolarErrorDetail(payload, `HTTP ${response.status}`)}`,
    );
  }

  const remote = parsePolarSubscriptionPayload(
    payload,
    config.customerPortalUrl,
  );
  assertSameOrganization(config, remote);
  return remote;
}

async function patchPolarSubscription(
  config: PolarConfig,
  subscriptionId: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<PolarRemoteSubscription> {
  const response = await fetcher(
    `${config.apiBaseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "PATCH",
      headers: polarHeaders(config, true),
      body: JSON.stringify(body),
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Polar subscription update failed: ${readPolarErrorDetail(payload, `HTTP ${response.status}`)}`,
    );
  }

  const remote = parsePolarSubscriptionPayload(
    payload,
    config.customerPortalUrl,
  );
  assertSameOrganization(config, remote);
  return remote;
}

/**
 * Polar accepts exactly one kind of change per PATCH, so a product change and a
 * cancellation toggle are sent as separate requests. Resuming (`cancelled: false`) is
 * sent first so the product change is applied to a live subscription.
 */
export async function updatePolarSubscription(
  config: PolarConfig,
  input: {
    subscriptionId: string;
    productId?: string;
    cancelled?: boolean;
    invoiceImmediately?: boolean;
  },
  fetcher: typeof fetch = fetch,
): Promise<PolarRemoteSubscription> {
  if (!config.accessToken || !config.organizationId) {
    throw new Error("Polar API configuration is missing.");
  }

  const normalizedId = normalizeProviderId(
    input.subscriptionId.trim(),
    "subscriptionId",
  );
  if (!normalizedId) {
    throw new Error("Subscription ID is required.");
  }

  let normalizedProduct: string | null = null;
  if (input.productId !== undefined) {
    normalizedProduct = normalizeProviderId(
      input.productId.trim(),
      "productId",
    );
    if (!normalizedProduct) {
      throw new Error("Valid product ID is required.");
    }
  }

  let remote: PolarRemoteSubscription | null = null;

  if (input.cancelled !== undefined) {
    const current = await getPolarSubscription(
      config,
      normalizedId,
      fetcher,
    );
    remote = current;
    if (current.cancelled !== input.cancelled) {
      remote = await patchPolarSubscription(
        config,
        normalizedId,
        { cancel_at_period_end: input.cancelled },
        fetcher,
      );
    }
  }

  if (normalizedProduct !== null) {
    remote = await patchPolarSubscription(
      config,
      normalizedId,
      {
        product_id: normalizedProduct,
        // Upgrades are invoiced right away; downgrades are prorated into a credit.
        proration_behavior: input.invoiceImmediately
          ? "invoice"
          : "prorate",
      },
      fetcher,
    );
  }

  if (!remote) {
    throw new Error("No subscription change was requested.");
  }

  return remote;
}

async function executeBatch(
  db: D1DatabaseLike,
  statements: D1PreparedStatementLike[],
): Promise<void> {
  if (statements.length === 0) {
    return;
  }

  if (typeof db.batch === "function") {
    await db.batch(statements);
    return;
  }

  for (const statement of statements) {
    await statement.run();
  }
}

async function countPagesFasterThanInterval(
  db: D1DatabaseLike,
  workspaceId: string,
  minFrequencyMinutes: number,
): Promise<number> {
  const peerWorkspaceIds = await listOwnerPeerWorkspaceIds(
    db,
    workspaceId,
  );
  const placeholders = peerWorkspaceIds
    .map(() => "?")
    .join(", ");

  const row = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM monitored_pages
        INNER JOIN competitors
          ON competitors.id = monitored_pages.competitor_id
        WHERE competitors.workspace_id IN (${placeholders})
          AND monitored_pages.frequency_minutes < ?
      `,
    )
    .bind(...peerWorkspaceIds, minFrequencyMinutes)
    .first<{ count: number }>();

  return Number(row?.count ?? 0);
}

export type PlanChangeExecutionResult =
  | {
      mode: "checkout_redirect";
      checkoutUrl: string;
      checkoutSessionId: string;
      targetPlanId: BillingPlanId;
      billingInterval: BillingInterval;
    }
  | {
      mode: "updated_in_place";
      subscription: WorkspaceSubscriptionView;
      entitlements: WorkspaceEntitlements;
      direction: "upgrade" | "downgrade" | "same";
      adjustedPageFrequencies: number;
    };

export async function initiateOrUpdateWorkspaceSubscription(
  runtimeEnv: PolarRuntimeEnv,
  input: {
    actorUserId: string;
    actorEmail?: string | null;
    actorName?: string | null;
    workspaceId: string;
    planId: string;
    billingInterval?: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<PlanChangeExecutionResult> {
  const db = runtimeEnv.DB;
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("Workspace ID is required.");
  }

  const normalizedPlanCandidate = input.planId
    .trim()
    .toLowerCase();
  if (!isBillingPlanId(normalizedPlanCandidate)) {
    throw new Error(
      "Choose a valid subscription plan (Free, Personal, Starter, Growth, or Scale).",
    );
  }
  const targetPlanId: BillingPlanId =
    normalizedPlanCandidate;

  const actor = await getWorkspaceMembershipById(
    db,
    input.actorUserId,
    workspaceId,
  );
  if (!actor) {
    throw new Error(
      "Workspace not found or access denied.",
    );
  }

  if (!canManageWorkspaceBilling(actor.role)) {
    throw new Error(
      "Only workspace Owners can manage billing and subscription plans.",
    );
  }

  const config = resolvePolarConfig(runtimeEnv);
  if (
    targetPlanId !== "free" &&
    (!config.accessToken || !config.organizationId)
  ) {
    throw new Error(
      "Polar payment integration is not configured yet. Replace the placeholder POLAR_* values in .env.local to enable live checkouts and plan changes.",
    );
  }

  return withWorkspaceBillingLock(
    db,
    workspaceId,
    async () => {
      const currentSubscription =
        await ensureWorkspaceSubscription(db, {
          workspaceId,
          actorUserId: input.actorUserId,
        });

      const currentEntitlements =
        resolveWorkspaceEntitlements({
          planId: currentSubscription.planId,
          subscriptionStatus: currentSubscription.status,
          billingInterval:
            currentSubscription.billingInterval,
          cancelAtPeriodEnd:
            currentSubscription.cancelAtPeriodEnd,
          currentPeriodEnd:
            currentSubscription.currentPeriodEnd,
        });

      const nextBillingInterval: BillingInterval =
        input.billingInterval !== undefined
          ? (() => {
              const candidate = input.billingInterval
                .trim()
                .toLowerCase();
              if (!isBillingInterval(candidate)) {
                throw new Error(
                  "Choose a valid billing cycle (monthly or annual).",
                );
              }
              return candidate;
            })()
          : currentSubscription.billingInterval;

      const targetPlan =
        getBillingPlanDefinition(targetPlanId);

      const [
        transitionUsage,
        peerWorkspaceIds,
        fasterPagesCount,
        nonTelegramChannels,
      ] = await Promise.all([
        getOwnerAccountTransitionUsage(
          db,
          workspaceId,
          {
            retentionDays:
              targetPlan.limits.historyRetentionDays,
          },
        ),
        listOwnerPeerWorkspaceIds(db, workspaceId),
        countPagesFasterThanInterval(
          db,
          workspaceId,
          targetPlan.limits.minFrequencyMinutes,
        ),
        countMaxNonTelegramChannelsAcrossPeers(
          db,
          workspaceId,
        ),
      ]);
      const peerPlaceholders = peerWorkspaceIds
        .map(() => "?")
        .join(", ");

      const evaluation = evaluatePlanTransition({
        currentPlanId: currentEntitlements.effectivePlanId,
        targetPlanId,
        usage:
          targetPlan.limits.externalChannelsPerWorkspace ===
          0
            ? {
                ...transitionUsage,
                externalChannels: nonTelegramChannels,
              }
            : transitionUsage,
        fasterThanTargetMinFrequencyPages:
          fasterPagesCount,
        pagesWithCssSelectors:
          transitionUsage.pagesWithCssSelectors,
      });

      if (!evaluation.allowed) {
        throw new Error(
          evaluation.blockingReasons.join(" "),
        );
      }

      const hasActiveProviderSubscription = Boolean(
        currentSubscription.providerSubscriptionId &&
          currentEntitlements.subscriptionStatus !==
            "canceled",
      );

      // Switching to the $0 Free plan:
      if (targetPlanId === "free") {
        if (hasActiveProviderSubscription) {
          if (!config.accessToken || !config.organizationId) {
            throw new Error(
              "Polar payment integration is not configured yet. Replace the placeholder POLAR_* values in .env.local.",
            );
          }

          const remoteUpdated =
            await updatePolarSubscription(
              config,
              {
                subscriptionId:
                  currentSubscription.providerSubscriptionId!,
                cancelled: true,
              },
              fetcher,
            );

          const mappedState =
            mapPolarSubscriptionState({
              providerStatus: remoteUpdated.providerStatus,
              cancelledFlag: remoteUpdated.cancelled,
              endsAt: remoteUpdated.endsAt,
              renewsAt: remoteUpdated.renewsAt,
              trialEndsAt: remoteUpdated.trialEndsAt,
            });

          await executeBatch(db, [
            db
              .prepare(
                `
                  UPDATE workspace_subscriptions
                  SET
                    status = ?,
                    cancel_at_period_end = ?,
                    current_period_end = ?,
                    provider_status = ?,
                    provider_customer_portal_url = COALESCE(?, provider_customer_portal_url),
                    provider_update_payment_url = COALESCE(?, provider_update_payment_url),
                    provider_updated_at = COALESCE(?, provider_updated_at),
                    updated_by = ?,
                    updated_at = CURRENT_TIMESTAMP
                  WHERE workspace_id IN (${peerPlaceholders})
                `,
              )
              .bind(
                mappedState.status,
                mappedState.cancelAtPeriodEnd ? 1 : 0,
                mappedState.effectivePeriodEnd,
                remoteUpdated.providerStatus,
                remoteUpdated.customerPortalUrl,
                remoteUpdated.updatePaymentMethodUrl,
                remoteUpdated.updatedAt,
                input.actorUserId,
                ...peerWorkspaceIds,
              ),

            db
              .prepare(
                `
                  INSERT INTO workspace_billing_events (
                    id,
                    workspace_id,
                    actor_user_id,
                    event_type,
                    previous_plan_id,
                    new_plan_id,
                    billing_interval,
                    details_json,
                    created_at
                  )
                  VALUES (
                    ?,
                    ?,
                    ?,
                    'cancellation_scheduled',
                    ?,
                    'free',
                    ?,
                    ?,
                    CURRENT_TIMESTAMP
                  )
                `,
              )
              .bind(
                randomUUID(),
                workspaceId,
                input.actorUserId,
                currentSubscription.planId,
                currentSubscription.billingInterval,
                JSON.stringify({
                  providerSubscriptionId:
                    currentSubscription.providerSubscriptionId,
                  providerStatus:
                    remoteUpdated.providerStatus,
                }),
              ),
          ]);

          const updatedSubscription =
            await getWorkspaceSubscription(db, workspaceId);
          const updatedEntitlements =
            resolveWorkspaceEntitlements({
              planId: updatedSubscription.planId,
              subscriptionStatus:
                updatedSubscription.status,
              billingInterval:
                updatedSubscription.billingInterval,
              cancelAtPeriodEnd:
                updatedSubscription.cancelAtPeriodEnd,
              currentPeriodEnd:
                updatedSubscription.currentPeriodEnd,
            });

          return {
            mode: "updated_in_place",
            subscription: updatedSubscription,
            entitlements: updatedEntitlements,
            direction: "downgrade",
            adjustedPageFrequencies: 0,
          };
        }

        const adjustedSelectorPages =
          evaluation.pagesRequiringSelectorClear ?? 0;

        const freeStatements: D1PreparedStatementLike[] = [
          db
            .prepare(
              `
                UPDATE workspace_subscriptions
                SET
                  plan_id = 'free',
                  status = 'active',
                  cancel_at_period_end = 0,
                  updated_by = ?,
                  updated_at = CURRENT_TIMESTAMP
                WHERE workspace_id IN (${peerPlaceholders})
              `,
            )
            .bind(input.actorUserId, ...peerWorkspaceIds),
          db
            .prepare(
              `
                DELETE FROM external_notification_channels
                WHERE workspace_id IN (${peerPlaceholders})
                  AND channel = 'telegram'
              `,
            )
            .bind(...peerWorkspaceIds),
        ];

        if (
          evaluation.pagesRequiringFrequencyAdjustment > 0
        ) {
          freeStatements.push(
            db
              .prepare(
                `
                  UPDATE monitored_pages
                  SET
                    frequency_minutes = ?,
                    updated_at = CURRENT_TIMESTAMP
                  WHERE competitor_id IN (
                    SELECT id
                    FROM competitors
                    WHERE workspace_id IN (${peerPlaceholders})
                  )
                    AND frequency_minutes < ?
                `,
              )
              .bind(
                targetPlan.limits.minFrequencyMinutes,
                ...peerWorkspaceIds,
                targetPlan.limits.minFrequencyMinutes,
              ),
          );
        }

        if (adjustedSelectorPages > 0) {
          freeStatements.push(
            db
              .prepare(
                `
                  UPDATE monitored_pages
                  SET
                    include_selectors_json = '[]',
                    ignore_selectors_json = '[]',
                    updated_at = CURRENT_TIMESTAMP
                  WHERE competitor_id IN (
                    SELECT id
                    FROM competitors
                    WHERE workspace_id IN (${peerPlaceholders})
                  )
                    AND (
                      (
                        include_selectors_json IS NOT NULL
                        AND TRIM(include_selectors_json) != ''
                        AND TRIM(include_selectors_json) != '[]'
                      )
                      OR (
                        ignore_selectors_json IS NOT NULL
                        AND TRIM(ignore_selectors_json) != ''
                        AND TRIM(ignore_selectors_json) != '[]'
                      )
                    )
                `,
              )
              .bind(...peerWorkspaceIds),
          );
        }

        freeStatements.push(
          db
            .prepare(
              `
                INSERT INTO workspace_billing_events (
                  id,
                  workspace_id,
                  actor_user_id,
                  event_type,
                  previous_plan_id,
                  new_plan_id,
                  billing_interval,
                  details_json,
                  created_at
                )
                VALUES (
                  ?,
                  ?,
                  ?,
                  'plan_downgraded',
                  ?,
                  'free',
                  ?,
                  ?,
                  CURRENT_TIMESTAMP
                )
              `,
            )
            .bind(
              randomUUID(),
              workspaceId,
              input.actorUserId,
              currentSubscription.planId,
              nextBillingInterval,
              JSON.stringify({
                adjustedPageFrequencies:
                  evaluation.pagesRequiringFrequencyAdjustment,
                adjustedSelectorPages,
              }),
            ),
        );

        await executeBatch(db, freeStatements);

        const updatedSubscription =
          await getWorkspaceSubscription(db, workspaceId);
        const updatedEntitlements =
          resolveWorkspaceEntitlements({
            planId: updatedSubscription.planId,
            subscriptionStatus: updatedSubscription.status,
            billingInterval:
              updatedSubscription.billingInterval,
            cancelAtPeriodEnd:
              updatedSubscription.cancelAtPeriodEnd,
            currentPeriodEnd:
              updatedSubscription.currentPeriodEnd,
          });

        return {
          mode: "updated_in_place",
          subscription: updatedSubscription,
          entitlements: updatedEntitlements,
          direction: evaluation.direction,
          adjustedPageFrequencies:
            evaluation.pagesRequiringFrequencyAdjustment,
        };
      }

      const targetProductId = getProductIdForPlan(
        config,
        targetPlanId,
        nextBillingInterval,
      );

      if (!targetProductId) {
        throw new Error(
          `Polar product ID is not configured for the ${targetPlan.name} (${nextBillingInterval}) plan. Set POLAR_${targetPlanId.toUpperCase()}_${nextBillingInterval.toUpperCase()}_PRODUCT_ID in .env.local.`,
        );
      }

      // CASE 1: No active Polar subscription -> MUST go through hosted Polar Checkout.
      // Never upgrade D1 directly without a verified payment!
      if (!hasActiveProviderSubscription) {
        const now = new Date();
        const nowIso = now.toISOString();

        // Check for a reusable pending checkout session created within the last 10 minutes
        // to make rapid retries / double-clicks idempotent.
        const existingPendingSession = await db
          .prepare(
            `
              SELECT
                id,
                checkout_url,
                expires_at
              FROM workspace_checkout_sessions
              WHERE workspace_id = ?
                AND actor_user_id = ?
                AND target_plan_id = ?
                AND billing_interval = ?
                AND provider_variant_id = ?
                AND status = 'pending'
                AND datetime(expires_at) > datetime(?)
                AND datetime(created_at) > datetime(?, '-10 minutes')
              ORDER BY datetime(created_at) DESC
              LIMIT 1
            `,
          )
          .bind(
            workspaceId,
            input.actorUserId,
            targetPlanId,
            nextBillingInterval,
            targetProductId,
            nowIso,
            nowIso,
          )
          .first<{
            id: string;
            checkout_url: string;
            expires_at: string;
          }>();

        if (existingPendingSession) {
          return {
            mode: "checkout_redirect",
            checkoutUrl:
              existingPendingSession.checkout_url,
            checkoutSessionId: existingPendingSession.id,
            targetPlanId,
            billingInterval: nextBillingInterval,
          };
        }

        const checkoutSessionId = randomUUID();
        const expiresAtIso = new Date(
          now.getTime() + 60 * 60 * 1000,
        ).toISOString();

        const createdCheckout =
          await createPolarCheckout(
            config,
            {
              workspaceId,
              actorUserId: input.actorUserId,
              actorEmail: input.actorEmail,
              actorName: input.actorName,
              checkoutSessionId,
              targetPlanId,
              billingInterval: nextBillingInterval,
              productId: targetProductId,
              expiresAtIso,
            },
            fetcher,
          );

        await executeBatch(db, [
          db
            .prepare(
              `
                INSERT INTO workspace_checkout_sessions (
                  id,
                  workspace_id,
                  actor_user_id,
                  target_plan_id,
                  billing_interval,
                  provider_store_id,
                  provider_variant_id,
                  provider_checkout_id,
                  checkout_url,
                  status,
                  expires_at,
                  created_at,
                  updated_at
                )
                VALUES (
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  'pending',
                  ?,
                  CURRENT_TIMESTAMP,
                  CURRENT_TIMESTAMP
                )
              `,
            )
            .bind(
              checkoutSessionId,
              workspaceId,
              input.actorUserId,
              targetPlanId,
              nextBillingInterval,
              config.organizationId!,
              targetProductId,
              createdCheckout.providerCheckoutId,
              createdCheckout.checkoutUrl,
              expiresAtIso,
            ),

          db
            .prepare(
              `
                INSERT INTO workspace_billing_events (
                  id,
                  workspace_id,
                  actor_user_id,
                  event_type,
                  previous_plan_id,
                  new_plan_id,
                  billing_interval,
                  details_json,
                  created_at
                )
                VALUES (
                  ?,
                  ?,
                  ?,
                  'checkout_initiated',
                  ?,
                  ?,
                  ?,
                  ?,
                  CURRENT_TIMESTAMP
                )
              `,
            )
            .bind(
              randomUUID(),
              workspaceId,
              input.actorUserId,
              currentSubscription.planId,
              targetPlanId,
              nextBillingInterval,
              JSON.stringify({
                checkoutSessionId,
                providerCheckoutId:
                  createdCheckout.providerCheckoutId,
                productId: targetProductId,
              }),
            ),
        ]);

        return {
          mode: "checkout_redirect",
          checkoutUrl: createdCheckout.checkoutUrl,
          checkoutSessionId,
          targetPlanId,
          billingInterval: nextBillingInterval,
        };
      }

      // CASE 2: Workspace already has an active Polar subscription.
      // Verify remote subscription state and update via Polar Subscriptions API.
      const providerSubscriptionId =
        currentSubscription.providerSubscriptionId!;

      const remoteBefore =
        await getPolarSubscription(
          config,
          providerSubscriptionId,
          fetcher,
        );

      const remoteBeforeMapped =
        mapPolarSubscriptionState({
          providerStatus: remoteBefore.providerStatus,
          cancelledFlag: remoteBefore.cancelled,
          endsAt: remoteBefore.endsAt,
          renewsAt: remoteBefore.renewsAt,
          trialEndsAt: remoteBefore.trialEndsAt,
        });

      if (remoteBeforeMapped.status === "canceled") {
        throw new Error(
          "Your Polar subscription has expired. Please start a new checkout to subscribe.",
        );
      }

      if (
        remoteBeforeMapped.status === "past_due" &&
        evaluation.direction === "upgrade"
      ) {
        throw new Error(
          "Your subscription has a past-due payment. Please update your payment method before upgrading plans.",
        );
      }

      const isIntervalUpgradeToAnnual =
        currentSubscription.billingInterval === "monthly" &&
        nextBillingInterval === "annual";

      const remoteUpdated =
        await updatePolarSubscription(
          config,
          {
            subscriptionId: providerSubscriptionId,
            productId: targetProductId,
            cancelled: false,
            invoiceImmediately:
              evaluation.direction === "upgrade" ||
              isIntervalUpgradeToAnnual,
          },
          fetcher,
        );

      const resolvedPlanFromRemote =
        resolvePlanFromProductId(
          config,
          remoteUpdated.productId,
        );
      if (
        !resolvedPlanFromRemote ||
        resolvedPlanFromRemote.planId !== targetPlanId ||
        resolvedPlanFromRemote.billingInterval !==
          nextBillingInterval
      ) {
        throw new Error(
          "Polar did not confirm the requested plan product change.",
        );
      }

      const remoteAfterMapped =
        mapPolarSubscriptionState({
          providerStatus: remoteUpdated.providerStatus,
          cancelledFlag: remoteUpdated.cancelled,
          endsAt: remoteUpdated.endsAt,
          renewsAt: remoteUpdated.renewsAt,
          trialEndsAt: remoteUpdated.trialEndsAt,
        });

      if (
        evaluation.direction === "upgrade" &&
        remoteAfterMapped.status !== "active" &&
        remoteAfterMapped.status !== "trialing"
      ) {
        throw new Error(
          `Polar subscription could not be upgraded because its status is ${remoteUpdated.providerStatus}.`,
        );
      }

      const eventType: WorkspaceBillingEventType =
        evaluation.direction === "upgrade"
          ? "plan_upgraded"
          : evaluation.direction === "downgrade"
            ? "plan_downgraded"
            : currentSubscription.cancelAtPeriodEnd
              ? "subscription_reactivated"
              : "billing_interval_changed";

      const adjustedSelectorPages =
        evaluation.pagesRequiringSelectorClear ?? 0;

      const statements: D1PreparedStatementLike[] = [
        db
          .prepare(
            `
              UPDATE workspace_subscriptions
              SET
                plan_id = ?,
                status = ?,
                billing_interval = ?,
                cancel_at_period_end = ?,
                current_period_end = ?,
                provider_customer_id = COALESCE(?, provider_customer_id),
                provider_variant_id = ?,
                provider_order_id = COALESCE(?, provider_order_id),
                provider_status = ?,
                provider_customer_portal_url = COALESCE(?, provider_customer_portal_url),
                provider_update_payment_url = COALESCE(?, provider_update_payment_url),
                provider_updated_at = COALESCE(?, provider_updated_at),
                updated_by = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE workspace_id IN (${peerPlaceholders})
            `,
          )
          .bind(
            resolvedPlanFromRemote.planId,
            remoteAfterMapped.status,
            resolvedPlanFromRemote.billingInterval,
            remoteAfterMapped.cancelAtPeriodEnd ? 1 : 0,
            remoteAfterMapped.effectivePeriodEnd,
            remoteUpdated.customerId,
            remoteUpdated.productId,
            remoteUpdated.orderId,
            remoteUpdated.providerStatus,
            remoteUpdated.customerPortalUrl,
            remoteUpdated.updatePaymentMethodUrl,
            remoteUpdated.updatedAt,
            input.actorUserId,
            ...peerWorkspaceIds,
          ),
      ];

      if (
        evaluation.pagesRequiringFrequencyAdjustment > 0
      ) {
        statements.push(
          db
            .prepare(
              `
                UPDATE monitored_pages
                SET
                  frequency_minutes = ?,
                  updated_at = CURRENT_TIMESTAMP
                WHERE competitor_id IN (
                  SELECT id
                  FROM competitors
                  WHERE workspace_id IN (${peerPlaceholders})
                )
                  AND frequency_minutes < ?
              `,
            )
            .bind(
              targetPlan.limits.minFrequencyMinutes,
              ...peerWorkspaceIds,
              targetPlan.limits.minFrequencyMinutes,
            ),
        );
      }

      if (adjustedSelectorPages > 0) {
        statements.push(
          db
            .prepare(
              `
                UPDATE monitored_pages
                SET
                  include_selectors_json = '[]',
                  ignore_selectors_json = '[]',
                  updated_at = CURRENT_TIMESTAMP
                WHERE competitor_id IN (
                  SELECT id
                  FROM competitors
                  WHERE workspace_id IN (${peerPlaceholders})
                )
                  AND (
                    (
                      include_selectors_json IS NOT NULL
                      AND TRIM(include_selectors_json) != ''
                      AND TRIM(include_selectors_json) != '[]'
                    )
                    OR (
                      ignore_selectors_json IS NOT NULL
                      AND TRIM(ignore_selectors_json) != ''
                      AND TRIM(ignore_selectors_json) != '[]'
                    )
                  )
              `,
            )
            .bind(...peerWorkspaceIds),
        );
      }

      statements.push(
        db
          .prepare(
            `
              INSERT INTO workspace_billing_events (
                id,
                workspace_id,
                actor_user_id,
                event_type,
                previous_plan_id,
                new_plan_id,
                billing_interval,
                details_json,
                created_at
              )
              VALUES (
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                CURRENT_TIMESTAMP
              )
            `,
          )
          .bind(
            randomUUID(),
            workspaceId,
            input.actorUserId,
            eventType,
            currentSubscription.planId,
            resolvedPlanFromRemote.planId,
            resolvedPlanFromRemote.billingInterval,
            JSON.stringify({
              adjustedPageFrequencies:
                evaluation.pagesRequiringFrequencyAdjustment,
              adjustedSelectorPages,
              providerSubscriptionId,
              providerVariantId: remoteUpdated.productId,
            }),
          ),
      );

      await executeBatch(db, statements);

      const updatedSubscription =
        await getWorkspaceSubscription(db, workspaceId);
      const updatedEntitlements =
        resolveWorkspaceEntitlements({
          planId: updatedSubscription.planId,
          subscriptionStatus: updatedSubscription.status,
          billingInterval:
            updatedSubscription.billingInterval,
          cancelAtPeriodEnd:
            updatedSubscription.cancelAtPeriodEnd,
          currentPeriodEnd:
            updatedSubscription.currentPeriodEnd,
        });

      return {
        mode: "updated_in_place",
        subscription: updatedSubscription,
        entitlements: updatedEntitlements,
        direction: evaluation.direction,
        adjustedPageFrequencies:
          evaluation.pagesRequiringFrequencyAdjustment,
      };
    },
  );
}

export async function updateWorkspaceSubscriptionCancellationWithPolar(
  runtimeEnv: PolarRuntimeEnv,
  input: {
    actorUserId: string;
    workspaceId: string;
    cancelAtPeriodEnd: boolean;
  },
  fetcher: typeof fetch = fetch,
): Promise<{
  subscription: WorkspaceSubscriptionView;
  entitlements: WorkspaceEntitlements;
}> {
  const db = runtimeEnv.DB;
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("Workspace ID is required.");
  }

  const actor = await getWorkspaceMembershipById(
    db,
    input.actorUserId,
    workspaceId,
  );
  if (!actor) {
    throw new Error(
      "Workspace not found or access denied.",
    );
  }

  if (!canManageWorkspaceBilling(actor.role)) {
    throw new Error(
      "Only workspace Owners can manage billing and subscription plans.",
    );
  }

  const config = resolvePolarConfig(runtimeEnv);
  if (!config.accessToken || !config.organizationId) {
    throw new Error(
      "Polar payment integration is not configured yet. Replace the placeholder POLAR_* values in .env.local.",
    );
  }

  return withWorkspaceBillingLock(
    db,
    workspaceId,
    async () => {
      const currentSubscription =
        await ensureWorkspaceSubscription(db, {
          workspaceId,
          actorUserId: input.actorUserId,
        });

      if (!currentSubscription.providerSubscriptionId) {
        throw new Error(
          "No active Polar subscription is linked to this workspace.",
        );
      }

      const currentPeriodEndMs = parseBillingTimestampMs(
        currentSubscription.currentPeriodEnd,
      );
      const isExpired =
        currentSubscription.status === "canceled" ||
        (currentPeriodEndMs !== null &&
          currentPeriodEndMs <= Date.now());

      if (!input.cancelAtPeriodEnd && isExpired) {
        throw new Error(
          "This subscription has already expired. Start a new checkout to subscribe again.",
        );
      }

      const remoteUpdated =
        await updatePolarSubscription(
          config,
          {
            subscriptionId:
              currentSubscription.providerSubscriptionId,
            cancelled: input.cancelAtPeriodEnd,
          },
          fetcher,
        );

      const mappedState = mapPolarSubscriptionState({
        providerStatus: remoteUpdated.providerStatus,
        cancelledFlag: remoteUpdated.cancelled,
        endsAt: remoteUpdated.endsAt,
        renewsAt: remoteUpdated.renewsAt,
        trialEndsAt: remoteUpdated.trialEndsAt,
      });

      if (
        !input.cancelAtPeriodEnd &&
        mappedState.status === "canceled"
      ) {
        throw new Error(
          "Polar reported that this subscription has already expired and cannot be resumed.",
        );
      }

      const eventType: WorkspaceBillingEventType =
        mappedState.cancelAtPeriodEnd
          ? "cancellation_scheduled"
          : "subscription_reactivated";

      const peerWorkspaceIds = await listOwnerPeerWorkspaceIds(
        db,
        workspaceId,
      );
      const peerPlaceholders = peerWorkspaceIds
        .map(() => "?")
        .join(", ");

      await executeBatch(db, [
        db
          .prepare(
            `
              UPDATE workspace_subscriptions
              SET
                status = ?,
                cancel_at_period_end = ?,
                current_period_end = ?,
                provider_status = ?,
                provider_customer_portal_url = COALESCE(?, provider_customer_portal_url),
                provider_update_payment_url = COALESCE(?, provider_update_payment_url),
                provider_updated_at = COALESCE(?, provider_updated_at),
                updated_by = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE workspace_id IN (${peerPlaceholders})
            `,
          )
          .bind(
            mappedState.status,
            mappedState.cancelAtPeriodEnd ? 1 : 0,
            mappedState.effectivePeriodEnd,
            remoteUpdated.providerStatus,
            remoteUpdated.customerPortalUrl,
            remoteUpdated.updatePaymentMethodUrl,
            remoteUpdated.updatedAt,
            input.actorUserId,
            ...peerWorkspaceIds,
          ),

        db
          .prepare(
            `
              INSERT INTO workspace_billing_events (
                id,
                workspace_id,
                actor_user_id,
                event_type,
                previous_plan_id,
                new_plan_id,
                billing_interval,
                details_json,
                created_at
              )
              VALUES (
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                CURRENT_TIMESTAMP
              )
            `,
          )
          .bind(
            randomUUID(),
            workspaceId,
            input.actorUserId,
            eventType,
            currentSubscription.planId,
            currentSubscription.planId,
            currentSubscription.billingInterval,
            JSON.stringify({
              providerSubscriptionId:
                currentSubscription.providerSubscriptionId,
              providerStatus: remoteUpdated.providerStatus,
            }),
          ),
      ]);

      const updatedSubscription =
        await getWorkspaceSubscription(db, workspaceId);
      const entitlements = resolveWorkspaceEntitlements({
        planId: updatedSubscription.planId,
        subscriptionStatus: updatedSubscription.status,
        billingInterval:
          updatedSubscription.billingInterval,
        cancelAtPeriodEnd:
          updatedSubscription.cancelAtPeriodEnd,
        currentPeriodEnd:
          updatedSubscription.currentPeriodEnd,
      });

      return {
        subscription: updatedSubscription,
        entitlements,
      };
    },
  );
}

export interface PolarWebhookResult {
  outcome:
    | "processed"
    | "duplicate"
    | "ignored_stale"
    | "ignored_event";
  eventName: string;
  workspaceId: string | null;
  providerSubscriptionId: string | null;
  planId: BillingPlanId | null;
  status: BillingSubscriptionStatus | null;
}

const SUPPORTED_SUBSCRIPTION_WEBHOOK_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
  "subscription.past_due",
]);

function computeWebhookDeliveryKey(
  eventName: string,
  subscriptionId: string,
  payloadSha256: string,
): string {
  return createHash("sha256")
    .update(`${eventName}:${subscriptionId}:${payloadSha256}`)
    .digest("hex");
}

export async function processPolarWebhook(
  runtimeEnv: PolarRuntimeEnv,
  input: {
    rawBody: string;
    webhookId: string | null | undefined;
    webhookTimestamp: string | null | undefined;
    signatureHeader: string | null | undefined;
    referenceDate?: Date;
  },
): Promise<PolarWebhookResult> {
  const config = resolvePolarConfig(runtimeEnv);

  if (!config.webhookSecret || !config.organizationId) {
    throw new PolarWebhookAuthError(
      "Polar webhook secret or organization ID is not configured.",
    );
  }

  const isSignatureValid = verifyPolarWebhookSignature({
    rawBody: input.rawBody,
    webhookId: input.webhookId,
    webhookTimestamp: input.webhookTimestamp,
    signatureHeader: input.signatureHeader,
    webhookSecret: config.webhookSecret,
    referenceDate: input.referenceDate,
  });

  if (!isSignatureValid) {
    throw new PolarWebhookAuthError(
      "Invalid Polar webhook signature.",
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.rawBody);
  } catch {
    throw new PolarWebhookValidationError(
      "Webhook request body is not valid JSON.",
      400,
    );
  }

  if (
    typeof parsedBody !== "object" ||
    parsedBody === null
  ) {
    throw new PolarWebhookValidationError(
      "Webhook payload must be a JSON object.",
      400,
    );
  }

  const eventName =
    typeof (parsedBody as { type?: unknown }).type ===
    "string"
      ? (parsedBody as { type: string }).type.trim()
      : "";

  if (!eventName) {
    throw new PolarWebhookValidationError(
      "Webhook payload is missing type.",
      400,
    );
  }

  if (
    !SUPPORTED_SUBSCRIPTION_WEBHOOK_EVENTS.has(eventName)
  ) {
    return {
      outcome: "ignored_event",
      eventName,
      workspaceId: null,
      providerSubscriptionId: null,
      planId: null,
      status: null,
    };
  }

  const subscriptionData = (
    parsedBody as { data?: unknown }
  ).data;
  if (
    typeof subscriptionData !== "object" ||
    subscriptionData === null
  ) {
    throw new PolarWebhookValidationError(
      "Webhook payload is missing data.",
      400,
    );
  }

  // For subscription.* events `data` is the Polar Subscription object.
  const attributes = subscriptionData as Record<
    string,
    unknown
  >;

  const providerSubscriptionId = String(
    attributes.id ?? "",
  ).trim();

  if (
    !providerSubscriptionId ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(
      providerSubscriptionId,
    )
  ) {
    throw new PolarWebhookValidationError(
      "Webhook payload is missing a valid subscription ID.",
      400,
    );
  }

  const subscriptionProduct =
    typeof attributes.product === "object" &&
    attributes.product !== null
      ? (attributes.product as Record<string, unknown>)
      : null;
  if (
    typeof subscriptionProduct?.organization_id ===
      "string" &&
    subscriptionProduct.organization_id !==
      config.organizationId
  ) {
    throw new PolarWebhookValidationError(
      "Webhook organization ID does not match the configured Polar organization.",
      400,
    );
  }

  // Subscriptions that have not been paid yet carry no entitlements.
  if (
    String(attributes.status ?? "")
      .trim()
      .toLowerCase() === "incomplete"
  ) {
    return {
      outcome: "ignored_event",
      eventName,
      workspaceId: null,
      providerSubscriptionId,
      planId: null,
      status: null,
    };
  }

  const db = runtimeEnv.DB;
  const payloadSha256 = createHash("sha256")
    .update(input.rawBody, "utf8")
    .digest("hex");
  const deliveryKey = computeWebhookDeliveryKey(
    eventName,
    providerSubscriptionId,
    payloadSha256,
  );

  // Atomically claim the webhook delivery to prevent duplicate/replay execution and race conditions.
  const claimResult = await db
    .prepare(
      `
        INSERT INTO billing_webhook_deliveries (
          delivery_key,
          event_name,
          provider_subscription_id,
          status,
          payload_sha256,
          received_at
        )
        VALUES (?, ?, ?, 'processing', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(delivery_key) DO NOTHING
      `,
    )
    .bind(
      deliveryKey,
      eventName,
      providerSubscriptionId,
      payloadSha256,
    )
    .run();

  if (Number(claimResult.meta?.changes ?? 0) === 0) {
    const existingDelivery = await db
      .prepare(
        `
          SELECT status, workspace_id
          FROM billing_webhook_deliveries
          WHERE delivery_key = ?
          LIMIT 1
        `,
      )
      .bind(deliveryKey)
      .first<{
        status: string;
        workspace_id: string | null;
      }>();

    if (
      existingDelivery?.status === "processed" ||
      existingDelivery?.status === "ignored_stale"
    ) {
      return {
        outcome: "duplicate",
        eventName,
        workspaceId: existingDelivery.workspace_id,
        providerSubscriptionId,
        planId: null,
        status: null,
      };
    }

    if (existingDelivery?.status === "processing") {
      throw new PolarWebhookValidationError(
        "Webhook delivery is currently being processed by another worker.",
        409,
      );
    }

    // Allow retrying a previously failed delivery atomically.
    const retryClaim = await db
      .prepare(
        `
          UPDATE billing_webhook_deliveries
          SET
            status = 'processing',
            error_message = NULL,
            received_at = CURRENT_TIMESTAMP
          WHERE delivery_key = ?
            AND status = 'failed'
        `,
      )
      .bind(deliveryKey)
      .run();

    if (Number(retryClaim.meta?.changes ?? 0) !== 1) {
      return {
        outcome: "duplicate",
        eventName,
        workspaceId: existingDelivery?.workspace_id ?? null,
        providerSubscriptionId,
        planId: null,
        status: null,
      };
    }
  }

  try {
    // Polar copies the checkout `metadata` onto the subscription it creates.
    const customData: Record<string, unknown> =
      typeof attributes.metadata === "object" &&
      attributes.metadata !== null
        ? (attributes.metadata as Record<string, unknown>)
        : {};
    const customWorkspaceId =
      typeof customData.workspace_id === "string"
        ? customData.workspace_id.trim()
        : "";
    const customActorUserId =
      typeof customData.actor_user_id === "string"
        ? customData.actor_user_id.trim()
        : null;
    const customCheckoutSessionId =
      typeof customData.checkout_session_id === "string"
        ? customData.checkout_session_id.trim()
        : "";

    // Check if this provider_subscription_id is already bound to a workspace.
    const boundRow = await db
      .prepare(
        `
          SELECT workspace_id
          FROM workspace_subscriptions
          WHERE provider_subscription_id = ?
          LIMIT 1
        `,
      )
      .bind(providerSubscriptionId)
      .first<{ workspace_id: string }>();

    if (
      boundRow &&
      customWorkspaceId &&
      boundRow.workspace_id !== customWorkspaceId
    ) {
      const boundPeerWorkspaceIds =
        await listOwnerPeerWorkspaceIds(
          db,
          boundRow.workspace_id,
        );
      if (
        !boundPeerWorkspaceIds.includes(customWorkspaceId)
      ) {
        throw new PolarWebhookValidationError(
          "Subscription is already bound to a different workspace.",
          409,
        );
      }
    }

    let checkoutSessionRow: {
      id: string;
      workspace_id: string;
      actor_user_id: string;
      provider_store_id: string;
      provider_variant_id: string;
    } | null = null;

    if (customCheckoutSessionId) {
      checkoutSessionRow = await db
        .prepare(
          `
            SELECT
              id,
              workspace_id,
              actor_user_id,
              provider_store_id,
              provider_variant_id
            FROM workspace_checkout_sessions
            WHERE id = ?
              AND status IN ('pending', 'completed')
            LIMIT 1
          `,
        )
        .bind(customCheckoutSessionId)
        .first<{
          id: string;
          workspace_id: string;
          actor_user_id: string;
          provider_store_id: string;
          provider_variant_id: string;
        }>();

      if (!checkoutSessionRow) {
        throw new PolarWebhookValidationError(
          "Referenced checkout_session_id does not exist.",
          400,
        );
      }

      if (
        customWorkspaceId &&
        checkoutSessionRow.workspace_id !==
          customWorkspaceId
      ) {
        throw new PolarWebhookValidationError(
          "Webhook metadata.workspace_id does not match the server checkout session.",
          400,
        );
      }

      if (
        checkoutSessionRow.provider_store_id !==
        config.organizationId
      ) {
        throw new PolarWebhookValidationError(
          "Checkout session organization ID mismatch.",
          400,
        );
      }
    }

    const workspaceId =
      boundRow?.workspace_id ||
      checkoutSessionRow?.workspace_id ||
      customWorkspaceId;

    if (!workspaceId) {
      throw new PolarWebhookValidationError(
        "Webhook could not be linked to a workspace_id.",
        400,
      );
    }

    const workspaceRow = await db
      .prepare(
        `
          SELECT id
          FROM workspaces
          WHERE id = ?
          LIMIT 1
        `,
      )
      .bind(workspaceId)
      .first<{ id: string }>();

    if (!workspaceRow) {
      throw new PolarWebhookValidationError(
        "Target workspace does not exist.",
        404,
      );
    }

    const currentSubscription =
      await ensureWorkspaceSubscription(db, {
        workspaceId,
      });

    // If workspace already has a DIFFERENT active provider_subscription_id, prevent overwriting
    // unless this is a newer subscription or the previous one was canceled.
    if (
      currentSubscription.providerSubscriptionId &&
      currentSubscription.providerSubscriptionId !==
        providerSubscriptionId &&
      currentSubscription.status !== "canceled"
    ) {
      const incomingUpdatedAtMs = parseBillingTimestampMs(
        asIsoString(attributes.modified_at) ??
          asIsoString(attributes.created_at),
      );
      const existingUpdatedAtMs = parseBillingTimestampMs(
        currentSubscription.providerUpdatedAt,
      );

      if (
        existingUpdatedAtMs !== null &&
        incomingUpdatedAtMs !== null &&
        incomingUpdatedAtMs < existingUpdatedAtMs
      ) {
        await db
          .prepare(
            `
              UPDATE billing_webhook_deliveries
              SET
                workspace_id = ?,
                status = 'ignored_stale',
                processed_at = CURRENT_TIMESTAMP
              WHERE delivery_key = ?
            `,
          )
          .bind(workspaceId, deliveryKey)
          .run();

        return {
          outcome: "ignored_stale",
          eventName,
          workspaceId,
          providerSubscriptionId,
          planId: currentSubscription.planId,
          status: currentSubscription.status,
        };
      }
    }

    // Out-of-order race condition guard for the same subscription:
    // If we already processed a webhook with a newer `updated_at` timestamp, ignore this stale event.
    const incomingUpdatedAt = (
      asIsoString(attributes.modified_at) ??
      asIsoString(attributes.created_at)
    )?.trim() ?? null;
    const incomingUpdatedAtMs = parseBillingTimestampMs(
      incomingUpdatedAt,
    );
    const existingUpdatedAtMs = parseBillingTimestampMs(
      currentSubscription.providerUpdatedAt,
    );

    if (
      currentSubscription.providerSubscriptionId ===
        providerSubscriptionId &&
      existingUpdatedAtMs !== null &&
      incomingUpdatedAtMs !== null &&
      incomingUpdatedAtMs < existingUpdatedAtMs
    ) {
      await db
        .prepare(
          `
            UPDATE billing_webhook_deliveries
            SET
              workspace_id = ?,
              status = 'ignored_stale',
              processed_at = CURRENT_TIMESTAMP
            WHERE delivery_key = ?
          `,
        )
        .bind(workspaceId, deliveryKey)
        .run();

      return {
        outcome: "ignored_stale",
        eventName,
        workspaceId,
        providerSubscriptionId,
        planId: currentSubscription.planId,
        status: currentSubscription.status,
      };
    }

    // Resolve plan & billing interval strictly from the Polar `product_id`.
    // NEVER trust metadata.target_plan_id to grant entitlements!
    const rawProductId = String(
      attributes.product_id ??
        subscriptionProduct?.id ??
        currentSubscription.providerVariantId ??
        "",
    ).trim();

    const resolvedProductPlan = resolvePlanFromProductId(
      config,
      rawProductId,
    );

    if (!resolvedProductPlan) {
      throw new PolarWebhookValidationError(
        `Unrecognized Polar product_id (${rawProductId}). Verify POLAR_*_PRODUCT_ID settings.`,
        400,
      );
    }

    const providerStatus = String(
      attributes.status ?? "active",
    ).trim();

    const mappedState = mapPolarSubscriptionState({
      providerStatus,
      cancelledFlag: attributes.cancel_at_period_end,
      endsAt:
        asIsoString(attributes.ended_at) ??
        asIsoString(attributes.ends_at),
      renewsAt: asIsoString(attributes.current_period_end),
      trialEndsAt: asIsoString(attributes.trial_end),
      eventName,
      referenceDate: input.referenceDate,
    });

    // When a subscription expires or is canceled immediately, reset stored plan_id to 'free'
    // so dormant paid plan IDs can never be reactivated without payment.
    const nextPlanId: BillingPlanId =
      mappedState.status === "canceled"
        ? "free"
        : resolvedProductPlan.planId;
    const nextBillingInterval: BillingInterval =
      resolvedProductPlan.billingInterval;

    const effectiveEntitlements =
      resolveWorkspaceEntitlements({
        planId: nextPlanId,
        subscriptionStatus: mappedState.status,
        billingInterval: nextBillingInterval,
        cancelAtPeriodEnd: mappedState.cancelAtPeriodEnd,
        currentPeriodEnd: mappedState.effectivePeriodEnd,
        referenceDate: input.referenceDate,
      });

    const minFreq =
      effectiveEntitlements.limits.minFrequencyMinutes;
    const fasterPagesCount =
      await countPagesFasterThanInterval(
        db,
        workspaceId,
        minFreq,
      );

    const customerPortalUrl = config.customerPortalUrl;
    const updatePaymentUrl: string | null = null;
    const customerId =
      attributes.customer_id !== undefined &&
      attributes.customer_id !== null
        ? String(attributes.customer_id)
        : null;
    const orderId: string | null = null;

    const currentRank =
      BILLING_PLAN_CATALOG[currentSubscription.planId]
        .tierRank;
    const nextRank =
      BILLING_PLAN_CATALOG[nextPlanId].tierRank;

    const billingEventType: WorkspaceBillingEventType =
      eventName === "subscription.past_due" ||
      mappedState.status === "past_due"
        ? "payment_failed"
        : mappedState.status === "canceled"
          ? "subscription_canceled"
          : eventName === "subscription.canceled" ||
              (mappedState.cancelAtPeriodEnd &&
                !currentSubscription.cancelAtPeriodEnd)
            ? "cancellation_scheduled"
            : eventName === "subscription.uncanceled"
              ? "subscription_reactivated"
              : nextRank > currentRank
                ? "plan_upgraded"
                : nextRank < currentRank
                  ? "plan_downgraded"
                  : nextBillingInterval !==
                      currentSubscription.billingInterval
                    ? "billing_interval_changed"
                    : "payment_succeeded";

    const actorUserId =
      checkoutSessionRow?.actor_user_id ||
      customActorUserId ||
      currentSubscription.updatedBy ||
      null;

    const peerWorkspaceIds = await listOwnerPeerWorkspaceIds(
      db,
      workspaceId,
    );
    const peerPlaceholders = peerWorkspaceIds
      .map(() => "?")
      .join(", ");

    const statements: D1PreparedStatementLike[] = [
      db
        .prepare(
          `
            UPDATE workspace_subscriptions
            SET
              plan_id = ?,
              status = ?,
              billing_interval = ?,
              cancel_at_period_end = ?,
              current_period_end = ?,
              provider_customer_id = COALESCE(?, provider_customer_id),
              provider_subscription_id = ?,
              provider_variant_id = ?,
              provider_order_id = COALESCE(?, provider_order_id),
              provider_status = ?,
              provider_customer_portal_url = COALESCE(?, provider_customer_portal_url),
              provider_update_payment_url = COALESCE(?, provider_update_payment_url),
              provider_updated_at = COALESCE(?, provider_updated_at),
              updated_by = COALESCE(?, updated_by),
              updated_at = CURRENT_TIMESTAMP
            WHERE workspace_id IN (${peerPlaceholders})
              AND (
                provider_updated_at IS NULL
                OR ? IS NULL
                OR datetime(?) >= datetime(provider_updated_at)
              )
          `,
        )
        .bind(
          nextPlanId,
          mappedState.status,
          nextBillingInterval,
          mappedState.cancelAtPeriodEnd ? 1 : 0,
          mappedState.effectivePeriodEnd,
          customerId,
          providerSubscriptionId,
          rawProductId,
          orderId,
          providerStatus,
          customerPortalUrl,
          updatePaymentUrl,
          incomingUpdatedAt,
          actorUserId,
          ...peerWorkspaceIds,
          incomingUpdatedAt,
          incomingUpdatedAt,
        ),
    ];

    if (fasterPagesCount > 0) {
      statements.push(
        db
          .prepare(
            `
              UPDATE monitored_pages
              SET
                frequency_minutes = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE competitor_id IN (
                SELECT id
                FROM competitors
                WHERE workspace_id IN (${peerPlaceholders})
              )
                AND frequency_minutes < ?
            `,
          )
          .bind(minFreq, ...peerWorkspaceIds, minFreq),
      );
    }

    if (
      !effectiveEntitlements.features.sectionLevelMonitoring
    ) {
      statements.push(
        db
          .prepare(
            `
              UPDATE monitored_pages
              SET
                include_selectors_json = '[]',
                ignore_selectors_json = '[]',
                updated_at = CURRENT_TIMESTAMP
              WHERE competitor_id IN (
                SELECT id
                FROM competitors
                WHERE workspace_id IN (${peerPlaceholders})
              )
                AND (
                  (
                    include_selectors_json IS NOT NULL
                    AND TRIM(include_selectors_json) != ''
                    AND TRIM(include_selectors_json) != '[]'
                  )
                  OR (
                    ignore_selectors_json IS NOT NULL
                    AND TRIM(ignore_selectors_json) != ''
                    AND TRIM(ignore_selectors_json) != '[]'
                  )
                )
            `,
          )
          .bind(...peerWorkspaceIds),
      );
    }

    // Only revoke Telegram channels when the subscription period has ended or effective plan does not accommodate Telegram use
    if (
      effectiveEntitlements.limits
        .externalChannelsPerWorkspace === 0
    ) {
      statements.push(
        db
          .prepare(
            `
              DELETE FROM external_notification_channels
              WHERE workspace_id IN (${peerPlaceholders})
                AND channel = 'telegram'
            `,
          )
          .bind(...peerWorkspaceIds),
      );
    }

    if (checkoutSessionRow) {
      statements.push(
        db
          .prepare(
            `
              UPDATE workspace_checkout_sessions
              SET
                status = 'completed',
                completed_subscription_id = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `,
          )
          .bind(
            providerSubscriptionId,
            checkoutSessionRow.id,
          ),
      );
    }

    statements.push(
      db
        .prepare(
          `
            INSERT INTO workspace_billing_events (
              id,
              workspace_id,
              actor_user_id,
              event_type,
              previous_plan_id,
              new_plan_id,
              billing_interval,
              details_json,
              created_at
            )
            VALUES (
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              CURRENT_TIMESTAMP
            )
          `,
        )
        .bind(
          randomUUID(),
          workspaceId,
          actorUserId,
          billingEventType,
          currentSubscription.planId,
          nextPlanId,
          nextBillingInterval,
          JSON.stringify({
            webhookEventName: eventName,
            providerSubscriptionId,
            providerVariantId: rawProductId,
            providerStatus,
            adjustedPageFrequencies: fasterPagesCount,
          }),
        ),
    );

    statements.push(
      db
        .prepare(
          `
            UPDATE billing_webhook_deliveries
            SET
              workspace_id = ?,
              status = 'processed',
              processed_at = CURRENT_TIMESTAMP
            WHERE delivery_key = ?
          `,
        )
        .bind(workspaceId, deliveryKey),
    );

    await executeBatch(db, statements);

    return {
      outcome: "processed",
      eventName,
      workspaceId,
      providerSubscriptionId,
      planId: nextPlanId,
      status: mappedState.status,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Unknown webhook processing error";

    await db
      .prepare(
        `
          UPDATE billing_webhook_deliveries
          SET
            status = 'failed',
            error_message = ?,
            processed_at = CURRENT_TIMESTAMP
          WHERE delivery_key = ?
        `,
      )
      .bind(errorMessage, deliveryKey)
      .run()
      .catch(() => undefined);

    throw error;
  }
}

const MAX_POLAR_WEBHOOK_BYTES = 1024 * 1024;

export function createPolarWebhookHandler(
  runtimeEnv: PolarRuntimeEnv,
) {
  return async function POST(
    request: Request,
  ): Promise<Response> {
    try {
      // Bound the body before the signature check so an unauthenticated
      // caller cannot make the Worker buffer an arbitrarily large payload.
      const declaredLength = Number(
        request.headers.get("content-length") ?? 0,
      );
      if (declaredLength > MAX_POLAR_WEBHOOK_BYTES) {
        return Response.json(
          { ok: false, error: "Webhook payload is too large." },
          { status: 413 },
        );
      }
      const rawBody = await request.text();
      if (
        new TextEncoder().encode(rawBody).length >
        MAX_POLAR_WEBHOOK_BYTES
      ) {
        return Response.json(
          { ok: false, error: "Webhook payload is too large." },
          { status: 413 },
        );
      }
      const signatureHeader =
        request.headers.get("webhook-signature");
      const webhookId = request.headers.get("webhook-id");
      const webhookTimestamp = request.headers.get(
        "webhook-timestamp",
      );

      const result = await processPolarWebhook(
        runtimeEnv,
        {
          rawBody,
          webhookId,
          webhookTimestamp,
          signatureHeader,
        },
      );

      return Response.json(
        {
          ok: true,
          ...result,
        },
        { status: 200 },
      );
    } catch (error) {
      if (error instanceof PolarWebhookAuthError) {
        return Response.json(
          {
            ok: false,
            error: error.message,
          },
          { status: error.statusCode },
        );
      }

      if (
        error instanceof PolarWebhookValidationError
      ) {
        return Response.json(
          {
            ok: false,
            error: error.message,
          },
          { status: error.statusCode },
        );
      }

      return Response.json(
        {
          ok: false,
          error:
            "Failed to process Polar webhook.",
        },
        { status: 500 },
      );
    }
  };
}
