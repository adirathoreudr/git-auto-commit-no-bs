import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeFile,
  validateDiff,
  DEFAULT_MODELS,
  rankCatalog,
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

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sseLine = (delta: Record<string, unknown>) =>
  `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index: 0, delta }] })}\n\n`;

/**
 * A streamed NIM completion: `content` split into `parts` chunks, `gapMs`
 * apart. With `stallAfter`, the stream goes silent after that many chunks.
 */
function sse(
  content = AI_JSON,
  { parts = 4, gapMs = 0, stallAfter, reasoning }: {
    parts?: number;
    gapMs?: number;
    stallAfter?: number;
    reasoning?: string;
  } = {}
) {
  const size = Math.ceil(content.length / parts);
  const pieces = Array.from({ length: parts }, (_, i) => content.slice(i * size, (i + 1) * size));
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(ctrl) {
        if (reasoning) ctrl.enqueue(enc.encode(sseLine({ reasoning_content: reasoning })));
        for (const [i, piece] of pieces.entries()) {
          if (stallAfter !== undefined && i >= stallAfter) return; // never closes
          if (gapMs) await tick(gapMs);
          ctrl.enqueue(enc.encode(sseLine({ content: piece })));
        }
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

interface Call {
  url: string;
  model?: string;
  body?: Record<string, unknown>;
}

type Handler = (call: Call) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
let calls: Call[];

/** Rejects when `signal` aborts, the way real fetch does. */
const aborted = (signal?: AbortSignal | null) =>
  new Promise<never>((_, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

/** A request NIM never answers. */
const hang = () => new Promise<Response>(() => {});

/** Routes /v1/models to `catalog` (or a 500) and chat calls to `chat`. */
function mockFetch(chat: Handler, catalog?: string[] | Handler) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // AbortSignal.timeout timers are unref'd; a real socket keeps the process
    // alive while a request is pending, so the mock has to as well.
    const keepAlive = setInterval(() => {}, 1000);
    try {
      return await Promise.race([route(input, init), aborted(init?.signal)]);
    } finally {
      clearInterval(keepAlive);
    }
  }) as typeof fetch;

  async function route(input: RequestInfo | URL, init?: RequestInit) {
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
  }
}

const chatModels = () => calls.filter((c) => c.model).map((c) => c.model);

const ENV = [
  "NVIDIA_MODEL",
  "NIM_FIRST_TOKEN_TIMEOUT_MS",
  "NIM_IDLE_TIMEOUT_MS",
  "NIM_DISCOVERY_TIMEOUT_MS",
];

beforeEach(() => {
  calls = [];
  __resetModelCacheForTests();
  for (const k of ENV) delete process.env[k];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) delete process.env[k];
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

test("thinking-off flags go to DeepSeek and Qwen models only", async () => {
  mockFetch(
    (c) => (c.model?.startsWith("qwen/") ? completion() : new Response("", { status: 410 })),
    ["deepseek-ai/deepseek-v4", "qwen/qwen3-next-80b-a3b-instruct", "meta/llama-3.3-70b-instruct"]
  );

  await analyzeFile("a.ts", "x", "key");

  const sent = (prefix: string) => calls.find((c) => c.model?.startsWith(prefix));
  const [deepseek, qwen, llama] = [sent("deepseek-ai/"), sent("qwen/"), sent("meta/")];
  const off = { thinking: false, enable_thinking: false };
  assert.deepEqual(deepseek.body?.chat_template_kwargs, off);
  assert.deepEqual(qwen.body?.chat_template_kwargs, off);
  assert.ok(llama.body && !("chat_template_kwargs" in llama.body));
});

test("a model that never answers is abandoned for the next one", async () => {
  process.env.NIM_FIRST_TOKEN_TIMEOUT_MS = "50";
  mockFetch((c) => (c.model === DEFAULT_MODELS[0] ? hang() : completion()));

  const result = await analyzeFile("a.ts", "x", "key");

  assert.equal(result.model, DEFAULT_MODELS[1]);
  assert.deepEqual(chatModels(), [DEFAULT_MODELS[0], DEFAULT_MODELS[1]]);
});

test("a timed-out model is not blacklisted for the next repo", async () => {
  process.env.NIM_FIRST_TOKEN_TIMEOUT_MS = "50";
  let run = 1;
  mockFetch((c) => {
    if (run === 1 && c.model === DEFAULT_MODELS[0]) return hang();
    if (run === 2 && c.model === DEFAULT_MODELS[1]) return new Response("", { status: 410 });
    return completion();
  });

  await analyzeFile("a.ts", "x", "key");
  run = 2;
  calls = [];
  const result = await analyzeFile("b.ts", "y", "key");

  // Last good model goes first; once it's retired the slow one is tried again.
  assert.deepEqual(chatModels(), [DEFAULT_MODELS[1], DEFAULT_MODELS[0]]);
  assert.equal(result.model, DEFAULT_MODELS[0]);
});

test("every model hanging ends in an error, not a hung cron run", async () => {
  process.env.NIM_FIRST_TOKEN_TIMEOUT_MS = "20";
  mockFetch(() => hang());

  await assert.rejects(analyzeFile("a.ts", "x", "key"), /timed out/);
  assert.equal(chatModels().length, DEFAULT_MODELS.length);
});

test("no request starts once the deadline is too close", async () => {
  mockFetch(() => completion());

  await assert.rejects(
    analyzeFile("a.ts", "x", "key", { deadline: Date.now() + 1000 }),
    /Out of time budget/
  );
  assert.equal(chatModels().length, 0);
});

test("a stalled catalog lookup falls back to the built-in list", async () => {
  process.env.NIM_DISCOVERY_TIMEOUT_MS = "50";
  mockFetch(() => completion(), () => hang());

  const result = await analyzeFile("a.ts", "x", "key");

  assert.equal(result.model, DEFAULT_MODELS[0]);
});

test("streamed chunks are assembled and reasoning deltas ignored", async () => {
  mockFetch(() => sse(AI_JSON, { parts: 7, reasoning: "Let me think about this file..." }));

  const result = await analyzeFile("a.ts", "x", "key");

  assert.equal(result.commit_message, "chore(a): fix typo");
  assert.equal(calls.find((c) => c.model)?.body?.stream, true);
});

test("a slow but steadily streaming model is not cut off", async () => {
  // Total time (8 x 40ms) is well past the first-token and idle limits; the
  // model is alive the whole time, so it gets to finish.
  process.env.NIM_FIRST_TOKEN_TIMEOUT_MS = "100";
  process.env.NIM_IDLE_TIMEOUT_MS = "100";
  mockFetch(() => sse(AI_JSON, { parts: 8, gapMs: 40 }));

  const result = await analyzeFile("a.ts", "x", "key");

  assert.equal(result.model, DEFAULT_MODELS[0]);
  assert.equal(chatModels().length, 1);
});

test("a stream that stalls mid-answer moves on to the next model", async () => {
  process.env.NIM_IDLE_TIMEOUT_MS = "50";
  mockFetch((c) =>
    c.model === DEFAULT_MODELS[0] ? sse(AI_JSON, { parts: 4, stallAfter: 2 }) : sse()
  );

  const result = await analyzeFile("a.ts", "x", "key");

  assert.equal(result.model, DEFAULT_MODELS[1]);
});

test("models that only timed out get a second, patient pass with the time left", async () => {
  // Today's failure: the one real model was slow, the rest 404'd, and the run
  // quit with minutes to spare.
  process.env.NIM_FIRST_TOKEN_TIMEOUT_MS = "50";
  let firstTry = true;
  mockFetch((c) => {
    if (c.model !== DEFAULT_MODELS[0]) return new Response("Not Found", { status: 404 });
    if (firstTry) {
      firstTry = false;
      return hang();
    }
    return tick(120).then(() => sse()); // slower than the first-token limit
  });

  const result = await analyzeFile("a.ts", "x", "key", { deadline: Date.now() + 60_000 });

  assert.equal(result.model, DEFAULT_MODELS[0]);
  const models = chatModels();
  assert.equal(models[0], DEFAULT_MODELS[0]);
  assert.equal(models.at(-1), DEFAULT_MODELS[0]);
  assert.equal(models.length, DEFAULT_MODELS.length + 1);
});

test("catalog ranking matches today's NIM catalog shape", () => {
  const ranked = rankCatalog([
    "deepseek-ai/deepseek-coder-6.7b-instruct",
    "deepseek-ai/deepseek-v4.1-flash",
    "deepseek-ai/deepseek-vl2",
    "meta/llama-4-maverick-17b-128e-instruct",
    "nvidia/nv-embedqa-e5-v5",
    "qwen/qwen3-next-80b-a3b-instruct",
    "qwen/qwen3-next-80b-a3b-thinking",
  ]);

  assert.deepEqual(ranked, [
    "deepseek-ai/deepseek-v4.1-flash",
    "qwen/qwen3-next-80b-a3b-instruct",
    "meta/llama-4-maverick-17b-128e-instruct",
  ]);
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
