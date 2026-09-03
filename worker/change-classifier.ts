export type ChangeCategory =
  | "pricing"
  | "product"
  | "feature"
  | "positioning"
  | "promotion"
  | "policy"
  | "navigation"
  | "content"
  | "other";

export type ChangeSignificance =
  | "minor"
  | "moderate"
  | "major";

export interface ClassifiableDiffPart {
  added: boolean;
  removed: boolean;
  value: string;
}

export interface ChangeClassification {
  category: ChangeCategory;
  significance: ChangeSignificance;
  confidence: number;
  reasons: string[];
  signals: {
    addedLines: number;
    removedLines: number;
    changedLines: number;
    commercialDelta: boolean;
    categoryScores: Record<
      ChangeCategory,
      number
    >;
  };
}

/*
 * Priority is only used when two categories receive
 * the exact same score.
 */
const CATEGORY_PRIORITY: ChangeCategory[] = [
  "pricing",
  "promotion",
  "policy",
  "product",
  "feature",
  "positioning",
  "navigation",
  "content",
  "other",
];

const currencyPattern =
  /(?:[$€£¥₦₹]\s*\d)|(?:\b\d[\d,.]*\s*(?:USD|EUR|GBP|NGN|CAD|AUD|JPY|INR)\b)/i;

const percentagePattern =
  /\b\d+(?:[.,]\d+)?\s*%/i;

const pricingPattern =
  /\b(?:price|prices|pricing|cost|costs|fee|fees|billing|billed|monthly|annually|annual|per month|per year|subscription price|plan price|starting at|pay as you go|transaction fee|transaction fees)\b/i;

const promotionPattern =
  /\b(?:sale|discount|discounted|promotion|promo|offer|special offer|limited time|limited-time|coupon|voucher|save \d|off today|free trial|trial extended|black friday|cyber monday)\b/i;

const policyPattern =
  /\b(?:privacy policy|terms of service|terms and conditions|refund policy|refunds|cancellation policy|cancelation policy|acceptable use|data processing|data retention|security policy|cookie policy|legal terms|compliance|gdpr|ccpa|sla|service level agreement)\b/i;

/*
 * Strong product signals.
 *
 * These represent changes to an actual product,
 * plan, tier, package or platform rather than only
 * marketing language.
 */
const productPattern =
  /\b(?:product|products|plan|plans|tier|tiers|package|packages|edition|editions|workspace|workspaces|platform|platforms|product line)\b/i;

/*
 * Strong feature/capability signals.
 *
 * Explicit capability language should beat generic
 * positioning phrases such as "for enterprise
 * teams".
 */
const featurePattern =
  /\b(?:feature|features|integration|integrations|api|apis|automation|automations|workflow|workflows|dashboard|dashboards|analytics|reporting|reports|export|import|collaboration|sso|scim|authentication|single sign-on|mobile app|mobile apps|webhook|webhooks|ai assistant|ai feature)\b/i;

/*
 * Especially strong phrases indicating that a new
 * capability has been introduced.
 */
const featureLaunchPattern =
  /\b(?:new feature|new integration|new capability|now supports|now includes|introducing|introduced|launched|launching|available now)\b/i;

/*
 * Positioning is intentionally weaker than explicit
 * product/feature evidence.
 *
 * Example:
 *
 * "Built for enterprise finance teams"
 * = positioning
 *
 * "New feature: SSO for enterprise teams"
 * = feature
 */
const positioningPattern =
  /\b(?:built for|designed for|best for|ideal for|made for|leading|all-in-one|everything you need|for startups|for small businesses|for enterprises|for enterprise|for teams|trusted by|why choose|our mission|the easiest way|the fastest way|the modern way)\b/i;

const navigationPattern =
  /\b(?:menu|navigation|sign in|log in|login|contact sales|talk to sales|book a demo|request a demo|documentation|docs|resources|blog|about us|careers|support|help center|pricing page)\b/i;

const contentPattern =
  /\b(?:blog post|article|guide|tutorial|case study|customer story|webinar|whitepaper|white paper|ebook|e-book|documentation article|learn more|resource center|changelog|release notes)\b/i;

function normalizeText(
  text: string
) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getChangedLines(
  parts: ClassifiableDiffPart[]
) {
  const added: string[] = [];
  const removed: string[] = [];

  for (const part of parts) {
    const lines = part.value
      .split("\n")
      .map(normalizeText)
      .filter(Boolean);

    if (part.added) {
      added.push(...lines);
    }

    if (part.removed) {
      removed.push(...lines);
    }
  }

  return {
    added,
    removed,
  };
}

function extractCommercialTokens(
  text: string
) {
  const tokens =
    new Set<string>();

  const currencyMatches =
    text.match(
      /[$€£¥₦₹]\s*\d[\d,.]*(?:\s*(?:\/\s*)?(?:month|year|mo|yr))?/gi
    ) ?? [];

  const codeCurrencyMatches =
    text.match(
      /\b\d[\d,.]*\s*(?:USD|EUR|GBP|NGN|CAD|AUD|JPY|INR)\b/gi
    ) ?? [];

  const percentageMatches =
    text.match(
      /\b\d+(?:[.,]\d+)?\s*%/gi
    ) ?? [];

  for (const token of [
    ...currencyMatches,
    ...codeCurrencyMatches,
    ...percentageMatches,
  ]) {
    tokens.add(
      normalizeText(
        token.toLowerCase()
      )
    );
  }

  return tokens;
}

function setsEqual(
  first: Set<string>,
  second: Set<string>
) {
  if (
    first.size !==
    second.size
  ) {
    return false;
  }

  for (const value of first) {
    if (!second.has(value)) {
      return false;
    }
  }

  return true;
}

function scoreCategory(
  addedLines: string[],
  removedLines: string[]
) {
  const scores: Record<
    ChangeCategory,
    number
  > = {
    pricing: 0,
    product: 0,
    feature: 0,
    positioning: 0,
    promotion: 0,
    policy: 0,
    navigation: 0,
    content: 0,
    other: 0,
  };

  const allLines = [
    ...removedLines,
    ...addedLines,
  ];

  const changedText =
    allLines.join("\n");

  const hasCurrencySignal =
    currencyPattern.test(
      changedText
    );

  const hasPricingSignal =
    pricingPattern.test(
      changedText
    );

  const hasPercentageSignal =
    percentagePattern.test(
      changedText
    );

  const hasPromotionSignal =
    promotionPattern.test(
      changedText
    );

  const hasPolicySignal =
    policyPattern.test(
      changedText
    );

  const hasProductSignal =
    productPattern.test(
      changedText
    );

  const hasFeatureSignal =
    featurePattern.test(
      changedText
    );

  const hasFeatureLaunchSignal =
    featureLaunchPattern.test(
      changedText
    );

  const hasPositioningSignal =
    positioningPattern.test(
      changedText
    );

  const hasContentSignal =
    contentPattern.test(
      changedText
    );

  /*
   * PRICING
   *
   * Concrete currency values are one of the
   * strongest possible business signals.
   */
  if (hasCurrencySignal) {
    scores.pricing += 10;
  }

  if (hasPricingSignal) {
    scores.pricing += 7;
  }

  /*
   * Percentage changes may represent either
   * ordinary pricing/fees or promotions.
   */
  if (hasPercentageSignal) {
    if (hasPromotionSignal) {
      scores.promotion += 4;
    } else {
      scores.pricing += 5;
    }
  }

  /*
   * PROMOTION
   *
   * Explicit sale/discount language should beat
   * generic price detection.
   */
  if (hasPromotionSignal) {
    scores.promotion += 12;
  }

  /*
   * POLICY
   */
  if (hasPolicySignal) {
    scores.policy += 10;
  }

  /*
   * PRODUCT
   *
   * Plans, tiers and product names are stronger
   * evidence than generic positioning copy.
   */
  if (hasProductSignal) {
    scores.product += 7;
  }

  /*
   * FEATURE
   *
   * Explicit capabilities such as SSO, SCIM,
   * integrations, APIs, automation, dashboards,
   * webhooks, etc. receive strong weight.
   */
  if (hasFeatureSignal) {
    scores.feature += 9;
  }

  /*
   * "New feature", "introducing", "now supports",
   * etc. give additional evidence that this is a
   * capability change.
   */
  if (hasFeatureLaunchSignal) {
    scores.feature += 4;
  }

  /*
   * POSITIONING
   *
   * Positioning remains important, but it is weaker
   * than explicit product/feature evidence.
   */
  if (hasPositioningSignal) {
    scores.positioning += 6;
  }

  /*
   * CONTENT
   */
  if (hasContentSignal) {
    scores.content += 6;
  }

  /*
   * NAVIGATION
   *
   * Score short lines individually because menu
   * labels and CTAs are generally short.
   */
  let navigationMatches = 0;

  for (const line of allLines) {
    if (
      line.length <= 80 &&
      navigationPattern.test(
        line
      )
    ) {
      navigationMatches++;
    }
  }

  scores.navigation +=
    Math.min(
      navigationMatches * 4,
      12
    );

  /*
   * Explicit promotional language gets precedence
   * over ordinary pricing language.
   *
   * Example:
   *
   * "Save 20% for a limited time"
   *
   * should be promotion, not pricing.
   */
  if (
    hasPromotionSignal &&
    scores.promotion <=
      scores.pricing
  ) {
    scores.promotion =
      scores.pricing + 2;
  }

  /*
   * If a line explicitly describes a feature or
   * capability, generic audience wording should
   * never overpower it.
   *
   * Example:
   *
   * "New feature: SSO and SCIM integrations for
   * enterprise teams"
   *
   * contains a positioning phrase ("for enterprise
   * teams"), but the actual business event is a
   * feature launch.
   */
  if (
    hasFeatureSignal &&
    scores.feature <=
      scores.positioning
  ) {
    scores.feature =
      scores.positioning + 2;
  }

  /*
   * Likewise, explicit product/plan evidence should
   * not lose solely because the same line mentions
   * its target audience.
   */
  if (
    hasProductSignal &&
    !hasFeatureSignal &&
    scores.product <=
      scores.positioning
  ) {
    scores.product =
      scores.positioning + 1;
  }

  let category:
    ChangeCategory =
    "content";

  let highestScore = 0;

  for (
    const candidate
    of CATEGORY_PRIORITY
  ) {
    const candidateScore =
      scores[candidate];

    if (
      candidateScore >
      highestScore
    ) {
      highestScore =
        candidateScore;

      category =
        candidate;
    }
  }

  /*
   * Any real textual change without a stronger
   * business signal is classified as content.
   *
   * "other" is reserved for future structural or
   * non-text classifiers.
   */
  if (highestScore === 0) {
    category = "content";
    scores.content = 1;
  }

  return {
    category,
    scores,
  };
}

function determineConfidence(
  category: ChangeCategory,
  scores: Record<
    ChangeCategory,
    number
  >
) {
  const ordered =
    Object.entries(scores)
      .map(
        ([name, score]) => ({
          category:
            name as ChangeCategory,
          score,
        })
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  const top =
    ordered[0]?.score ?? 0;

  const second =
    ordered[1]?.score ?? 0;

  const gap =
    top - second;

  if (
    category === "content" &&
    top <= 1
  ) {
    return 0.55;
  }

  if (
    top >= 12 &&
    gap >= 4
  ) {
    return 0.98;
  }

  if (
    top >= 10 &&
    gap >= 3
  ) {
    return 0.96;
  }

  if (
    top >= 8 &&
    gap >= 2
  ) {
    return 0.92;
  }

  if (top >= 6) {
    return 0.86;
  }

  if (top >= 4) {
    return 0.78;
  }

  return 0.65;
}

function determineSignificance(
  category: ChangeCategory,
  addedLines: string[],
  removedLines: string[],
  commercialDelta: boolean
) {
  const reasons: string[] =
    [];

  const addedCount =
    addedLines.length;

  const removedCount =
    removedLines.length;

  const changedCount =
    addedCount +
    removedCount;

  let significance:
    ChangeSignificance =
    "minor";

  /*
   * PRICING
   */
  if (
    category === "pricing"
  ) {
    significance =
      "moderate";

    reasons.push(
      "Pricing-related content changed."
    );

    /*
     * A concrete amount or percentage changed.
     *
     * Example:
     *
     * £49 → £59
     */
    if (commercialDelta) {
      significance =
        "major";

      reasons.push(
        "A concrete price, currency amount, or percentage changed between the removed and added text."
      );
    }
  }

  /*
   * PRODUCT / FEATURE
   */
  if (
    category === "product" ||
    category === "feature"
  ) {
    significance =
      "moderate";

    reasons.push(
      "Product or feature information changed."
    );
  }

  /*
   * POLICY
   */
  if (
    category === "policy"
  ) {
    significance =
      "moderate";

    reasons.push(
      "Policy or legal/compliance content changed."
    );
  }

  /*
   * PROMOTION
   */
  if (
    category ===
    "promotion"
  ) {
    significance =
      "moderate";

    reasons.push(
      "Promotional or offer-related content changed."
    );
  }

  /*
   * POSITIONING
   */
  if (
    category ===
    "positioning"
  ) {
    significance =
      "moderate";

    reasons.push(
      "Positioning or audience messaging changed."
    );
  }

  /*
   * NAVIGATION
   */
  if (
    category ===
    "navigation"
  ) {
    significance =
      "minor";

    reasons.push(
      "Navigation or CTA structure changed."
    );
  }

  /*
   * Generic content defaults to Minor unless a
   * substantial block changed.
   */
  if (
    category === "content" ||
    category === "other"
  ) {
    significance =
      "minor";
  }

  /*
   * Large replacements in strategically important
   * categories become Major.
   */
  if (
    changedCount >= 12 &&
    addedCount > 0 &&
    removedCount > 0 &&
    (
      category ===
        "product" ||
      category ===
        "feature" ||
      category ===
        "policy" ||
      category ===
        "positioning"
    )
  ) {
    significance =
      "major";

    reasons.push(
      "A large block of strategically important content was replaced."
    );
  }

  /*
   * Large removals may represent discontinued
   * products/features or removed policy sections.
   */
  if (
    removedCount >= 8 &&
    (
      category ===
        "product" ||
      category ===
        "feature" ||
      category ===
        "policy"
    )
  ) {
    significance =
      "major";

    reasons.push(
      "A substantial amount of strategically important content was removed."
    );
  }

  if (
    category === "content" &&
    changedCount >= 8
  ) {
    significance =
      "moderate";

    reasons.push(
      "A substantial content block changed."
    );
  }

  if (
    category ===
      "navigation" &&
    changedCount >= 6
  ) {
    significance =
      "moderate";

    reasons.push(
      "Multiple navigation or CTA items changed."
    );
  }

  return {
    significance,
    reasons,
  };
}

export function classifyChange(
  parts: ClassifiableDiffPart[]
): ChangeClassification {
  const {
    added,
    removed,
  } =
    getChangedLines(parts);

  const addedText =
    added.join("\n");

  const removedText =
    removed.join("\n");

  const addedCommercialTokens =
    extractCommercialTokens(
      addedText
    );

  const removedCommercialTokens =
    extractCommercialTokens(
      removedText
    );

  /*
   * A commercial delta exists when both sides
   * contain concrete commercial values and those
   * sets differ.
   *
   * Example:
   *
   * removed = £49
   * added   = £59
   */
  const commercialDelta =
    addedCommercialTokens.size >
      0 &&
    removedCommercialTokens.size >
      0 &&
    !setsEqual(
      addedCommercialTokens,
      removedCommercialTokens
    );

  const {
    category,
    scores,
  } =
    scoreCategory(
      added,
      removed
    );

  const {
    significance,
    reasons,
  } =
    determineSignificance(
      category,
      added,
      removed,
      commercialDelta
    );

  const confidence =
    determineConfidence(
      category,
      scores
    );

  const finalReasons = [
    `Classified as ${category} from deterministic keyword and commercial-signal scoring.`,
    ...reasons,
  ];

  return {
    category,
    significance,
    confidence,

    reasons:
      finalReasons,

    signals: {
      addedLines:
        added.length,

      removedLines:
        removed.length,

      changedLines:
        added.length +
        removed.length,

      commercialDelta,

      categoryScores:
        scores,
    },
  };
}