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
  ensureWorkspaceSubscription,
  getOwnerAccountTransitionUsage,
  getWorkspaceSubscription,
  listOwnerPeerWorkspaceIds,
  withWorkspaceBillingLock,
  type WorkspaceBillingEventType,
  type WorkspaceSubscriptionView,
} from "./workspace-billing.ts";
import { canManageWorkspaceBilling } from "./workspace-roles.ts";

const LEMONSQUEEZY_API_BASE_URL =
  "https://api.lemonsqueezy.com/v1";
const LOCAL_DEFAULT_APP_URL = "http://localhost:3001";

type D1PreparedStatementLike = ReturnType<
  D1DatabaseLike["prepare"]
>;

export interface LemonSqueezyRuntimeEnv {
  DB: D1DatabaseLike;
  MORROW_APP_URL?: string;
  BETTER_AUTH_URL?: string;
  LEMONSQUEEZY_API_KEY?: string;
  LEMONSQUEEZY_STORE_ID?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  LEMONSQUEEZY_PERSONAL_MONTHLY_VARIANT_ID?: string;
  LEMONSQUEEZY_PERSONAL_ANNUAL_VARIANT_ID?: string;
  LEMONSQUEEZY_STARTER_MONTHLY_VARIANT_ID?: string;
  LEMONSQUEEZY_STARTER_ANNUAL_VARIANT_ID?: string;
  LEMONSQUEEZY_GROWTH_MONTHLY_VARIANT_ID?: string;
  LEMONSQUEEZY_GROWTH_ANNUAL_VARIANT_ID?: string;
  LEMONSQUEEZY_SCALE_MONTHLY_VARIANT_ID?: string;
  LEMONSQUEEZY_SCALE_ANNUAL_VARIANT_ID?: string;
}

export interface LemonSqueezyConfig {
  isConfigured: boolean;
  apiKey: string | null;
  storeId: string | null;
  webhookSecret: string | null;
  appOrigin: string;
  variants: Record<
    BillingPlanId,
    Record<BillingInterval, string | null>
  >;
  variantToPlanMap: Map<
    string,
    {
      planId: BillingPlanId;
      billingInterval: BillingInterval;
    }
  >;
}

export class LemonSqueezyWebhookAuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "LemonSqueezyWebhookAuthError";
  }
}

export class LemonSqueezyWebhookValidationError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "LemonSqueezyWebhookValidationError";
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
  runtimeEnv: Partial<LemonSqueezyRuntimeEnv> | undefined,
  key: keyof Omit<LemonSqueezyRuntimeEnv, "DB">,
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

function normalizeNumericProviderId(
  value: string | null,
  fieldName: string,
): string | null {
  if (!value) {
    return null;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      `${fieldName} must be a positive numeric Lemon Squeezy ID.`,
    );
  }

  return value;
}

function resolveCanonicalAppOrigin(
  runtimeEnv?: Partial<LemonSqueezyRuntimeEnv>,
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

export function resolveLemonSqueezyConfig(
  runtimeEnv?: Partial<LemonSqueezyRuntimeEnv>,
): LemonSqueezyConfig {
  const apiKey = readCleanEnvString(
    runtimeEnv,
    "LEMONSQUEEZY_API_KEY",
  );
  const storeId = normalizeNumericProviderId(
    readCleanEnvString(
      runtimeEnv,
      "LEMONSQUEEZY_STORE_ID",
    ),
    "LEMONSQUEEZY_STORE_ID",
  );
  const rawWebhookSecret = readCleanEnvString(
    runtimeEnv,
    "LEMONSQUEEZY_WEBHOOK_SECRET",
  );
  const webhookSecret =
    rawWebhookSecret && rawWebhookSecret.length >= 16
      ? rawWebhookSecret
      : null;

  const variants: Record<
    BillingPlanId,
    Record<BillingInterval, string | null>
  > = {
    free: {
      monthly: null,
      annual: null,
    },
    personal: {
      monthly: normalizeNumericProviderId(
        readCleanEnvString(
          runtimeEnv,
          "LEMONSQUEEZY_PERSONAL_MONTHLY_VARIANT_ID",
        ),
        "LEMONSQUEEZY_PERSONAL_MONTHLY_VARIANT_ID",
      ),
      annual: normalizeNumericProviderId(
        readCleanEnvString(
          runtimeEnv,
          "LEMONSQUEEZY_PERSONAL_ANNUAL_VARIANT_ID",
        ),
        "LEMONSQUEEZY_PERSONAL_ANNUAL_VARIANT_ID",
      ),
    },
    starter: {
      monthly: normalizeNumericProviderId(
        readCleanEnvString(
          runtimeEnv,
          "LEMONSQUEEZY_STARTER_MONTHLY_VARIANT_ID",
        ),
        "LEMONSQUEEZY_STARTER_MONTHLY_VARIANT_ID",
      ),
      annual: normalizeNumericProviderId(
        readCleanEnvString(
          runtimeEnv,
          "LEMONSQUEEZY_STARTER_ANNUAL_VARIANT_ID",
        ),
        "LEMONSQUEEZY_STARTER_ANNUAL_VARIANT_ID",
      ),
    },
    growth: {
      monthly: normalizeNumericProviderId(
        readCleanEnvString(
          runtimeEnv,
          "LEMONSQUEEZY_GROWTH_MONTHLY_VARIANT_ID",
        ),
        "LEMONSQUEEZY_GROWTH_MONTHLY_VARIANT_ID",
      ),
      annual: normalizeNumericProviderId(
        readCleanEnvString(
          runtimeEnv,
          "LEMONSQUEEZY_GROWTH_ANNUAL_VARIANT_ID",
        ),
        "LEMONSQUEEZY_GROWTH_ANNUAL_VARIANT_ID",
      ),
    },
    scale: {
      monthly: normalizeNumericProviderId(
        readCleanEnvString(
          runtimeEnv,
          "LEMONSQUEEZY_SCALE_MONTHLY_VARIANT_ID",
        ),
        "LEMONSQUEEZY_SCALE_MONTHLY_VARIANT_ID",
      ),
      annual: normalizeNumericProviderId(
        readCleanEnvString(
          runtimeEnv,
          "LEMONSQUEEZY_SCALE_ANNUAL_VARIANT_ID",
        ),
        "LEMONSQUEEZY_SCALE_ANNUAL_VARIANT_ID",
      ),
    },
  };

  const variantToPlanMap = new Map<
    string,
    {
      planId: BillingPlanId;
      billingInterval: BillingInterval;
    }
  >();

  for (const planId of BILLING_PLAN_IDS) {
    for (const billingInterval of BILLING_INTERVALS) {
      const variantId = variants[planId][billingInterval];
      if (!variantId) {
        continue;
      }

      const existing = variantToPlanMap.get(variantId);
      if (existing) {
        throw new Error(
          `Duplicate Lemon Squeezy variant ID (${variantId}) configured for both ${existing.planId}/${existing.billingInterval} and ${planId}/${billingInterval}. Each plan and billing interval must map to a unique variant ID.`,
        );
      }

      variantToPlanMap.set(variantId, {
        planId,
        billingInterval,
      });
    }
  }

  const hasPaidVariants = Boolean(
    variants.growth.monthly &&
      variants.growth.annual &&
      variants.scale.monthly &&
      variants.scale.annual,
  );

  const isConfigured = Boolean(
    apiKey && storeId && webhookSecret && hasPaidVariants,
  );

  return {
    isConfigured,
    apiKey,
    storeId,
    webhookSecret,
    appOrigin: resolveCanonicalAppOrigin(runtimeEnv),
    variants,
    variantToPlanMap,
  };
}

export function getVariantIdForPlan(
  config: LemonSqueezyConfig,
  planId: BillingPlanId,
  billingInterval: BillingInterval,
): string | null {
  return config.variants[planId]?.[billingInterval] ?? null;
}

export function resolvePlanFromVariantId(
  config: LemonSqueezyConfig,
  variantId: unknown,
): {
  planId: BillingPlanId;
  billingInterval: BillingInterval;
} | null {
  if (
    typeof variantId !== "string" &&
    typeof variantId !== "number"
  ) {
    return null;
  }

  const normalized = String(variantId).trim();
  if (!normalized) {
    return null;
  }

  return config.variantToPlanMap.get(normalized) ?? null;
}

export function computeLemonSqueezySignature(
  rawBody: string,
  webhookSecret: string,
): string {
  return createHmac("sha256", webhookSecret)
    .update(rawBody, "utf8")
    .digest("hex");
}

export function verifyLemonSqueezyWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  webhookSecret: string | null | undefined;
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

  const signature = input.signatureHeader?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }

  const expectedHex = computeLemonSqueezySignature(
    input.rawBody,
    secret,
  );
  const expectedBuffer = Buffer.from(expectedHex, "hex");
  const actualBuffer = Buffer.from(
    signature.toLowerCase(),
    "hex",
  );

  if (
    expectedBuffer.length !== 32 ||
    actualBuffer.length !== 32
  ) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function validateLemonSqueezyCheckoutUrl(
  rawUrl: unknown,
): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error(
      "Lemon Squeezy did not return a checkout URL.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      "Lemon Squeezy returned an invalid checkout URL.",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      "Lemon Squeezy checkout URL must use HTTPS.",
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname !== "lemonsqueezy.com" &&
    !hostname.endsWith(".lemonsqueezy.com")
  ) {
    throw new Error(
      "Lemon Squeezy checkout URL must point to an official lemonsqueezy.com domain.",
    );
  }

  return parsed.toString();
}

export function mapLemonSqueezySubscriptionState(input: {
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
    rawStatus === "expired" ||
    rawStatus === "unpaid" ||
    input.eventName === "subscription_expired"
  ) {
    return {
      status: "canceled",
      cancelAtPeriodEnd: false,
      effectivePeriodEnd:
        input.endsAt || now.toISOString(),
    };
  }

  if (rawStatus === "cancelled") {
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
      effectivePeriodEnd:
        input.endsAt || now.toISOString(),
    };
  }

  if (
    rawStatus === "past_due" ||
    rawStatus === "paused" ||
    input.eventName === "subscription_payment_failed"
  ) {
    return {
      status: "past_due",
      cancelAtPeriodEnd: isCancelledFlag,
      effectivePeriodEnd: candidateEndIso,
    };
  }

  if (rawStatus === "on_trial") {
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
      effectivePeriodEnd:
        input.trialEndsAt || candidateEndIso,
    };
  }

  if (rawStatus === "active") {
    if (
      isCancelledFlag &&
      endMs !== null &&
      endMs <= nowMs
    ) {
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
    `Unrecognized Lemon Squeezy subscription status: ${String(input.providerStatus)}`,
  );
}

export interface LemonSqueezyRemoteSubscription {
  id: string;
  storeId: string;
  customerId: string | null;
  orderId: string | null;
  variantId: string;
  providerStatus: string;
  cancelled: boolean;
  renewsAt: string | null;
  endsAt: string | null;
  trialEndsAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  customerPortalUrl: string | null;
  updatePaymentMethodUrl: string | null;
}

function parseLemonSqueezySubscriptionPayload(
  payload: unknown,
): LemonSqueezyRemoteSubscription {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(
      "Invalid Lemon Squeezy subscription response payload.",
    );
  }

  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) {
    throw new Error(
      "Lemon Squeezy response is missing subscription data.",
    );
  }

  const id = String(
    (data as { id?: unknown }).id ?? "",
  ).trim();
  const attributes = (
    data as { attributes?: Record<string, unknown> }
  ).attributes;

  if (!id || !attributes || typeof attributes !== "object") {
    throw new Error(
      "Lemon Squeezy subscription response is missing id or attributes.",
    );
  }

  const urls =
    typeof attributes.urls === "object" &&
    attributes.urls !== null
      ? (attributes.urls as Record<string, unknown>)
      : {};

  const firstItem =
    typeof attributes.first_subscription_item ===
      "object" &&
    attributes.first_subscription_item !== null
      ? (attributes.first_subscription_item as Record<
          string,
          unknown
        >)
      : null;

  const variantId = String(
    attributes.variant_id ?? firstItem?.variant_id ?? "",
  ).trim();

  return {
    id,
    storeId: String(attributes.store_id ?? "").trim(),
    customerId:
      attributes.customer_id !== undefined &&
      attributes.customer_id !== null
        ? String(attributes.customer_id)
        : null,
    orderId:
      attributes.order_id !== undefined &&
      attributes.order_id !== null
        ? String(attributes.order_id)
        : null,
    variantId,
    providerStatus: String(
      attributes.status ?? "",
    ).trim(),
    cancelled: Boolean(attributes.cancelled),
    renewsAt:
      typeof attributes.renews_at === "string"
        ? attributes.renews_at
        : null,
    endsAt:
      typeof attributes.ends_at === "string"
        ? attributes.ends_at
        : null,
    trialEndsAt:
      typeof attributes.trial_ends_at === "string"
        ? attributes.trial_ends_at
        : null,
    createdAt:
      typeof attributes.created_at === "string"
        ? attributes.created_at
        : null,
    updatedAt:
      typeof attributes.updated_at === "string"
        ? attributes.updated_at
        : null,
    customerPortalUrl:
      typeof urls.customer_portal === "string"
        ? urls.customer_portal
        : null,
    updatePaymentMethodUrl:
      typeof urls.update_payment_method === "string"
        ? urls.update_payment_method
        : null,
  };
}

export async function createLemonSqueezyCheckout(
  config: LemonSqueezyConfig,
  input: {
    workspaceId: string;
    actorUserId: string;
    actorEmail?: string | null;
    actorName?: string | null;
    checkoutSessionId: string;
    targetPlanId: BillingPlanId;
    billingInterval: BillingInterval;
    variantId: string;
    expiresAtIso: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<{
  providerCheckoutId: string;
  checkoutUrl: string;
}> {
  if (!config.apiKey || !config.storeId) {
    throw new Error(
      "Lemon Squeezy payment configuration is incomplete. Set LEMONSQUEEZY_API_KEY and LEMONSQUEEZY_STORE_ID in .env.local.",
    );
  }

  const redirectUrl = `${config.appOrigin}/dashboard/billing?checkout=completed`;
  const receiptLinkUrl = `${config.appOrigin}/dashboard/billing`;

  const requestBody = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          ...(input.actorEmail
            ? { email: input.actorEmail }
            : {}),
          ...(input.actorName
            ? { name: input.actorName }
            : {}),
          custom: {
            workspace_id: input.workspaceId,
            actor_user_id: input.actorUserId,
            checkout_session_id: input.checkoutSessionId,
            target_plan_id: input.targetPlanId,
            billing_interval: input.billingInterval,
          },
        },
        checkout_options: {
          embed: false,
          media: false,
          logo: true,
        },
        product_options: {
          redirect_url: redirectUrl,
          receipt_button_text: "Return to Morrow Billing",
          receipt_link_url: receiptLinkUrl,
        },
        expires_at: input.expiresAtIso,
      },
      relationships: {
        store: {
          data: {
            type: "stores",
            id: config.storeId,
          },
        },
        variant: {
          data: {
            type: "variants",
            id: input.variantId,
          },
        },
      },
    },
  };

  const response = await fetcher(
    `${LEMONSQUEEZY_API_BASE_URL}/checkouts`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    },
  );

  const payload = (await response
    .json()
    .catch(() => null)) as {
    data?: {
      id?: unknown;
      attributes?: { url?: unknown };
    };
    errors?: Array<{ detail?: string; title?: string }>;
  } | null;

  if (!response.ok) {
    const providerDetail =
      payload?.errors?.[0]?.detail ||
      payload?.errors?.[0]?.title ||
      `HTTP ${response.status}`;
    throw new Error(
      `Lemon Squeezy checkout creation failed: ${providerDetail}`,
    );
  }

  const providerCheckoutId = String(
    payload?.data?.id ?? "",
  ).trim();
  if (!providerCheckoutId) {
    throw new Error(
      "Lemon Squeezy checkout response did not include a checkout ID.",
    );
  }

  const checkoutUrl = validateLemonSqueezyCheckoutUrl(
    payload?.data?.attributes?.url,
  );

  return {
    providerCheckoutId,
    checkoutUrl,
  };
}

export async function getLemonSqueezySubscription(
  config: LemonSqueezyConfig,
  subscriptionId: string,
  fetcher: typeof fetch = fetch,
): Promise<LemonSqueezyRemoteSubscription> {
  if (!config.apiKey || !config.storeId) {
    throw new Error(
      "Lemon Squeezy API configuration is missing.",
    );
  }

  const normalizedId = normalizeNumericProviderId(
    subscriptionId.trim(),
    "subscriptionId",
  );
  if (!normalizedId) {
    throw new Error("Subscription ID is required.");
  }

  const response = await fetcher(
    `${LEMONSQUEEZY_API_BASE_URL}/subscriptions/${encodeURIComponent(normalizedId)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/vnd.api+json",
        Authorization: `Bearer ${config.apiKey}`,
      },
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const providerDetail =
      (
        payload as {
          errors?: Array<{
            detail?: string;
            title?: string;
          }>;
        } | null
      )?.errors?.[0]?.detail || `HTTP ${response.status}`;
    throw new Error(
      `Failed to verify subscription with Lemon Squeezy: ${providerDetail}`,
    );
  }

  const remote =
    parseLemonSqueezySubscriptionPayload(payload);
  if (remote.storeId !== config.storeId) {
    throw new Error(
      "Lemon Squeezy subscription store ID does not match the configured store.",
    );
  }

  return remote;
}

export async function updateLemonSqueezySubscription(
  config: LemonSqueezyConfig,
  input: {
    subscriptionId: string;
    variantId?: string;
    cancelled?: boolean;
    invoiceImmediately?: boolean;
  },
  fetcher: typeof fetch = fetch,
): Promise<LemonSqueezyRemoteSubscription> {
  if (!config.apiKey || !config.storeId) {
    throw new Error(
      "Lemon Squeezy API configuration is missing.",
    );
  }

  const normalizedId = normalizeNumericProviderId(
    input.subscriptionId.trim(),
    "subscriptionId",
  );
  if (!normalizedId) {
    throw new Error("Subscription ID is required.");
  }

  const attributes: Record<string, unknown> = {};
  if (input.variantId !== undefined) {
    const normalizedVariant = normalizeNumericProviderId(
      input.variantId.trim(),
      "variantId",
    );
    if (!normalizedVariant) {
      throw new Error("Valid variant ID is required.");
    }
    attributes.variant_id = Number(normalizedVariant);
    if (input.invoiceImmediately) {
      attributes.invoice_immediately = true;
    }
  }

  if (input.cancelled !== undefined) {
    attributes.cancelled = input.cancelled;
  }

  const response = await fetcher(
    `${LEMONSQUEEZY_API_BASE_URL}/subscriptions/${encodeURIComponent(normalizedId)}`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        data: {
          type: "subscriptions",
          id: normalizedId,
          attributes,
        },
      }),
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const providerDetail =
      (
        payload as {
          errors?: Array<{
            detail?: string;
            title?: string;
          }>;
        } | null
      )?.errors?.[0]?.detail || `HTTP ${response.status}`;
    throw new Error(
      `Lemon Squeezy subscription update failed: ${providerDetail}`,
    );
  }

  const remote =
    parseLemonSqueezySubscriptionPayload(payload);
  if (remote.storeId !== config.storeId) {
    throw new Error(
      "Lemon Squeezy subscription store ID does not match the configured store.",
    );
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
  runtimeEnv: LemonSqueezyRuntimeEnv,
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

  const config = resolveLemonSqueezyConfig(runtimeEnv);
  if (
    targetPlanId !== "free" &&
    (!config.apiKey || !config.storeId)
  ) {
    throw new Error(
      "Lemon Squeezy payment integration is not configured yet. Replace the placeholder LEMONSQUEEZY_* values in .env.local to enable live checkouts and plan changes.",
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

      const transitionUsage =
        await getOwnerAccountTransitionUsage(
          db,
          workspaceId,
          {
            retentionDays:
              targetPlan.limits.historyRetentionDays,
          },
        );
      const peerWorkspaceIds = await listOwnerPeerWorkspaceIds(
        db,
        workspaceId,
      );
      const peerPlaceholders = peerWorkspaceIds
        .map(() => "?")
        .join(", ");

      const fasterPagesCount =
        await countPagesFasterThanInterval(
          db,
          workspaceId,
          targetPlan.limits.minFrequencyMinutes,
        );

      const evaluation = evaluatePlanTransition({
        currentPlanId: currentEntitlements.effectivePlanId,
        targetPlanId,
        usage: transitionUsage,
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
          if (!config.apiKey || !config.storeId) {
            throw new Error(
              "Lemon Squeezy payment integration is not configured yet. Replace the placeholder LEMONSQUEEZY_* values in .env.local.",
            );
          }

          const remoteUpdated =
            await updateLemonSqueezySubscription(
              config,
              {
                subscriptionId:
                  currentSubscription.providerSubscriptionId!,
                cancelled: true,
              },
              fetcher,
            );

          const mappedState =
            mapLemonSqueezySubscriptionState({
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

      const targetVariantId = getVariantIdForPlan(
        config,
        targetPlanId,
        nextBillingInterval,
      );

      if (!targetVariantId) {
        throw new Error(
          `Lemon Squeezy variant ID is not configured for the ${targetPlan.name} (${nextBillingInterval}) plan. Set LEMONSQUEEZY_${targetPlanId.toUpperCase()}_${nextBillingInterval.toUpperCase()}_VARIANT_ID in .env.local.`,
        );
      }

      // CASE 1: No active Lemon Squeezy subscription -> MUST go through hosted Lemon Squeezy Checkout.
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
            targetVariantId,
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
          await createLemonSqueezyCheckout(
            config,
            {
              workspaceId,
              actorUserId: input.actorUserId,
              actorEmail: input.actorEmail,
              actorName: input.actorName,
              checkoutSessionId,
              targetPlanId,
              billingInterval: nextBillingInterval,
              variantId: targetVariantId,
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
              config.storeId!,
              targetVariantId,
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
                variantId: targetVariantId,
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

      // CASE 2: Workspace already has an active Lemon Squeezy subscription.
      // Verify remote subscription state and update via Lemon Squeezy Subscriptions API.
      const providerSubscriptionId =
        currentSubscription.providerSubscriptionId!;

      const remoteBefore =
        await getLemonSqueezySubscription(
          config,
          providerSubscriptionId,
          fetcher,
        );

      const remoteBeforeMapped =
        mapLemonSqueezySubscriptionState({
          providerStatus: remoteBefore.providerStatus,
          cancelledFlag: remoteBefore.cancelled,
          endsAt: remoteBefore.endsAt,
          renewsAt: remoteBefore.renewsAt,
          trialEndsAt: remoteBefore.trialEndsAt,
        });

      if (remoteBeforeMapped.status === "canceled") {
        throw new Error(
          "Your Lemon Squeezy subscription has expired. Please start a new checkout to subscribe.",
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

      const remoteUpdated =
        await updateLemonSqueezySubscription(
          config,
          {
            subscriptionId: providerSubscriptionId,
            variantId: targetVariantId,
            cancelled: false,
            invoiceImmediately:
              evaluation.direction === "upgrade",
          },
          fetcher,
        );

      const resolvedPlanFromRemote =
        resolvePlanFromVariantId(
          config,
          remoteUpdated.variantId,
        );
      if (
        !resolvedPlanFromRemote ||
        resolvedPlanFromRemote.planId !== targetPlanId ||
        resolvedPlanFromRemote.billingInterval !==
          nextBillingInterval
      ) {
        throw new Error(
          "Lemon Squeezy did not confirm the requested plan variant change.",
        );
      }

      const remoteAfterMapped =
        mapLemonSqueezySubscriptionState({
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
          `Lemon Squeezy subscription could not be upgraded because its status is ${remoteUpdated.providerStatus}.`,
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
            remoteUpdated.variantId,
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
              providerVariantId: remoteUpdated.variantId,
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

export async function updateWorkspaceSubscriptionCancellationWithLemonSqueezy(
  runtimeEnv: LemonSqueezyRuntimeEnv,
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

  const config = resolveLemonSqueezyConfig(runtimeEnv);
  if (!config.apiKey || !config.storeId) {
    throw new Error(
      "Lemon Squeezy payment integration is not configured yet. Replace the placeholder LEMONSQUEEZY_* values in .env.local.",
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
          "No active Lemon Squeezy subscription is linked to this workspace.",
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
        await updateLemonSqueezySubscription(
          config,
          {
            subscriptionId:
              currentSubscription.providerSubscriptionId,
            cancelled: input.cancelAtPeriodEnd,
          },
          fetcher,
        );

      const mappedState = mapLemonSqueezySubscriptionState({
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
          "Lemon Squeezy reported that this subscription has already expired and cannot be resumed.",
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

export interface LemonSqueezyWebhookResult {
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
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
  "subscription_payment_success",
  "subscription_payment_failed",
  "subscription_payment_recovered",
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

export async function processLemonSqueezyWebhook(
  runtimeEnv: LemonSqueezyRuntimeEnv,
  input: {
    rawBody: string;
    signatureHeader: string | null | undefined;
    referenceDate?: Date;
  },
): Promise<LemonSqueezyWebhookResult> {
  const config = resolveLemonSqueezyConfig(runtimeEnv);

  if (!config.webhookSecret || !config.storeId) {
    throw new LemonSqueezyWebhookAuthError(
      "Lemon Squeezy webhook secret or store ID is not configured.",
    );
  }

  const isSignatureValid =
    verifyLemonSqueezyWebhookSignature({
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
      webhookSecret: config.webhookSecret,
    });

  if (!isSignatureValid) {
    throw new LemonSqueezyWebhookAuthError(
      "Invalid Lemon Squeezy webhook signature.",
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.rawBody);
  } catch {
    throw new LemonSqueezyWebhookValidationError(
      "Webhook request body is not valid JSON.",
      400,
    );
  }

  if (
    typeof parsedBody !== "object" ||
    parsedBody === null
  ) {
    throw new LemonSqueezyWebhookValidationError(
      "Webhook payload must be a JSON object.",
      400,
    );
  }

  const meta = (
    parsedBody as {
      meta?: {
        event_name?: unknown;
        custom_data?: Record<string, unknown>;
      };
    }
  ).meta;
  const eventName =
    typeof meta?.event_name === "string"
      ? meta.event_name.trim()
      : "";

  if (!eventName) {
    throw new LemonSqueezyWebhookValidationError(
      "Webhook payload is missing meta.event_name.",
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

  const data = (
    parsedBody as {
      data?: {
        id?: unknown;
        type?: unknown;
        attributes?: Record<string, unknown>;
      };
    }
  ).data;

  const attributes = data?.attributes;
  if (!data || !attributes || typeof attributes !== "object") {
    throw new LemonSqueezyWebhookValidationError(
      "Webhook payload is missing data.attributes.",
      400,
    );
  }

  // For subscription_payment_* events, Lemon Squeezy sends a `subscription-invoices` resource
  // containing `subscription_id` in attributes, or for `subscription_*` events it sends `subscriptions`.
  const dataType = String(data.type ?? "").trim();
  const providerSubscriptionId =
    dataType === "subscription-invoices"
      ? String(attributes.subscription_id ?? "").trim()
      : String(data.id ?? "").trim();

  if (
    !providerSubscriptionId ||
    !/^[1-9]\d*$/.test(providerSubscriptionId)
  ) {
    throw new LemonSqueezyWebhookValidationError(
      "Webhook payload is missing a valid numeric subscription ID.",
      400,
    );
  }

  const storeId = String(attributes.store_id ?? "").trim();
  if (storeId !== config.storeId) {
    throw new LemonSqueezyWebhookValidationError(
      "Webhook store_id does not match the configured Lemon Squeezy store.",
      400,
    );
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
      throw new LemonSqueezyWebhookValidationError(
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
    const customData =
      typeof meta?.custom_data === "object" &&
      meta.custom_data !== null
        ? meta.custom_data
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
        throw new LemonSqueezyWebhookValidationError(
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
        throw new LemonSqueezyWebhookValidationError(
          "Referenced checkout_session_id does not exist.",
          400,
        );
      }

      if (
        customWorkspaceId &&
        checkoutSessionRow.workspace_id !==
          customWorkspaceId
      ) {
        throw new LemonSqueezyWebhookValidationError(
          "Webhook custom_data.workspace_id does not match the server checkout session.",
          400,
        );
      }

      if (
        checkoutSessionRow.provider_store_id !==
        config.storeId
      ) {
        throw new LemonSqueezyWebhookValidationError(
          "Checkout session store ID mismatch.",
          400,
        );
      }
    }

    const workspaceId =
      boundRow?.workspace_id ||
      checkoutSessionRow?.workspace_id ||
      customWorkspaceId;

    if (!workspaceId) {
      throw new LemonSqueezyWebhookValidationError(
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
      throw new LemonSqueezyWebhookValidationError(
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
        attributes.updated_at,
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
    const incomingUpdatedAt =
      typeof attributes.updated_at === "string"
        ? attributes.updated_at.trim()
        : null;
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

    // Resolve plan & billing interval strictly from `variant_id` (or existing subscription for invoice events).
    // NEVER trust custom_data.target_plan_id to grant entitlements!
    const firstItem =
      typeof attributes.first_subscription_item ===
        "object" &&
      attributes.first_subscription_item !== null
        ? (attributes.first_subscription_item as Record<
            string,
            unknown
          >)
        : null;
    const rawVariantId = String(
      attributes.variant_id ??
        firstItem?.variant_id ??
        currentSubscription.providerVariantId ??
        "",
    ).trim();

    const resolvedVariantPlan = resolvePlanFromVariantId(
      config,
      rawVariantId,
    );

    if (!resolvedVariantPlan) {
      throw new LemonSqueezyWebhookValidationError(
        `Unrecognized Lemon Squeezy variant_id (${rawVariantId}). Verify LEMONSQUEEZY_*_VARIANT_ID settings.`,
        400,
      );
    }

    const providerStatus = String(
      attributes.status ?? "active",
    ).trim();

    // For subscription-invoices (`subscription_payment_success` / `subscription_payment_failed`),
    // `attributes.status` is the invoice status (`paid`, `pending`, `void`, `refunded`).
    const mappedState =
      dataType === "subscription-invoices"
        ? (() => {
            if (
              eventName ===
                "subscription_payment_failed" ||
              providerStatus === "void" ||
              providerStatus === "pending"
            ) {
              return {
                status:
                  "past_due" as BillingSubscriptionStatus,
                cancelAtPeriodEnd:
                  currentSubscription.cancelAtPeriodEnd,
                effectivePeriodEnd:
                  currentSubscription.currentPeriodEnd,
              };
            }
            return {
              status:
                "active" as BillingSubscriptionStatus,
              cancelAtPeriodEnd:
                currentSubscription.cancelAtPeriodEnd,
              effectivePeriodEnd:
                currentSubscription.currentPeriodEnd,
            };
          })()
        : mapLemonSqueezySubscriptionState({
            providerStatus,
            cancelledFlag: attributes.cancelled,
            endsAt:
              typeof attributes.ends_at === "string"
                ? attributes.ends_at
                : null,
            renewsAt:
              typeof attributes.renews_at === "string"
                ? attributes.renews_at
                : null,
            trialEndsAt:
              typeof attributes.trial_ends_at === "string"
                ? attributes.trial_ends_at
                : null,
            eventName,
            referenceDate: input.referenceDate,
          });

    // When a subscription expires or is canceled immediately, reset stored plan_id to 'free'
    // so dormant paid plan IDs can never be reactivated without payment.
    const nextPlanId: BillingPlanId =
      mappedState.status === "canceled"
        ? "free"
        : resolvedVariantPlan.planId;
    const nextBillingInterval: BillingInterval =
      resolvedVariantPlan.billingInterval;

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

    const urls =
      typeof attributes.urls === "object" &&
      attributes.urls !== null
        ? (attributes.urls as Record<string, unknown>)
        : {};
    const customerPortalUrl =
      typeof urls.customer_portal === "string"
        ? urls.customer_portal
        : null;
    const updatePaymentUrl =
      typeof urls.update_payment_method === "string"
        ? urls.update_payment_method
        : null;
    const customerId =
      attributes.customer_id !== undefined &&
      attributes.customer_id !== null
        ? String(attributes.customer_id)
        : null;
    const orderId =
      attributes.order_id !== undefined &&
      attributes.order_id !== null
        ? String(attributes.order_id)
        : null;

    const currentRank =
      BILLING_PLAN_CATALOG[currentSubscription.planId]
        .tierRank;
    const nextRank =
      BILLING_PLAN_CATALOG[nextPlanId].tierRank;

    const billingEventType: WorkspaceBillingEventType =
      eventName === "subscription_payment_failed"
        ? "payment_failed"
        : eventName === "subscription_payment_success" ||
            eventName === "subscription_payment_recovered"
          ? "payment_succeeded"
          : mappedState.status === "canceled"
            ? "subscription_canceled"
            : eventName === "subscription_cancelled" ||
                (mappedState.cancelAtPeriodEnd &&
                  !currentSubscription.cancelAtPeriodEnd)
              ? "cancellation_scheduled"
              : eventName === "subscription_resumed"
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
          rawVariantId,
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
            providerVariantId: rawVariantId,
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

export function createLemonSqueezyWebhookHandler(
  runtimeEnv: LemonSqueezyRuntimeEnv,
) {
  return async function POST(
    request: Request,
  ): Promise<Response> {
    try {
      const rawBody = await request.text();
      const signatureHeader =
        request.headers.get("X-Signature") ??
        request.headers.get("x-signature");

      const result = await processLemonSqueezyWebhook(
        runtimeEnv,
        {
          rawBody,
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
      if (error instanceof LemonSqueezyWebhookAuthError) {
        return Response.json(
          {
            ok: false,
            error: error.message,
          },
          { status: error.statusCode },
        );
      }

      if (
        error instanceof LemonSqueezyWebhookValidationError
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
            "Failed to process Lemon Squeezy webhook.",
        },
        { status: 500 },
      );
    }
  };
}
