export interface SummaryDiffPart {
  added: boolean;
  removed: boolean;
  value: string;
}

export interface ChangeSummaryInput {
  category: string;
  significance: string;
  classificationConfidence: number;
  classificationReasons: string[];
  addedLines: number;
  removedLines: number;
  parts: SummaryDiffPart[];
}

export interface MorrowAiBinding {
  run(
    model: string,
    input: Record<string, unknown>
  ): Promise<unknown>;
}

export type ChangeSummarySource =
  | "workers_ai"
  | "fallback";

export interface ChangeSummaryResult {
  summary: string;
  whyItMatters: string;

  /*
   * These are bounded changed-only snippets.
   *
   * They are NOT complete snapshot copies.
   */
  previousText: string | null;
  currentText: string | null;

  source: ChangeSummarySource;
  model: string | null;
}

interface StructuredModelSummary {
  summary: string;
  why_it_matters: string;
}

const SUMMARY_MODEL =
  "@cf/meta/llama-3.1-8b-instruct-fast";

const MAX_EVIDENCE_LINES = 20;
const MAX_EVIDENCE_CHARS = 3000;
const MAX_GENERATED_FIELD_CHARS = 600;

const summarySchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
    },
    why_it_matters: {
      type: "string",
    },
  },
  required: [
    "summary",
    "why_it_matters",
  ],
  additionalProperties: false,
};

function normalizeLine(
  value: string
) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitChangedLines(
  parts: SummaryDiffPart[]
) {
  const added: string[] = [];
  const removed: string[] = [];

  for (const part of parts) {
    const lines =
      part.value
        .split("\n")
        .map(normalizeLine)
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

function categorySignalPattern(
  category: string
): RegExp {
  switch (category) {
    case "pricing":
      return /[$€£¥₦₹]|\b(?:usd|eur|gbp|ngn|price|pricing|cost|fee|monthly|annually|per month|per year|discount|billing)\b|\d+(?:[.,]\d+)?\s*%/i;

    case "promotion":
      return /\b(?:sale|discount|offer|promotion|promo|limited time|coupon|voucher|save|free trial)\b|\d+(?:[.,]\d+)?\s*%/i;

    case "policy":
      return /\b(?:policy|privacy|terms|refund|cancellation|security|compliance|gdpr|ccpa|sla|data retention)\b/i;

    case "product":
      return /\b(?:product|plan|tier|package|edition|workspace|platform)\b/i;

    case "feature":
      return /\b(?:feature|integration|api|automation|workflow|dashboard|analytics|reporting|export|import|collaboration|sso|scim|webhook|mobile app|ai)\b/i;

    case "positioning":
      return /\b(?:built for|designed for|best for|ideal for|enterprise|startups|teams|all-in-one|trusted by)\b/i;

    case "navigation":
      return /\b(?:sign in|contact sales|talk to sales|demo|docs|resources|blog|support|help center|pricing)\b/i;

    case "content":
      return /\b(?:blog|article|guide|tutorial|case study|webinar|whitepaper|ebook|changelog|release notes)\b/i;

    default:
      return /./;
  }
}

function scoreEvidenceLine(
  line: string,
  category: string
) {
  let score = 0;

  const categoryPattern =
    categorySignalPattern(category);

  if (categoryPattern.test(line)) {
    score += 10;
  }

  /*
   * Concrete numeric/commercial evidence is
   * particularly useful for human-readable summaries.
   */
  if (
    /[$€£¥₦₹]/.test(line) ||
    /\b(?:usd|eur|gbp|ngn|cad|aud|jpy|inr)\b/i.test(line) ||
    /\d+(?:[.,]\d+)?\s*%/.test(line)
  ) {
    score += 6;
  }

  /*
   * Prefer reasonably concise evidence to giant
   * navigation/body chunks.
   */
  if (line.length <= 180) {
    score += 3;
  }

  if (line.length <= 90) {
    score += 2;
  }

  return score;
}

function selectEvidenceLines(
  lines: string[],
  category: string
) {
  const unique =
    Array.from(
      new Set(lines)
    );

  const ranked =
    unique
      .map(
        (line, index) => ({
          line,
          index,
          score:
            scoreEvidenceLine(
              line,
              category
            ),
        })
      )
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        return a.index - b.index;
      })
      .slice(
        0,
        MAX_EVIDENCE_LINES
      )
      /*
       * Restore original page order after choosing
       * the most relevant lines.
       */
      .sort(
        (a, b) =>
          a.index - b.index
      )
      .map(
        (entry) =>
          entry.line
      );

  return ranked;
}

function joinBoundedEvidence(
  lines: string[]
) {
  if (lines.length === 0) {
    return null;
  }

  let output = "";

  for (const line of lines) {
    const candidate =
      output.length === 0
        ? line
        : `${output}\n${line}`;

    if (
      candidate.length >
      MAX_EVIDENCE_CHARS
    ) {
      break;
    }

    output =
      candidate;
  }

  return output || null;
}

function shortEvidence(
  value: string | null
) {
  if (!value) {
    return null;
  }

  const singleLine =
    value
      .replace(/\n+/g, " · ")
      .replace(/\s+/g, " ")
      .trim();

  if (singleLine.length <= 180) {
    return singleLine;
  }

  return `${singleLine.slice(
    0,
    177
  )}...`;
}

function fallbackWhyItMatters(
  category: string
) {
  switch (category) {
    case "pricing":
      return "This may affect customer cost, plan comparisons, purchasing decisions, or how the competitor positions its commercial offering.";

    case "promotion":
      return "This may affect short-term customer acquisition, conversion, or how urgently prospects are encouraged to buy.";

    case "policy":
      return "This may change customer obligations, rights, risk, compliance expectations, or the terms under which the service is used.";

    case "product":
      return "This may indicate a change in the competitor's product packaging, target customer, or commercial offering.";

    case "feature":
      return "This may change the competitor's capabilities and could affect product comparisons or customer switching decisions.";

    case "positioning":
      return "This may signal a change in the audience, market segment, or value proposition the competitor is prioritizing.";

    case "navigation":
      return "This may indicate a change in what the competitor wants visitors to discover or do most prominently.";

    case "content":
      return "This may reflect a new topic, message, resource, or area of emphasis in the competitor's public communication.";

    default:
      return "This may represent a meaningful change in how the competitor presents or operates its offering.";
  }
}

function buildFallbackSummary(
  category: string,
  previousText: string | null,
  currentText: string | null
) {
  const previous =
    shortEvidence(
      previousText
    );

  const current =
    shortEvidence(
      currentText
    );

  if (previous && current) {
    return `${capitalize(
      category
    )} information changed from "${previous}" to "${current}".`;
  }

  if (current) {
    return `New ${category} information was added: "${current}".`;
  }

  if (previous) {
    return `${capitalize(
      category
    )} information was removed: "${previous}".`;
  }

  return `${capitalize(
    category
  )} content changed.`;
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

function sanitizeGeneratedText(
  value: unknown
) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const normalized =
    value
      .replace(/\s+/g, " ")
      .trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized.length >
    MAX_GENERATED_FIELD_CHARS
  ) {
    return normalized.slice(
      0,
      MAX_GENERATED_FIELD_CHARS
    );
  }

  return normalized;
}

function isRecord(
  value: unknown
): value is Record<
  string,
  unknown
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function tryParseJson(
  value: string
): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractStructuredResponse(
  response: unknown
): StructuredModelSummary | null {
  let candidate:
    unknown =
    response;

  if (isRecord(candidate)) {
    /*
     * Workers AI JSON mode commonly returns:
     *
     * {
     *   response: {
     *     summary: "...",
     *     why_it_matters: "..."
     *   }
     * }
     */
    if (
      "response" in candidate
    ) {
      candidate =
        candidate.response;
    }
    /*
     * Also tolerate chat-completion-shaped output.
     */
    else if (
      Array.isArray(
        candidate.choices
      ) &&
      candidate.choices.length >
        0
    ) {
      const firstChoice =
        candidate.choices[0];

      if (
        isRecord(firstChoice) &&
        isRecord(
          firstChoice.message
        )
      ) {
        candidate =
          firstChoice.message
            .content;
      }
    }
  }

  if (
    typeof candidate ===
    "string"
  ) {
    candidate =
      tryParseJson(
        candidate
      );
  }

  if (!isRecord(candidate)) {
    return null;
  }

  const summary =
    sanitizeGeneratedText(
      candidate.summary
    );

  const whyItMatters =
    sanitizeGeneratedText(
      candidate.why_it_matters
    );

  if (
    !summary ||
    !whyItMatters
  ) {
    return null;
  }

  return {
    summary,
    why_it_matters:
      whyItMatters,
  };
}

function buildPromptInput(
  input: ChangeSummaryInput,
  previousText: string | null,
  currentText: string | null
) {
  return JSON.stringify(
    {
      fixed_classification: {
        category:
          input.category,

        significance:
          input.significance,

        confidence:
          input.classificationConfidence,

        reasons:
          input.classificationReasons,
      },

      changed_evidence: {
        previous:
          previousText,

        current:
          currentText,

        removed_line_count:
          input.removedLines,

        added_line_count:
          input.addedLines,
      },
    },
    null,
    2
  );
}

export async function summarizeChange(
  ai: MorrowAiBinding | undefined,
  input: ChangeSummaryInput
): Promise<ChangeSummaryResult> {
  const changedLines =
    splitChangedLines(
      input.parts
    );

  const previousEvidence =
    selectEvidenceLines(
      changedLines.removed,
      input.category
    );

  const currentEvidence =
    selectEvidenceLines(
      changedLines.added,
      input.category
    );

  const previousText =
    joinBoundedEvidence(
      previousEvidence
    );

  const currentText =
    joinBoundedEvidence(
      currentEvidence
    );

  const fallback: ChangeSummaryResult =
    {
      summary:
        buildFallbackSummary(
          input.category,
          previousText,
          currentText
        ),

      whyItMatters:
        fallbackWhyItMatters(
          input.category
        ),

      previousText,
      currentText,

      source: "fallback",
      model: null,
    };

  /*
   * AI must never become a persistence dependency.
   */
  if (!ai) {
    return fallback;
  }

  const systemPrompt = `
You write concise competitor-monitoring change explanations for Morrow.

Important rules:

1. The supplied category and significance are already decided by deterministic code.
2. Never override, question, rename, or recalculate the category or significance.
3. Use only the supplied changed evidence.
4. Do not invent prices, dates, products, features, motives, causes, customer reactions, or business outcomes.
5. "why_it_matters" must describe plausible relevance only. Use language such as "may" or "could" when impact is not directly proven.
6. Do not mention classifiers, confidence scores, prompts, evidence objects, JSON, or internal system names.
7. summary should clearly explain what changed in 1-2 short sentences.
8. why_it_matters should be 1-2 short sentences.
9. Do not reproduce large blocks of page text.
`.trim();

  const userPrompt =
    buildPromptInput(
      input,
      previousText,
      currentText
    );

  try {
    const modelResponse =
      await ai.run(
        SUMMARY_MODEL,
        {
          messages: [
            {
              role: "system",
              content:
                systemPrompt,
            },
            {
              role: "user",
              content:
                userPrompt,
            },
          ],

          response_format: {
            type: "json_schema",
            json_schema:
              summarySchema,
          },

          temperature: 0.1,
          max_tokens: 300,
        }
      );

    const structured =
      extractStructuredResponse(
        modelResponse
      );

    if (!structured) {
      return fallback;
    }

    return {
      summary:
        structured.summary,

      whyItMatters:
        structured.why_it_matters,

      previousText,
      currentText,

      source:
        "workers_ai",

      model:
        SUMMARY_MODEL,
    };
  } catch (error) {
    console.error(
      "Morrow change summarization failed; using fallback",
      error
    );

    return fallback;
  }
}