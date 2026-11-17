import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SUMMARY_MODEL,
  SUMMARY_SYSTEM_PROMPT,
  buildDirectDeepSeekRequest,
  parseDirectModel,
  resolveSummaryModel,
  summarizeChange,
} from "../worker/change-summarizer.ts";

const MODEL = "deepseek-direct/deepseek-flash";
const TOKEN = "aig-test-token-0123456789";
const BASE = "https://gateway.ai.cloudflare.com/v1/acct123/my-gateway/deepseek";

const OPTIONS = {
  model: MODEL,
  gatewayId: "my-gateway",
  gatewayToken: TOKEN,
};

const priceChange = {
  category: "pricing",
  significance: "major",
  classificationConfidence: 0.9,
  classificationReasons: [],
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

const goodJson = {
  summary: "The Pro plan price went from $99 to $129 per month.",
  why_it_matters: "A $30 rise may make rivals look cheaper.",
};

/* A fake AI binding: records run() calls and gateway URL requests. */
function fakeAi({ withGateway = true, base = BASE } = {}) {
  const calls = [];
  const urlRequests = [];

  const ai = {
    calls,
    urlRequests,
    async run(model, input, options) {
      calls.push({ model, input, options });
      return { response: goodJson };
    },
  };

  if (withGateway) {
    ai.gateway = (gatewayId) => ({
      async getUrl(provider) {
        urlRequests.push({ gatewayId, provider });
        return base;
      },
    });
  }

  return ai;
}

/* Replaces fetch for one test and records what was sent. */
async function withFetch(handler, body) {
  const original = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return handler(url, init);
  };

  try {
    await body(requests);
  } finally {
    globalThis.fetch = original;
  }
}

/* Collects everything the code logs, to prove the token never appears. */
async function captureLogs(body) {
  const lines = [];
  const originals = {
    error: console.error,
    warn: console.warn,
  };

  console.error = (...args) => lines.push(JSON.stringify(args));
  console.warn = (...args) => lines.push(JSON.stringify(args));

  try {
    await body();
  } finally {
    console.error = originals.error;
    console.warn = originals.warn;
  }

  return lines.join("\n");
}

const okReply = (content) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            reasoning_content: "not shown to anyone",
            content,
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

/* ---------- parsing and settings ---------- */

test("parseDirectModel reads the provider and the provider's model name", () => {
  assert.deepEqual(parseDirectModel(MODEL), {
    provider: "deepseek",
    providerModel: "deepseek-flash",
  });
});

test("parseDirectModel ignores everything that is not a direct model", () => {
  for (const value of [
    "deepseek/deepseek-v4-pro",
    "@cf/meta/llama-3.1-8b-instruct-fast",
    "deepseek-direct/",
    "deepseek-direct",
    "other-direct/model",
    "",
  ]) {
    assert.equal(parseDirectModel(value), null, value);
  }
});

test("a direct model with a gateway and a token resolves to the direct route", () => {
  const resolved = resolveSummaryModel(OPTIONS);

  assert.equal(resolved.warning, null);
  assert.equal(resolved.model, MODEL);
  assert.equal(resolved.gatewayId, "my-gateway");
  assert.equal(resolved.isWorkersAiModel, false);
  assert.deepEqual(resolved.direct, {
    provider: "deepseek",
    providerModel: "deepseek-flash",
    token: TOKEN,
  });
});

test("a missing, blank or malformed token falls back with a warning", () => {
  for (const gatewayToken of [undefined, null, "", "   ", "short", "has space inside"]) {
    const resolved = resolveSummaryModel({ ...OPTIONS, gatewayToken });

    assert.equal(resolved.model, DEFAULT_SUMMARY_MODEL, String(gatewayToken));
    assert.equal(resolved.direct, null);
    assert.match(resolved.warning, /CF_AIG_TOKEN/);
    assert.doesNotMatch(resolved.warning, new RegExp(TOKEN));
  }
});

test("a direct model without a gateway falls back with a warning", () => {
  const resolved = resolveSummaryModel({ ...OPTIONS, gatewayId: "" });

  assert.equal(resolved.model, DEFAULT_SUMMARY_MODEL);
  assert.equal(resolved.direct, null);
  assert.match(resolved.warning, /MORROW_AI_GATEWAY_ID is not set/);
});

test("ordinary models never carry a direct route", () => {
  for (const model of ["deepseek/deepseek-v4-pro", "@cf/deepseek-ai/deepseek-v4.1-flash-1017"]) {
    const resolved = resolveSummaryModel({ ...OPTIONS, model });

    assert.equal(resolved.direct, null, model);
  }
});

/* ---------- the request DeepSeek receives ---------- */

test("the DeepSeek request turns thinking off and asks for JSON", () => {
  const request = buildDirectDeepSeekRequest("deepseek-flash", "{\"x\":1}");

  assert.equal(request.model, "deepseek-flash");
  assert.deepEqual(request.thinking, { type: "disabled" });
  assert.deepEqual(request.response_format, { type: "json_object" });
  assert.equal(request.max_tokens, 1000);
  assert.equal("reasoning_effort" in request, false);
});

test("the DeepSeek request carries the full prompt, with the word JSON present", () => {
  const request = buildDirectDeepSeekRequest("deepseek-flash", "USER INPUT");
  const roles = request.messages.map((message) => message.role);

  assert.deepEqual(roles, [
    "system",
    "user", "assistant",
    "user", "assistant",
    "user", "assistant",
    "user",
  ]);
  assert.equal(request.messages[0].content, SUMMARY_SYSTEM_PROMPT);
  assert.equal(request.messages.at(-1).content, "USER INPUT");
  /* DeepSeek's JSON mode requires the word "json" in the prompt */
  assert.match(request.messages[0].content, /json/i);
});

/* ---------- the call itself ---------- */

test("direct call: right URL, gateway token, no provider key, reply parsed", async () => {
  const ai = fakeAi();

  await withFetch(
    () => okReply(JSON.stringify(goodJson)),
    async (requests) => {
      const result = await summarizeChange(ai, priceChange, OPTIONS);

      assert.equal(ai.calls.length, 0, "env.AI.run must not be used");
      assert.deepEqual(ai.urlRequests, [
        { gatewayId: "my-gateway", provider: "deepseek" },
      ]);

      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, `${BASE}/chat/completions`);
      assert.equal(requests[0].init.method, "POST");

      const headers = requests[0].init.headers;

      assert.equal(headers["cf-aig-authorization"], `Bearer ${TOKEN}`);
      assert.equal(headers["cf-aig-no-wholesale"], "true");
      assert.equal(headers["content-type"], "application/json");
      /* sending a provider key would stop the gateway using the stored one */
      for (const name of Object.keys(headers)) {
        assert.notEqual(name.toLowerCase(), "authorization");
        assert.notEqual(name.toLowerCase(), "x-api-key");
      }

      const body = JSON.parse(requests[0].init.body);

      assert.equal(body.model, "deepseek-flash");
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.ok(requests[0].init.signal instanceof AbortSignal);

      assert.equal(result.source, "ai_gateway");
      assert.equal(result.model, MODEL);
      assert.equal(result.summary, goodJson.summary);
      assert.equal(result.whyItMatters, goodJson.why_it_matters);
    }
  );
});

test("a trailing slash on the gateway URL does not double up", async () => {
  const ai = fakeAi({ base: `${BASE}/` });

  await withFetch(
    () => okReply(JSON.stringify(goodJson)),
    async (requests) => {
      await summarizeChange(ai, priceChange, OPTIONS);

      assert.equal(requests[0].url, `${BASE}/chat/completions`);
    }
  );
});

test("a reply wrapped in a ```json fence is still parsed", async () => {
  const ai = fakeAi();

  await withFetch(
    () => okReply("```json\n" + JSON.stringify(goodJson) + "\n```"),
    async () => {
      const result = await summarizeChange(ai, priceChange, OPTIONS);

      assert.equal(result.source, "ai_gateway");
      assert.equal(result.summary, goodJson.summary);
    }
  );
});

/* ---------- failures fall back to Llama, never to nothing ---------- */

const expectLlamaFallback = (ai, result) => {
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].model, DEFAULT_SUMMARY_MODEL);
  assert.deepEqual(ai.calls[0].options, { gateway: { id: "my-gateway" } });
  assert.equal(result.source, "workers_ai");
  assert.equal(result.model, DEFAULT_SUMMARY_MODEL);
  assert.equal(result.summary, goodJson.summary);
};

test("gateway refuses (no stored key, HTTP 400): Llama answers instead", async () => {
  const ai = fakeAi();

  await withFetch(
    () =>
      new Response(
        JSON.stringify({ error: [{ code: 2044, message: "Provider credentials required" }] }),
        { status: 400 }
      ),
    async () => {
      const result = await summarizeChange(ai, priceChange, OPTIONS);

      expectLlamaFallback(ai, result);
    }
  );
});

test("bad gateway token (HTTP 401): Llama answers instead", async () => {
  const ai = fakeAi();

  await withFetch(
    () => new Response("Unauthorized", { status: 401 }),
    async () => {
      expectLlamaFallback(ai, await summarizeChange(ai, priceChange, OPTIONS));
    }
  );
});

test("network failure or timeout: Llama answers instead", async () => {
  const ai = fakeAi();

  await withFetch(
    () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    },
    async () => {
      expectLlamaFallback(ai, await summarizeChange(ai, priceChange, OPTIONS));
    }
  );
});

test("DeepSeek returns only spaces (its non-JSON signal): Llama answers instead", async () => {
  const ai = fakeAi();

  await withFetch(
    () => okReply("      "),
    async () => {
      expectLlamaFallback(ai, await summarizeChange(ai, priceChange, OPTIONS));
    }
  );
});

test("a reply that is not JSON at all: Llama answers instead", async () => {
  const ai = fakeAi();

  await withFetch(
    () => new Response("<html>oops</html>", { status: 200 }),
    async () => {
      expectLlamaFallback(ai, await summarizeChange(ai, priceChange, OPTIONS));
    }
  );
});

test("a binding without gateway(): Llama answers and fetch is never called", async () => {
  const ai = fakeAi({ withGateway: false });

  await withFetch(
    () => okReply(JSON.stringify(goodJson)),
    async (requests) => {
      const result = await summarizeChange(ai, priceChange, OPTIONS);

      assert.equal(requests.length, 0);
      expectLlamaFallback(ai, result);
    }
  );
});

test("no token configured: nothing is sent to the gateway, Llama answers", async () => {
  const ai = fakeAi();

  await withFetch(
    () => okReply(JSON.stringify(goodJson)),
    async (requests) => {
      const result = await summarizeChange(ai, priceChange, {
        ...OPTIONS,
        gatewayToken: undefined,
      });

      assert.equal(requests.length, 0);
      assert.equal(ai.urlRequests.length, 0);
      expectLlamaFallback(ai, result);
    }
  );
});

test("everything failing still returns the template summary, not an error", async () => {
  const ai = fakeAi();

  ai.run = async () => {
    throw new Error("down");
  };

  await withFetch(
    () => new Response("nope", { status: 500 }),
    async () => {
      const result = await summarizeChange(ai, priceChange, OPTIONS);

      assert.equal(result.source, "fallback");
      assert.equal(result.model, null);
      assert.ok(result.summary.length > 0);
    }
  );
});

/* ---------- secrets ---------- */

test("the gateway token never appears in logs, even when every call fails", async () => {
  const ai = fakeAi();

  await withFetch(
    () => new Response("denied", { status: 401 }),
    async () => {
      const logs = await captureLogs(() =>
        summarizeChange(ai, priceChange, OPTIONS)
      );

      assert.ok(logs.length > 0, "failure should be logged");
      assert.doesNotMatch(logs, new RegExp(TOKEN));
    }
  );
});

test("the token never leaks into a missing-token warning either", async () => {
  const ai = fakeAi();

  const logs = await captureLogs(() =>
    summarizeChange(ai, priceChange, { ...OPTIONS, gatewayToken: "has space" })
  );

  assert.match(logs, /CF_AIG_TOKEN/);
  assert.doesNotMatch(logs, /has space/);
});
