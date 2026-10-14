export interface WorkspaceActionResult {
  error?: string;
  checkoutUrl?: string;
}

export const DEFAULT_USER_FACING_ERROR_MESSAGE =
  "We couldn't save this change. Please try again.";

export const BILLING_UNAVAILABLE_USER_FACING_MESSAGE =
  "Online plan changes are temporarily unavailable right now. Please try again shortly.";

export const BILLING_PROVIDER_CONNECTION_USER_FACING_MESSAGE =
  "We couldn't connect to our billing provider right now. Please try again in a moment.";

const BILLING_CONFIGURATION_PATTERNS: readonly RegExp[] = [
  /Lemon Squeezy payment integration is not configured/i,
  /Lemon Squeezy variant ID is not configured/i,
  /Lemon Squeezy payment configuration is incomplete/i,
  /Lemon Squeezy API configuration is missing/i,
  /Duplicate Lemon Squeezy variant ID/i,
  /must be a positive numeric Lemon Squeezy ID/i,
  /\bLEMONSQUEEZY_[A-Z0-9_]+\b/,
];

const BILLING_PROVIDER_UPSTREAM_PATTERNS: readonly RegExp[] =
  [
    /Lemon Squeezy checkout creation failed/i,
    /Lemon Squeezy checkout response/i,
    /Failed to verify subscription with Lemon Squeezy/i,
    /Lemon Squeezy subscription update failed/i,
    /Lemon Squeezy subscription store ID/i,
    /Invalid Lemon Squeezy subscription response/i,
    /Lemon Squeezy response is missing/i,
    /Lemon Squeezy subscription response is missing/i,
    /Unrecognized Lemon Squeezy subscription status/i,
    /Lemon Squeezy did not confirm/i,
    /Lemon Squeezy subscription could not be upgraded because its status is/i,
    /must point to an official lemonsqueezy\.com domain/i,
    /Checkout URL is missing or invalid/i,
    /Checkout URL must use HTTPS/i,
  ];

const TECHNICAL_OR_REDACTED_ERROR_PATTERNS: readonly RegExp[] =
  [
    /An error occurred in the Server Components render/i,
    /specific message is omitted in production builds/i,
    /digest property is included on this error instance/i,
    /Server Components render/i,
    /Minified React error/i,
    /\bNEXT_REDIRECT\b/i,
    /\bNEXT_NOT_FOUND\b/i,
    /\.env(?:\.[a-z0-9_-]+)?\b/i,
    /\b[A-Z][A-Z0-9_]{2,}_(?:API_KEY|SECRET|TOKEN|URL|ID|DB|DSN|HOST|PORT)\b/,
    /\b(?:SQLITE_[A-Z0-9_]*|D1_[A-Z0-9_]*|SQLITE_ERROR|D1_ERROR|D1_EXEC_ERROR|syntax error|no such table|no such column|UNIQUE constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed|CHECK constraint failed)\b/i,
    /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|AggregateError)\b/i,
    /Cannot read properties of (?:undefined|null)/i,
    /\bis not a function\b/i,
    /\bis not defined\b/i,
    /\b(?:Failed to fetch|NetworkError|Load failed|fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up)\b/i,
    /\bHTTP\s+[45]\d{2}\b/i,
    /\bstatus code\s+[45]\d{2}\b/i,
    /\bat\s+\S+\s+\([^)]+:\d+:\d+\)/,
  ];

export function isTechnicalOrRedactedErrorMessage(
  message: string,
): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return true;
  }

  for (const pattern of BILLING_CONFIGURATION_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  for (const pattern of BILLING_PROVIDER_UPSTREAM_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  for (const pattern of TECHNICAL_OR_REDACTED_ERROR_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

function extractRawErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const candidateError = (
      error as { error?: unknown; message?: unknown }
    ).error;
    if (typeof candidateError === "string") {
      return candidateError;
    }

    const candidateMessage = (
      error as { message?: unknown }
    ).message;
    if (typeof candidateMessage === "string") {
      return candidateMessage;
    }
  }

  return "";
}

function hasReactErrorDigest(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const digest = (error as { digest?: unknown }).digest;
  return (
    typeof digest === "string" && digest.trim().length > 0
  );
}

function humanizeFieldTerms(message: string): string {
  return message
    .replace(/\bwebhookUrl\b/g, "webhook URL")
    .replace(/\bbotToken\b/g, "bot token")
    .replace(/\bchatId\b/g, "chat ID")
    .replace(/\bapiBaseUrl\b/g, "API URL")
    .replace(/\bdestination url\b/gi, "destination URL")
    .replace(
      /\bmust be a non-empty string\.$/i,
      "is required.",
    );
}

export function toUserFacingErrorMessage(
  error: unknown,
  fallback = DEFAULT_USER_FACING_ERROR_MESSAGE,
): string {
  if (hasReactErrorDigest(error)) {
    return fallback;
  }

  const normalized = extractRawErrorMessage(error)
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return fallback;
  }

  for (const pattern of BILLING_CONFIGURATION_PATTERNS) {
    if (pattern.test(normalized)) {
      return BILLING_UNAVAILABLE_USER_FACING_MESSAGE;
    }
  }

  for (const pattern of BILLING_PROVIDER_UPSTREAM_PATTERNS) {
    if (pattern.test(normalized)) {
      return BILLING_PROVIDER_CONNECTION_USER_FACING_MESSAGE;
    }
  }

  if (
    /Your Lemon Squeezy subscription has expired/i.test(
      normalized,
    )
  ) {
    return "Your subscription has expired. Please start a new checkout to subscribe.";
  }

  if (
    /Lemon Squeezy reported that this subscription has already expired/i.test(
      normalized,
    )
  ) {
    return "This subscription has already expired and cannot be resumed.";
  }

  if (
    /No active Lemon Squeezy subscription is linked to this workspace/i.test(
      normalized,
    )
  ) {
    return "No active paid subscription is linked to this workspace.";
  }

  if (/^Unauthorized\.?$/i.test(normalized)) {
    return "Your session has expired. Please sign in again.";
  }

  if (/\bconfig_json\b/i.test(normalized)) {
    return "Enter valid channel configuration details and try again.";
  }

  for (const pattern of TECHNICAL_OR_REDACTED_ERROR_PATTERNS) {
    if (pattern.test(normalized)) {
      return fallback;
    }
  }

  return humanizeFieldTerms(normalized);
}

export type AuthErrorShape = {
  code?: string;
  status?: number;
  message?: string;
};

export function getAuthErrorMessage(
  error: AuthErrorShape,
  verifying = false,
): string {
  if (
    error.code === "USER_ALREADY_EXISTS" ||
    error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
  ) {
    return "A user with this email already exists.";
  }
  if (error.code === "ACCOUNT_TEMPORARILY_LOCKED") {
    return "Too many incorrect codes. Please try logging in again in 15 minutes.";
  }
  if (error.status === 429) {
    return "Too many requests. Please wait a minute before trying again.";
  }
  if (error.code === "EMAIL_DELIVERY_UNAVAILABLE") {
    return "We couldn't send your code. Please try again shortly.";
  }
  if (error.code?.includes("TOO_MANY_ATTEMPTS")) {
    return "Too many incorrect codes. Request a new code and try again.";
  }
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") {
    return "Your login attempt expired. Go back and enter your password again.";
  }
  if (error.code === "PASSWORD_TOO_SHORT") {
    return "Password must be at least 8 characters.";
  }
  if (error.code === "PASSWORD_TOO_LONG") {
    return "Password must be 128 characters or fewer.";
  }
  if (error.code === "INVALID_EMAIL") {
    return "Please enter a valid email address.";
  }
  if (error.code === "INVALID_EMAIL_OR_PASSWORD") {
    return "Invalid email or password.";
  }
  if (verifying) {
    return "That code is incorrect or has expired. Try again or request a new code.";
  }
  return "We couldn't continue with those details. Please check them and try again.";
}
