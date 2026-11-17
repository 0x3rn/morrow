import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SUMMARY_MODEL,
  SUMMARY_SYSTEM_PROMPT,
  buildModelRequest,
  buildPromptInput,
  requestStyleFor,
  resolveSummaryModel,
  summarizeChange,
} from "../worker/change-summarizer.ts";

const priceChange = {
  category: "pricing",
  significance: "major",
  classificationConfidence: 0.9,
  classificationReasons: ["price changed"],
  addedLines: 1,
  removedLines: 1,
  parts: [
    { added: false, removed: true, value: "Pro $99 / month\n" },
    { added: true, removed: false, value: "Pro $129 / month\n" },
  ],
  competitorName: "Acme Analytics",
  pageLabel: "Pricing",
  pageUrl: "https://acme.example/pricing",
  previousHttpStatus: 200,
  currentHttpStatus: 200,
};

/* A fake Workers AI binding that records every call. */
function fakeAi(response) {
  const calls = [];

  return {
    calls,
    async run(model, input, options) {
      calls.push({ model, input, options });

      if (response instanceof Error) {
        throw response;
      }

      return response;
    },
  };
}

const goodJson = {
  summary: "The Pro plan price went from $99 to $129 per month.",
  why_it_matters: "A $30 rise may make rivals look cheaper.",
};

/* ---------- resolveSummaryModel ---------- */

test("no settings uses the default Workers AI model and no gateway", () => {
  const resolved = resolveSummaryModel();

  assert.equal(resolved.model, DEFAULT_SUMMARY_MODEL);
  assert.equal(resolved.gatewayId, null);
  assert.equal(resolved.isWorkersAiModel, true);
  assert.equal(resolved.warning, null);
});

test("blank settings behave like no settings", () => {
  const resolved = resolveSummaryModel({ model: "  ", gatewayId: "" });

  assert.equal(resolved.model, DEFAULT_SUMMARY_MODEL);
  assert.equal(resolved.warning, null);
});

test("a DeepSeek model with a gateway is accepted", () => {
  const resolved = resolveSummaryModel({
    model: "deepseek/deepseek-v4-pro",
    gatewayId: "morrow-gateway",
  });

  assert.equal(resolved.model, "deepseek/deepseek-v4-pro");
  assert.equal(resolved.gatewayId, "morrow-gateway");
  assert.equal(resolved.isWorkersAiModel, false);
  assert.equal(resolved.warning, null);
});

test("a Workers AI model may also be routed through a gateway", () => {
  const resolved = resolveSummaryModel({
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    gatewayId: "morrow-gateway",
  });

  assert.equal(resolved.isWorkersAiModel, true);
  assert.equal(resolved.gatewayId, "morrow-gateway");
  assert.equal(resolved.warning, null);
});

test("a third-party model without a gateway falls back with a warning", () => {
  const resolved = resolveSummaryModel({ model: "deepseek/deepseek-v4-pro" });

  assert.equal(resolved.model, DEFAULT_SUMMARY_MODEL);
  assert.equal(resolved.isWorkersAiModel, true);
  assert.match(resolved.warning, /MORROW_AI_GATEWAY_ID is not set/);
});

test("malformed model ids fall back with a warning", () => {
  for (const bad of [
    "deepseek",
    "../etc/passwd",
    "deepseek/ model",
    "deepseek/model\nINJECT",
    "https://evil.example/x",
    "/deepseek/x",
  ]) {
    const resolved = resolveSummaryModel({
      model: bad,
      gatewayId: "morrow-gateway",
    });

    assert.equal(resolved.model, DEFAULT_SUMMARY_MODEL, bad);
    assert.ok(resolved.warning, bad);
  }
});

test("a malformed gateway name falls back and is not passed on", () => {
  const resolved = resolveSummaryModel({
    model: "deepseek/deepseek-v4-pro",
    gatewayId: "bad gateway/../name",
  });

  assert.equal(resolved.model, DEFAULT_SUMMARY_MODEL);
  assert.equal(resolved.gatewayId, null);
  assert.match(resolved.warning, /MORROW_AI_GATEWAY_ID/);
});

/* ---------- prompt content ---------- */

test("the new prompt demands real values and bans the old filler", () => {
  assert.match(SUMMARY_SYSTEM_PROMPT, /quote the real old and new values/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /PAGE LOAD PROBLEMS/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /pricing strategy shift/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /Count lines/);
});

test("the user message carries page, competitor, statuses and the exact text", () => {
  const body = JSON.parse(
    buildPromptInput(priceChange, "Pro $99 / month", "Pro $129 / month")
  );

  assert.equal(body.competitor, "Acme Analytics");
  assert.equal(body.page_name, "Pricing");
  assert.equal(body.page_url, "https://acme.example/pricing");
  assert.equal(body.previous_check_http_status, 200);
  assert.equal(body.current_check_http_status, 200);
  assert.equal(body.removed_text, "Pro $99 / month");
  assert.equal(body.added_text, "Pro $129 / month");
});

test("classifier confidence and reasons are not sent to the model", () => {
  const text = buildPromptInput(priceChange, "a", "b");

  assert.doesNotMatch(text, /confidence/i);
  assert.doesNotMatch(text, /price changed/);
});

test("missing context becomes null instead of throwing", () => {
  const body = JSON.parse(
    buildPromptInput(
      {
        category: "content",
        significance: "minor",
        classificationConfidence: 0.5,
        classificationReasons: [],
        addedLines: 0,
        removedLines: 0,
        parts: [],
      },
      null,
      null
    )
  );

  assert.equal(body.competitor, null);
  assert.equal(body.page_url, null);
  assert.equal(body.previous_check_http_status, null);
  assert.equal(body.removed_text, null);
});

/* ---------- request shape ---------- */

const DEEPSEEK_CF = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";

test("request style depends on the model family", () => {
  assert.equal(requestStyleFor(DEFAULT_SUMMARY_MODEL), "workers_ai_legacy_schema");
  assert.equal(
    requestStyleFor("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
    "workers_ai_legacy_schema"
  );
  assert.equal(requestStyleFor(DEEPSEEK_CF), "openai_json_schema");
  assert.equal(requestStyleFor("@cf/zai-org/glm-4.7-flash"), "openai_json_schema");
  assert.equal(requestStyleFor("deepseek/deepseek-v4-pro"), "openai_json_object");
  assert.equal(requestStyleFor("openai/gpt-4.1-mini"), "openai_json_object");
});

test("default model request: system, three worked examples, then the real input", () => {
  const request = buildModelRequest(DEFAULT_SUMMARY_MODEL, '{"real":"input"}');
  const roles = request.messages.map((message) => message.role);

  assert.deepEqual(roles, [
    "system",
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
  ]);
  assert.equal(request.messages.at(-1).content, '{"real":"input"}');
  assert.equal(request.response_format.type, "json_schema");
  /* legacy shape: the schema itself, no { name, schema } wrapper */
  assert.equal(request.response_format.json_schema.type, "object");
  assert.equal(request.response_format.json_schema.name, undefined);
  assert.equal(request.max_tokens, 400);
  assert.equal(request.reasoning_effort, undefined);
});

test("every worked example answer is valid two-field JSON", () => {
  const request = buildModelRequest(DEFAULT_SUMMARY_MODEL, "{}");

  for (const message of request.messages) {
    if (message.role !== "assistant") continue;

    const parsed = JSON.parse(message.content);

    assert.deepEqual(Object.keys(parsed).sort(), [
      "summary",
      "why_it_matters",
    ]);
    assert.ok(parsed.summary.length > 10);
    assert.ok(parsed.why_it_matters.length > 10);
  }
});

test("DeepSeek V4.1 Flash on Workers AI: OpenAI-style schema, reasoning off", () => {
  const request = buildModelRequest(DEEPSEEK_CF, "{}");

  assert.equal(request.response_format.type, "json_schema");
  assert.equal(request.response_format.json_schema.name, "change_summary");
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.response_format.json_schema.schema.type, "object");
  assert.deepEqual(request.response_format.json_schema.schema.required, [
    "summary",
    "why_it_matters",
  ]);
  assert.equal(request.reasoning_effort, "none");
  assert.equal(request.max_tokens, 800);
});

test("gateway model request uses json_object and no reasoning setting", () => {
  const request = buildModelRequest("deepseek/deepseek-v4-pro", "{}");

  assert.deepEqual(request.response_format, { type: "json_object" });
  assert.equal(request.max_tokens, 1500);
  assert.equal(request.reasoning_effort, undefined);
});

/* ---------- summarizeChange end to end with a fake binding ---------- */

test("default call: Llama model, no gateway option, parsed result", async () => {
  const ai = fakeAi({ response: goodJson });
  const result = await summarizeChange(ai, priceChange);

  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].model, DEFAULT_SUMMARY_MODEL);
  assert.equal(ai.calls[0].options, undefined);
  assert.equal(result.source, "workers_ai");
  assert.equal(result.summary, goodJson.summary);
  assert.equal(result.model, DEFAULT_SUMMARY_MODEL);
});

test("evidence reaches the model with the real prices", async () => {
  const ai = fakeAi({ response: goodJson });

  await summarizeChange(ai, priceChange);

  const sent = ai.calls[0].input.messages.at(-1).content;
  const body = JSON.parse(sent);

  assert.match(body.removed_text, /\$99/);
  assert.match(body.added_text, /\$129/);
});

test("DeepSeek via gateway: model id, gateway option, OpenAI-style reply parsed", async () => {
  const ai = fakeAi({
    choices: [{ message: { content: JSON.stringify(goodJson) } }],
  });

  const result = await summarizeChange(ai, priceChange, {
    model: "deepseek/deepseek-v4-pro",
    gatewayId: "morrow-gateway",
  });

  assert.equal(ai.calls[0].model, "deepseek/deepseek-v4-pro");
  assert.deepEqual(ai.calls[0].options, {
    gateway: { id: "morrow-gateway" },
  });
  assert.equal(ai.calls[0].input.response_format.type, "json_object");
  assert.equal(result.source, "ai_gateway");
  assert.equal(result.model, "deepseek/deepseek-v4-pro");
  assert.equal(result.summary, goodJson.summary);
});

test("a reply wrapped in a ```json fence is still parsed", async () => {
  const ai = fakeAi({
    choices: [
      {
        message: {
          content: "```json\n" + JSON.stringify(goodJson) + "\n```",
        },
      },
    ],
  });

  const result = await summarizeChange(ai, priceChange, {
    model: "deepseek/deepseek-v4-pro",
    gatewayId: "morrow-gateway",
  });

  assert.equal(result.source, "ai_gateway");
  assert.equal(result.summary, goodJson.summary);
});

test("bad model setting uses the default model and still summarizes", async () => {
  const ai = fakeAi({ response: goodJson });

  const result = await summarizeChange(ai, priceChange, {
    model: "deepseek/deepseek-v4-pro",
  });

  assert.equal(ai.calls[0].model, DEFAULT_SUMMARY_MODEL);
  assert.equal(result.source, "workers_ai");
});

test("provider error on every model falls back to the template summary", async () => {
  const ai = fakeAi(new Error("7003: upstream failed"));
  const result = await summarizeChange(ai, priceChange, {
    model: "deepseek/deepseek-v4-pro",
    gatewayId: "morrow-gateway",
  });

  assert.equal(ai.calls.length, 2); /* configured model, then the default */
  assert.equal(result.source, "fallback");
  assert.equal(result.model, null);
  assert.match(result.summary, /\$99/);
  assert.match(result.summary, /\$129/);
});

test("unusable reply falls back", async () => {
  for (const reply of [
    null,
    "not json at all",
    { response: "still not json" },
    { response: { summary: "only one field" } },
    { response: { summary: "", why_it_matters: "" } },
    { choices: [] },
  ]) {
    const ai = fakeAi(reply);
    const result = await summarizeChange(ai, priceChange);

    assert.equal(result.source, "fallback", JSON.stringify(reply));
  }
});

test("no AI binding returns the fallback without calling anything", async () => {
  const result = await summarizeChange(undefined, priceChange);

  assert.equal(result.source, "fallback");
  assert.equal(result.model, null);
});

test("overlong model fields are capped at 600 characters", async () => {
  const ai = fakeAi({
    response: {
      summary: "x".repeat(2000),
      why_it_matters: "y".repeat(2000),
    },
  });

  const result = await summarizeChange(ai, priceChange);

  assert.equal(result.summary.length, 600);
  assert.equal(result.whyItMatters.length, 600);
});

/* ---------- the real production setting ---------- */

const PROD = { model: DEEPSEEK_CF, gatewayId: "my-gateway" };

/* A binding whose answer depends on the model asked for. */
function fakeAiByModel(handler) {
  const calls = [];

  return {
    calls,
    async run(model, input, options) {
      calls.push({ model, input, options });
      return handler(model);
    },
  };
}

test("production setting: DeepSeek on Workers AI through my-gateway", async () => {
  const ai = fakeAiByModel(() => ({
    choices: [{ message: { content: JSON.stringify(goodJson) } }],
  }));

  const result = await summarizeChange(ai, priceChange, PROD);

  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].model, DEEPSEEK_CF);
  assert.deepEqual(ai.calls[0].options, { gateway: { id: "my-gateway" } });
  assert.equal(ai.calls[0].input.reasoning_effort, "none");
  assert.equal(result.source, "workers_ai");
  assert.equal(result.model, DEEPSEEK_CF);
  assert.equal(result.summary, goodJson.summary);
});

test("plan error (5035) on the chosen model: the default model answers instead", async () => {
  const ai = fakeAiByModel((model) => {
    if (model === DEEPSEEK_CF) {
      throw new Error(
        "5035: Model is not available on the Workers Free plan."
      );
    }

    return { response: goodJson };
  });

  const result = await summarizeChange(ai, priceChange, PROD);

  assert.deepEqual(
    ai.calls.map((call) => call.model),
    [DEEPSEEK_CF, DEFAULT_SUMMARY_MODEL]
  );
  /* the retry stays on the same gateway so it is logged there too */
  assert.deepEqual(ai.calls[1].options, { gateway: { id: "my-gateway" } });
  assert.equal(result.source, "workers_ai");
  assert.equal(result.model, DEFAULT_SUMMARY_MODEL);
  assert.equal(result.summary, goodJson.summary);
});

test("unusable reply from the chosen model: the default model is tried", async () => {
  const ai = fakeAiByModel((model) =>
    model === DEEPSEEK_CF
      ? { choices: [{ message: { content: "" } }] }
      : { response: goodJson }
  );

  const result = await summarizeChange(ai, priceChange, PROD);

  assert.equal(ai.calls.length, 2);
  assert.equal(result.model, DEFAULT_SUMMARY_MODEL);
});

test("the default model is not retried against itself", async () => {
  const ai = fakeAi(new Error("boom"));
  const result = await summarizeChange(ai, priceChange);

  assert.equal(ai.calls.length, 1);
  assert.equal(result.source, "fallback");
});
