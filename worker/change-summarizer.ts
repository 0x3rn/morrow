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

  /*
   * Context the model needs to name what changed. All optional so
   * older callers keep working.
   */
  competitorName?: string | null;
  pageLabel?: string | null;
  pageUrl?: string | null;
  previousHttpStatus?: number | null;
  currentHttpStatus?: number | null;
}

export interface MorrowAiBinding {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<unknown>;

  /*
   * Used only by the direct provider route, to learn the gateway's
   * base URL without storing the account id anywhere.
   */
  gateway?(gatewayId: string): {
    getUrl(provider?: string): Promise<string>;
  };
}

/*
 * Which model writes the summary.
 *
 * Both are optional. With neither set, the original Workers AI model
 * is used and nothing changes. To use a model from AI Gateway (for
 * example DeepSeek), set both: a model id in the form
 * "provider/model" and the name of your gateway.
 */
export interface SummaryModelOptions {
  model?: string | null;
  gatewayId?: string | null;

  /*
   * Gateway authentication token (the CF_AIG_TOKEN secret). Only the
   * direct provider route needs it. It is never logged.
   */
  gatewayToken?: string | null;
}

export type ChangeSummarySource =
  | "workers_ai"
  | "ai_gateway"
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

export const DEFAULT_SUMMARY_MODEL =
  "@cf/meta/llama-3.1-8b-instruct-fast";

const WORKERS_AI_MODEL_PREFIX = "@cf/";

/* "deepseek/deepseek-v4-pro", "openai/gpt-4.1-mini", "@cf/meta/llama-..." */
const MODEL_ID_PATTERN =
  /^(?:@cf\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._:-]*)+$/i;

const GATEWAY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/*
 * "Direct" models call the provider's own endpoint on your gateway
 * instead of going through env.AI.run(). That is the route that uses
 * the provider key stored in the gateway (BYOK) and bills it to you.
 * The id is "<provider>-direct/<provider model name>", for example
 * "deepseek-direct/deepseek-flash".
 */
const DIRECT_ROUTE_PROVIDERS: Readonly<
  Record<string, string>
> = {
  "deepseek-direct": "deepseek",
};

const GATEWAY_TOKEN_PATTERN = /^\S{8,}$/;

export function parseDirectModel(
  model: string
): { provider: string; providerModel: string } | null {
  const slash = model.indexOf("/");

  if (slash <= 0) {
    return null;
  }

  const provider =
    DIRECT_ROUTE_PROVIDERS[
      model.slice(0, slash)
    ];

  const providerModel =
    model.slice(slash + 1);

  if (!provider || !providerModel) {
    return null;
  }

  return { provider, providerModel };
}

export interface ResolvedSummaryModel {
  model: string;
  gatewayId: string | null;
  isWorkersAiModel: boolean;
  /* Set for direct provider models; null for everything else. */
  direct: {
    provider: string;
    providerModel: string;
    token: string;
  } | null;
  /* Set when the supplied settings were unusable and the default was used. */
  warning: string | null;
}

/*
 * Never throws. A bad or half-finished setting falls back to the
 * default model with a warning, because summarization must not
 * become a reason a detected change goes unrecorded.
 */
export function resolveSummaryModel(
  options?: SummaryModelOptions
): ResolvedSummaryModel {
  const requestedModel =
    options?.model?.trim() || "";

  const requestedGateway =
    options?.gatewayId?.trim() || "";

  const fallback = (
    warning: string | null
  ): ResolvedSummaryModel => ({
    model: DEFAULT_SUMMARY_MODEL,
    gatewayId:
      GATEWAY_ID_PATTERN.test(requestedGateway)
        ? requestedGateway
        : null,
    isWorkersAiModel: true,
    direct: null,
    warning,
  });

  if (!requestedModel) {
    return fallback(null);
  }

  if (!MODEL_ID_PATTERN.test(requestedModel)) {
    return fallback(
      "MORROW_SUMMARY_MODEL is not a valid model id; using the default model."
    );
  }

  const isWorkersAiModel =
    requestedModel.startsWith(
      WORKERS_AI_MODEL_PREFIX
    );

  if (
    requestedGateway &&
    !GATEWAY_ID_PATTERN.test(requestedGateway)
  ) {
    return fallback(
      "MORROW_AI_GATEWAY_ID is not a valid gateway name; using the default model."
    );
  }

  /*
   * Models from other providers can only be reached through an
   * AI Gateway, so a gateway name is required for them.
   */
  if (!isWorkersAiModel && !requestedGateway) {
    return fallback(
      "MORROW_SUMMARY_MODEL names a non-Workers-AI model but MORROW_AI_GATEWAY_ID is not set; using the default model."
    );
  }

  const direct =
    parseDirectModel(requestedModel);

  if (direct) {
    const token =
      options?.gatewayToken?.trim() || "";

    if (!GATEWAY_TOKEN_PATTERN.test(token)) {
      return fallback(
        "MORROW_SUMMARY_MODEL uses a direct provider route but the CF_AIG_TOKEN secret is missing or invalid; using the default model."
      );
    }

    return {
      model: requestedModel,
      gatewayId: requestedGateway,
      isWorkersAiModel: false,
      direct: { ...direct, token },
      warning: null,
    };
  }

  return {
    model: requestedModel,
    gatewayId: requestedGateway || null,
    isWorkersAiModel,
    direct: null,
    warning: null,
  };
}

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
    /*
     * Some models wrap JSON in a ```json fence or add a sentence
     * around it. Retry on the outermost {...} before giving up.
     */
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");

    if (start === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(
        value.slice(start, end + 1)
      );
    } catch {
      return null;
    }
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

/*
 * The model is told what the page is, how each check loaded, and the
 * exact text that left and arrived. Classifier confidence and reasons
 * are deliberately NOT sent: they only tempted the model to talk about
 * "classification" and "lines of code" in messages for end users.
 */
export function buildPromptInput(
  input: ChangeSummaryInput,
  previousText: string | null,
  currentText: string | null
) {
  return JSON.stringify(
    {
      competitor:
        input.competitorName ?? null,

      page_name:
        input.pageLabel ?? null,

      page_url:
        input.pageUrl ?? null,

      previous_check_http_status:
        input.previousHttpStatus ?? null,

      current_check_http_status:
        input.currentHttpStatus ?? null,

      topic:
        input.category,

      importance:
        input.significance,

      removed_text:
        previousText,

      added_text:
        currentText,
    },
    null,
    2
  );
}

/*
 * The reader sees this text in an email or a Telegram message and
 * has seconds to understand it, so the prompt demands concrete
 * before/after values and forbids filler.
 */
export const SUMMARY_SYSTEM_PROMPT = `
You write change alerts for Morrow, a tool that watches competitor websites.
The reader sees your text in an email or Telegram message and must understand
what happened in under ten seconds.

You receive: the competitor, the page, the HTTP status of the previous and
current check, and the exact text that was removed and added. The topic and
importance were decided by other code. Do not change them or mention them.

Reply with JSON only, with two string fields: "summary" and "why_it_matters".

SUMMARY (1-2 short sentences)
- Say exactly what changed and quote the real old and new values.
  Good: "Pro plan price went from $99 to $129 per month."
  Bad: "Pricing content was updated."
- If there is only added_text, say what appeared. If there is only
  removed_text, say what disappeared. Do not call that "updated".
- Name the plan, feature or section when the text shows it.
- Quote short phrases only. Never paste long blocks.

PAGE LOAD PROBLEMS (check this first)
- If previous_check_http_status is 400 or higher and current_check_http_status
  is below 400, the page was broken last time and works now. Say that. Do NOT
  describe the page text as new or as something the competitor changed.
- If removed_text looks like an error page ("something went wrong", "try
  again in a moment", "not found", "access denied"), treat it the same way.

WHY IT MATTERS (1 sentence)
- Tie it to the specific fact in your summary and say what the reader could
  check or do. Use "may" or "could" for effects you cannot see.
- If the change is minor (wording, layout, link text, a page that works
  again), say so plainly, for example "No clear business impact."

NEVER
- Invent numbers, dates, products, motives or reasons. Use only the text given.
- Use vague filler such as "content was updated", "significantly updated",
  "pricing strategy shift", "new service offerings" or "customer purchasing
  decisions".
- Mention topic, importance, classification, confidence, lines of code,
  evidence, JSON or prompts. The reader does not know these exist.
- Count lines. Describe what the text says.
`.trim();

/*
 * Worked examples, sent as earlier chat turns so the model copies the
 * shape and level of detail of the answers.
 */
const SUMMARY_EXAMPLES: ReadonlyArray<{
  input: Record<string, unknown>;
  output: StructuredModelSummary;
}> = [
  {
    input: {
      competitor: "Acme Analytics",
      page_name: "Pricing",
      page_url: "https://acme.example/pricing",
      previous_check_http_status: 200,
      current_check_http_status: 200,
      topic: "pricing",
      importance: "major",
      removed_text: "Pro\n$99 / month",
      added_text: "Pro\n$129 / month",
    },
    output: {
      summary:
        "The Pro plan price went from $99 to $129 per month.",
      why_it_matters:
        "A $30 rise may make competing plans look cheaper; check how your own mid-tier plan compares.",
    },
  },
  {
    input: {
      competitor: "Northwind Tools",
      page_name: "Homepage",
      page_url: "https://northwind.example/",
      previous_check_http_status: 200,
      current_check_http_status: 200,
      topic: "pricing",
      importance: "moderate",
      removed_text:
        "Something went wrong. Please try again in a moment.",
      added_text:
        "Starter $20\nTeam $60\nBusiness $150",
    },
    output: {
      summary:
        "The page was showing an error message last time and now shows its normal content, including plans at $20, $60 and $150.",
      why_it_matters:
        "This is a page that works again, not a competitor edit, so there is nothing to act on yet.",
    },
  },
  {
    input: {
      competitor: "Globex CRM",
      page_name: "Features",
      page_url: "https://globex.example/features",
      previous_check_http_status: 200,
      current_check_http_status: 200,
      topic: "feature",
      importance: "moderate",
      removed_text: null,
      added_text: "Single sign-on (SSO) and SCIM for Enterprise",
    },
    output: {
      summary:
        "The Enterprise plan now lists single sign-on (SSO) and SCIM.",
      why_it_matters:
        "This may close a gap for larger buyers; check whether your own Enterprise tier covers it.",
    },
  },
];

function buildExampleMessages() {
  return SUMMARY_EXAMPLES.flatMap(
    (example) => [
      {
        role: "user",
        content: JSON.stringify(
          example.input,
          null,
          2
        ),
      },
      {
        role: "assistant",
        content: JSON.stringify(
          example.output
        ),
      },
    ]
  );
}

/*
 * Models do not all accept the same request. Three shapes are used:
 *
 *  - workers_ai_legacy_schema: the Llama family that Morrow has always
 *    used. Takes the JSON schema directly in "json_schema".
 *  - openai_json_schema: newer Workers AI models (for example
 *    DeepSeek V4.1 Flash). They use the OpenAI chat shape, where
 *    "json_schema" must be { name, schema, strict }.
 *  - openai_json_object: models from other providers reached through
 *    AI Gateway. Plain "json_object" mode, because several providers
 *    (DeepSeek among them) do not accept json_schema.
 */
export type RequestStyle =
  | "workers_ai_legacy_schema"
  | "openai_json_schema"
  | "openai_json_object";

export function requestStyleFor(
  model: string
): RequestStyle {
  if (!model.startsWith(WORKERS_AI_MODEL_PREFIX)) {
    return "openai_json_object";
  }

  if (model.startsWith("@cf/meta/")) {
    return "workers_ai_legacy_schema";
  }

  return "openai_json_schema";
}

/*
 * DeepSeek V4 on Workers AI is a reasoning model and thinks at
 * "high" effort by default. A two-sentence summary does not need
 * that, and the thinking would spend the token budget and the money
 * before any answer is written, so it is switched off.
 */
function isWorkersAiDeepSeekV4(
  model: string
) {
  return model.startsWith(
    "@cf/deepseek-ai/deepseek-v4"
  );
}

export function buildModelRequest(
  model: string,
  userPrompt: string
): Record<string, unknown> {
  const style =
    requestStyleFor(model);

  const request: Record<string, unknown> = {
    messages: [
      {
        role: "system",
        content:
          SUMMARY_SYSTEM_PROMPT,
      },
      ...buildExampleMessages(),
      {
        role: "user",
        content: userPrompt,
      },
    ],

    temperature: 0.1,
  };

  if (style === "workers_ai_legacy_schema") {
    request.response_format = {
      type: "json_schema",
      json_schema: summarySchema,
    };
    request.max_tokens = 400;
  } else if (style === "openai_json_schema") {
    request.response_format = {
      type: "json_schema",
      json_schema: {
        name: "change_summary",
        schema: summarySchema,
        strict: true,
      },
    };
    request.max_tokens = 800;
  } else {
    request.response_format = {
      type: "json_object",
    };
    request.max_tokens = 1500;
  }

  if (isWorkersAiDeepSeekV4(model)) {
    request.reasoning_effort = "none";
  }

  return request;
}

const DIRECT_CALL_TIMEOUT_MS = 30_000;

/*
 * Request for DeepSeek's own chat API. Thinking is switched off
 * because a two-sentence summary does not need it, and it would use
 * the token budget and the money first. DeepSeek's JSON mode needs
 * the word "JSON" in the prompt (it is) and a generous max_tokens.
 */
export function buildDirectDeepSeekRequest(
  providerModel: string,
  userPrompt: string
): Record<string, unknown> {
  const { messages } = buildModelRequest(
    "deepseek-direct/" + providerModel,
    userPrompt
  );

  return {
    model: providerModel,
    messages,
    response_format: { type: "json_object" },
    max_tokens: 1000,
    thinking: { type: "disabled" },
  };
}

/*
 * Calls the provider's own endpoint on the gateway. No provider key
 * is sent: AI Gateway substitutes the key stored under the "default"
 * alias, so the provider bills you directly. "cf-aig-no-wholesale"
 * makes the gateway refuse the request instead of silently falling
 * back to Cloudflare-managed credentials if that key is not found.
 */
async function callDirectProvider(
  ai: MorrowAiBinding,
  attempt: ResolvedSummaryModel,
  userPrompt: string
): Promise<unknown> {
  const direct = attempt.direct;

  if (!direct || !attempt.gatewayId) {
    throw new Error(
      "Direct route is missing its provider or gateway."
    );
  }

  if (typeof ai.gateway !== "function") {
    throw new Error(
      "The AI binding does not offer gateway(); cannot find the gateway URL."
    );
  }

  const baseUrl = await ai
    .gateway(attempt.gatewayId)
    .getUrl(direct.provider);

  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-aig-authorization": `Bearer ${direct.token}`,
        "cf-aig-no-wholesale": "true",
      },
      body: JSON.stringify(
        buildDirectDeepSeekRequest(
          direct.providerModel,
          userPrompt
        )
      ),
      signal: AbortSignal.timeout(
        DIRECT_CALL_TIMEOUT_MS
      ),
    }
  );

  if (!response.ok) {
    const detail = (
      await response.text().catch(() => "")
    ).slice(0, 300);

    throw new Error(
      `Gateway returned HTTP ${response.status}: ${detail}`
    );
  }

  return response.json();
}

export async function summarizeChange(
  ai: MorrowAiBinding | undefined,
  input: ChangeSummaryInput,
  modelOptions?: SummaryModelOptions
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

  const userPrompt =
    buildPromptInput(
      input,
      previousText,
      currentText
    );

  const resolvedModel =
    resolveSummaryModel(
      modelOptions
    );

  if (resolvedModel.warning) {
    console.warn(
      "Morrow summary model configuration",
      resolvedModel.warning
    );
  }

  /*
   * The configured model goes first. If it fails or returns
   * something unusable (for example its plan or credits are not
   * set up yet), the default model gets one try before the plain
   * template text is used, so a model setting can never make
   * summaries worse than they were.
   */
  const attempts: ResolvedSummaryModel[] = [
    resolvedModel,
  ];

  if (
    resolvedModel.model !==
    DEFAULT_SUMMARY_MODEL
  ) {
    attempts.push({
      model: DEFAULT_SUMMARY_MODEL,
      gatewayId:
        resolvedModel.gatewayId,
      isWorkersAiModel: true,
      direct: null,
      warning: null,
    });
  }

  for (const attempt of attempts) {
    try {
      const modelResponse =
        attempt.direct
          ? await callDirectProvider(
              ai,
              attempt,
              userPrompt
            )
          : await ai.run(
              attempt.model,
              buildModelRequest(
                attempt.model,
                userPrompt
              ),
              attempt.gatewayId
                ? {
                    gateway: {
                      id: attempt.gatewayId,
                    },
                  }
                : undefined
            );

      const structured =
        extractStructuredResponse(
          modelResponse
        );

      if (structured) {
        return {
          summary:
            structured.summary,

          whyItMatters:
            structured.why_it_matters,

          previousText,
          currentText,

          source:
            attempt.isWorkersAiModel
              ? "workers_ai"
              : "ai_gateway",

          model:
            attempt.model,
        };
      }

      console.warn(
        "Morrow summary model returned an unusable reply",
        {
          model: attempt.model,
        }
      );
    } catch (error) {
      console.error(
        "Morrow summary model call failed",
        {
          model: attempt.model,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        }
      );
    }
  }

  return fallback;
}
