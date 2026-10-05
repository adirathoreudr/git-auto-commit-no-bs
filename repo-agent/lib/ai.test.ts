import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeFile,
  validateDiff,
  DEFAULT_MODELS,
  __resetModelCacheForTests,
} from "./ai.ts";

const GONE_BODY = JSON.stringify({
  type: "about:blank",
  title: "Gone",
  status: 410,
  detail:
    "The model 'deepseek-ai/deepseek-v4-flash-0731' has reached its end of life on 2026-09-21T00:00:00Z and is no longer available.",
});

const AI_JSON = JSON.stringify({
  file_to_change: "src/a.ts",
  unified_diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-cosnt x = 1;\n+const x = 1;",
  commit_message: "chore(a): fix typo",
  isValid: true,
});

const completion = (content = AI_JSON) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

interface Call {
  url: string;
  model?: string;
  body?: Record<string, unknown>;
}

type Handler = (call: Call) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
let calls: Call[];

/** Routes /v1/models to `catalog` (or a 500) and chat calls to `chat`. */
function mockFetch(chat: Handler, catalog?: string[] | Handler) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call: Call = { url, model: body?.model, body };
    calls.push(call);
    if (url.endsWith("/v1/models")) {
      if (typeof catalog === "function") return catalog(call);
      if (!catalog) return new Response("unavailable", { status: 500 });
      return new Response(JSON.stringify({ data: catalog.map((id) => ({ id })) }));
    }
    return chat(call);
  }) as typeof fetch;
}

const chatModels = () => calls.filter((c) => c.model).map((c) => c.model);

beforeEach(() => {
  calls = [];
  __resetModelCacheForTests();
  delete process.env.NVIDIA_MODEL;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.NVIDIA_MODEL;
});

test("410 end-of-life model falls over to the next model instead of failing", async () => {
  process.env.NVIDIA_MODEL = "deepseek-ai/deepseek-v4-flash-0731";
  mockFetch((c) =>
    c.model === "deepseek-ai/deepseek-v4-flash-0731"
      ? new Response(GONE_BODY, { status: 410 })
      : completion()
  );

  const result = await analyzeFile("src/a.ts", "cosnt x = 1;", "key");

  assert.equal(result.commit_message, "chore(a): fix typo");
  assert.deepEqual(chatModels(), ["deepseek-ai/deepseek-v4-flash-0731", DEFAULT_MODELS[0]]);
});

test("discovery picks the first preferred model listed by /v1/models", async () => {
  mockFetch(() => completion(), ["meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-v3.1"]);

  await analyzeFile("a.ts", "x", "key");

  assert.deepEqual(chatModels(), ["deepseek-ai/deepseek-v3.1"]);
});

test("discovery falls back to any listed DeepSeek model, newest first", async () => {
  mockFetch(() => completion(), ["deepseek-ai/deepseek-r1", "deepseek-ai/deepseek-v5"]);

  await analyzeFile("a.ts", "x", "key");

  assert.deepEqual(chatModels(), ["deepseek-ai/deepseek-v5"]);
});

test("unreadable /v1/models falls back to the built-in list", async () => {
  mockFetch(() => completion(), () => {
    throw new Error("socket hang up");
  });

  await analyzeFile("a.ts", "x", "key");

  assert.deepEqual(chatModels(), [DEFAULT_MODELS[0]]);
});

test("NVIDIA_MODEL override is tried first", async () => {
  process.env.NVIDIA_MODEL = "custom/model";
  mockFetch(() => completion(), ["deepseek-ai/deepseek-v4"]);

  await analyzeFile("a.ts", "x", "key");

  assert.deepEqual(chatModels(), ["custom/model"]);
});

test("a dead model is not retried on the next repo in the same run", async () => {
  mockFetch(
    (c) =>
      c.model === "deepseek-ai/deepseek-v4-flash"
        ? new Response(GONE_BODY, { status: 410 })
        : completion(),
    ["deepseek-ai/deepseek-v4-flash", "deepseek-ai/deepseek-v4"]
  );

  await analyzeFile("a.ts", "x", "key");
  calls = [];
  await analyzeFile("b.ts", "y", "key");

  assert.deepEqual(chatModels(), ["deepseek-ai/deepseek-v4"]);
  assert.equal(calls.filter((c) => c.url.endsWith("/v1/models")).length, 0, "catalog is cached");
});

test("404 unknown model also fails over", async () => {
  mockFetch(
    (c) => (c.model === DEFAULT_MODELS[0] ? new Response("Not Found", { status: 404 }) : completion())
  );

  await analyzeFile("a.ts", "x", "key");

  assert.deepEqual(chatModels(), [DEFAULT_MODELS[0], DEFAULT_MODELS[1]]);
});

test("401 bad key fails fast without trying other models", async () => {
  mockFetch(() => new Response("Unauthorized", { status: 401 }));

  await assert.rejects(analyzeFile("a.ts", "x", "key"), /NVIDIA NIM API 401/);
  assert.equal(chatModels().length, 1);
});

test("429 is retried on the same model, then succeeds", async () => {
  let n = 0;
  mockFetch(() => (n++ === 0 ? new Response("slow down", { status: 429 }) : completion()));

  await analyzeFile("a.ts", "x", "key");

  assert.deepEqual(chatModels(), [DEFAULT_MODELS[0], DEFAULT_MODELS[0]]);
});

test("every model retired gives one clear error naming what was tried", async () => {
  mockFetch(() => new Response(GONE_BODY, { status: 410 }));

  await assert.rejects(analyzeFile("a.ts", "x", "key"), (err: Error) => {
    assert.match(err.message, /No usable NVIDIA NIM model/);
    for (const m of DEFAULT_MODELS) assert.ok(err.message.includes(m), m);
    assert.match(err.message, /NVIDIA_MODEL/);
    return true;
  });
  assert.equal(chatModels().length, DEFAULT_MODELS.length);
});

test("thinking flag is only sent to DeepSeek models", async () => {
  mockFetch(
    (c) => (c.model?.startsWith("deepseek-ai/") ? new Response("", { status: 410 }) : completion()),
    ["deepseek-ai/deepseek-v4", "meta/llama-3.3-70b-instruct"]
  );

  await analyzeFile("a.ts", "x", "key");

  const [deepseek, llama] = calls.filter((c) => c.model);
  assert.ok(deepseek.body && "chat_template_kwargs" in deepseek.body);
  assert.ok(llama.body && !("chat_template_kwargs" in llama.body));
});

test("fenced JSON responses are parsed", async () => {
  mockFetch(() => completion("```json\n" + AI_JSON + "\n```"));

  const result = await analyzeFile("a.ts", "x", "key");

  assert.equal(result.file_to_change, "src/a.ts");
});

test("validateDiff rejects oversized diffs and non-chore messages", () => {
  const base = { file_to_change: "a", isValid: true, commit_message: "chore: x" };
  const big = Array.from({ length: 31 }, (_, i) => `+line ${i}`).join("\n");

  assert.deepEqual(validateDiff({ ...base, unified_diff: "-a\n+b" }), { valid: true });
  assert.match(validateDiff({ ...base, unified_diff: big }).reason ?? "", /too large/);
  assert.match(
    validateDiff({ ...base, unified_diff: "-a\n+b", commit_message: "feat: x" }).reason ?? "",
    /chore/
  );
});
