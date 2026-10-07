const NVIDIA_NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";

/**
 * Models to try, best first. NVIDIA retires model snapshots regularly (410
 * Gone), so a single hardcoded id eventually takes every repo down. These are
 * only preferences: discovery (rankCatalog) also adds whatever DeepSeek and
 * fallback-family chat models the live catalog lists. Set NVIDIA_MODEL to put
 * a specific model at the front without a code change.
 */
export const DEFAULT_MODELS = [
  "deepseek-ai/deepseek-v4.1-flash",
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4",
  "deepseek-ai/deepseek-v3.1-terminus",
  "deepseek-ai/deepseek-v3.1",
  "qwen/qwen3-coder-480b-a35b-instruct",
  "meta/llama-3.3-70b-instruct",
];

/** Models that answered 404/410 in this process; never retried. */
const deadModels = new Set<string>();
/** Last model that produced a completion; tried first on the next call. */
let lastGoodModel: string | null = null;
/** Catalog-filtered candidates from /v1/models, cached once it succeeds. */
let discoveredModels: string[] | null = null;

export function __resetModelCacheForTests(): void {
  deadModels.clear();
  lastGoodModel = null;
  discoveredModels = null;
}

const SYSTEM_PROMPT = `You are a strict, autonomous Git maintenance agent. Your task is to analyze the provided code file and generate ONE minimal, non-breaking improvement.
CONSTRAINTS: Fix typos, add missing docstrings, improve minor formatting, or remove dead code. DO NOT alter business logic, change return types, or modify API endpoints. Max 30 lines changed.
OUTPUT FORMAT: Strictly JSON. No markdown wrappers.
{
  "file_to_change": "string",
  "unified_diff": "string",
  "commit_message": "chore(scope): description",
  "isValid": boolean
}`;

export interface AIRefactorResult {
  file_to_change: string;
  unified_diff: string;
  commit_message: string;
  isValid: boolean;
  /** NIM model that produced this result. */
  model?: string;
}

/** Attempts (including the first) for transient upstream failures. */
const MAX_ATTEMPTS = 3;
/** Base backoff; delay is BACKOFF_MS * 2^attempt, so ~1s then ~2s. */
const BACKOFF_MS = 1000;
/**
 * Responses are streamed so a model is judged on liveness, not total time:
 * NIM's free tier can queue a request for a long while, and a non-streamed
 * answer shows nothing until it's complete, so "stuck" and "nearly done" look
 * identical. A model gets this long to send its first byte...
 */
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 75_000;
/** ...and, once streaming, this long between chunks. */
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DISCOVERY_TIMEOUT_MS = 10_000;
/** Don't start a request with less than this left before the caller's deadline. */
const MIN_REQUEST_BUDGET_MS = 15_000;

const envMs = (name: string, fallback: number) => Number(process.env[name]) || fallback;

const outOfTime = (deadline?: number) =>
  deadline !== undefined && deadline - Date.now() < MIN_REQUEST_BUDGET_MS;

function isTimeout(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Per-attempt timing in the function logs; silent under the test runner. */
function logAttempt(msg: string): void {
  if (!process.env.NODE_TEST_CONTEXT) console.log(`[nim] ${msg}`);
}

/**
 * Transient upstream conditions worth retrying: rate limiting, the shared NIM
 * tier's 529 "Service temporarily overloaded", and ordinary gateway blips.
 * Anything else (401 bad key, 404 unknown model) is a real error and fails fast.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * The model itself is unavailable (retired, renamed, or not enabled for this
 * key) — as opposed to the request or key being bad. Worth trying another model.
 */
function isModelUnavailable(status: number, body: string): boolean {
  if (status === 404 || status === 410) return true;
  return (
    (status === 400 || status === 422) &&
    /model/i.test(body) &&
    /not found|does not exist|end of life|no longer available|deprecated/i.test(body)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Catalog entries that aren't general chat models. */
const NON_CHAT =
  /embed|rerank|guard|safety|reward|vision|vlm|[-_.]vl\d*([-_.]|$)|clip|parse|ocr|asr|tts|whisper|retriever/i;

/**
 * Non-DeepSeek chat families worth falling back to, best first. Matched against
 * the live catalog, so retired ids never make the list.
 */
const FALLBACK_FAMILIES = [
  /^qwen\/qwen3/i,
  /^qwen\/qwen2\.5-coder/i,
  /^openai\/gpt-oss/i,
  /^meta\/llama-4/i,
  /^meta\/llama-3\.3/i,
  /^mistralai\/mistral-large/i,
  /^mistralai\/mixtral/i,
  /^nvidia\/.*nemotron/i,
];
const MAX_FALLBACK_MODELS = 4;

/** Small legacy checkpoints (e.g. deepseek-coder-6.7b) are poor fallbacks. */
function isSmallModel(id: string): boolean {
  const size = id.match(/(\d+(?:\.\d+)?)b(?![a-z])/i);
  return !!size && Number(size[1]) < 30;
}

/**
 * Orders the live catalog: our preferred models that are listed, then other
 * DeepSeek chat models, then one model from each fallback family.
 */
export function rankCatalog(ids: Iterable<string>): string[] {
  // Newest-looking ids first, but always-reasoning variants last: they're slow
  // and wrap their output in thoughts, which is the opposite of what we want.
  const slow = (id: string) => (/thinking|reason/i.test(id) ? 1 : 0);
  const chat = [...new Set(ids)]
    .filter((id) => !NON_CHAT.test(id))
    .sort()
    .reverse()
    .sort((a, b) => slow(a) - slow(b));
  const preferred = DEFAULT_MODELS.filter((m) => chat.includes(m));
  const deepseek = chat.filter(
    (id) => id.startsWith("deepseek-ai/") && !preferred.includes(id) && !isSmallModel(id)
  );
  const fallbacks: string[] = [];
  for (const family of FALLBACK_FAMILIES) {
    if (fallbacks.length >= MAX_FALLBACK_MODELS) break;
    const match = chat.find(
      (id) => family.test(id) && !preferred.includes(id) && !fallbacks.includes(id)
    );
    if (match) fallbacks.push(match);
  }
  return [...preferred, ...deepseek, ...fallbacks];
}

/**
 * Asks NIM which models exist and ranks them. Falls back to DEFAULT_MODELS if
 * the catalog can't be read, so discovery never adds a failure mode of its own.
 */
async function discoverModels(apiKey: string, deadline?: number): Promise<string[]> {
  if (discoveredModels) return discoveredModels;
  const timeoutMs =
    deadline === undefined
      ? envMs("NIM_DISCOVERY_TIMEOUT_MS", DISCOVERY_TIMEOUT_MS)
      : Math.max(1, Math.min(envMs("NIM_DISCOVERY_TIMEOUT_MS", DISCOVERY_TIMEOUT_MS), deadline - Date.now()));
  try {
    const res = await fetch(NVIDIA_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return DEFAULT_MODELS;
    const data = (await res.json()) as { data?: { id?: unknown }[] };
    const ids = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string");
    const models = rankCatalog(ids);
    if (models.length === 0) return DEFAULT_MODELS;
    discoveredModels = models;
    return models;
  } catch {
    return DEFAULT_MODELS;
  }
}

async function candidateModels(apiKey: string, deadline?: number): Promise<string[]> {
  const override = process.env.NVIDIA_MODEL?.trim();
  const ordered = [override, lastGoodModel, ...(await discoverModels(apiKey, deadline))];
  return [...new Set(ordered)].filter(
    (m): m is string => !!m && !deadModels.has(m)
  );
}

/** Reasoning models' "thinking off" switch: DeepSeek reads `thinking`, Qwen3 `enable_thinking`. */
function templateKwargs(model: string) {
  return model.startsWith("deepseek-ai/") || model.startsWith("qwen/")
    ? { chat_template_kwargs: { thinking: false, enable_thinking: false } }
    : {};
}

/**
 * Pulls the completion out of a body that is either an SSE stream of
 * `chat.completion.chunk`s or, for a model that ignored `stream`, plain JSON.
 * Reasoning deltas (`reasoning_content`) are deliberately dropped.
 */
function extractContent(body: string): { content: string; error?: string } {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed) as {
      choices?: { message?: { content?: string } }[];
    };
    return { content: data.choices?.[0]?.message?.content ?? "" };
  }

  let content = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    const chunk = JSON.parse(payload) as {
      error?: unknown;
      choices?: { delta?: { content?: string | null } }[];
    };
    if (chunk.error) return { content, error: JSON.stringify(chunk.error) };
    content += chunk.choices?.[0]?.delta?.content ?? "";
  }
  return { content };
}

type ModelOutcome =
  | { kind: "ok"; raw: string }
  | { kind: "unavailable"; error: string }
  | { kind: "timeout"; error: string }
  | { kind: "failed"; error: string };

interface CallLimits {
  deadline?: number;
  /** Max wait for the first byte; clipped to the deadline. */
  firstTokenMs: number;
}

/** One model, with retries for transient upstream failures. */
async function callModel(
  model: string,
  apiKey: string,
  userPrompt: string,
  { deadline, firstTokenMs }: CallLimits
): Promise<ModelOutcome> {
  const idleMs = envMs("NIM_IDLE_TIMEOUT_MS", DEFAULT_IDLE_TIMEOUT_MS);
  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS * 2 ** (attempt - 1));
    if (outOfTime(deadline)) {
      return { kind: "failed", error: `${lastError} (out of time budget for retries)` };
    }

    // One controller, re-armed as the response progresses: first-byte wait,
    // then the idle gap between chunks — never past the deadline.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeoutReason = "";
    const arm = (ms: number, reason: string) => {
      clearTimeout(timer);
      const capped = deadline === undefined ? ms : Math.min(ms, deadline - Date.now());
      timeoutReason = capped < ms ? "hit the run's time budget" : reason;
      timer = setTimeout(
        () => controller.abort(new DOMException(timeoutReason, "TimeoutError")),
        Math.max(0, capped)
      );
    };
    const aborted = new Promise<never>((_, reject) =>
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
        once: true,
      })
    );
    aborted.catch(() => {});

    const started = Date.now();
    let firstByteAt: number | undefined;
    let ok = false;
    let status = 0;
    let text = "";
    try {
      arm(firstTokenMs, `no response within ${Math.round(firstTokenMs / 1000)}s`);
      const res = await fetch(NVIDIA_NIM_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.15,
          // Diffs are capped at 30 lines; a smaller ceiling keeps slow
          // generations short.
          max_tokens: 2048,
          stream: true,
          // Non-think mode: fast, deterministic output without reasoning
          // preambles polluting the JSON payload.
          ...templateKwargs(model),
        }),
        signal: controller.signal,
      });
      ok = res.ok;
      status = res.status;

      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        try {
          for (;;) {
            // Racing the abort keeps a stalled body from hanging the read even
            // where the stream isn't wired to the request's signal.
            const { value, done } = await Promise.race([reader.read(), aborted]);
            if (done) break;
            if (firstByteAt === undefined) firstByteAt = Date.now();
            text += decoder.decode(value, { stream: true });
            if (/^data:\s*\[DONE\]/m.test(text)) break;
            arm(idleMs, `stream stalled for ${Math.round(idleMs / 1000)}s`);
          }
        } finally {
          reader.cancel().catch(() => {});
        }
      }
    } catch (e) {
      if (isTimeout(e)) {
        const reason = firstByteAt === undefined ? timeoutReason : `${timeoutReason} mid-stream`;
        logAttempt(`${model}: timeout (${reason}) after ${Date.now() - started}ms`);
        return { kind: "timeout", error: `timed out: ${reason}` };
      }
      // Network-level failure (DNS, socket reset) — worth another attempt.
      lastError = `NVIDIA NIM request failed: ${e instanceof Error ? e.message : String(e)}`;
      logAttempt(`${model}: ${lastError}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    const ttfb = firstByteAt === undefined ? "-" : `${firstByteAt - started}ms`;
    logAttempt(`${model}: HTTP ${status} ttfb=${ttfb} total=${Date.now() - started}ms`);

    if (!ok) {
      lastError = `NVIDIA NIM API ${status}: ${text}`;
      if (isModelUnavailable(status, text)) {
        return { kind: "unavailable", error: `HTTP ${status}` };
      }
      if (isRetryableStatus(status)) continue;
      throw new Error(lastError);
    }

    let extracted: { content: string; error?: string };
    try {
      extracted = extractContent(text);
    } catch {
      lastError = `Malformed response from ${model}: ${text.slice(0, 200)}`;
      continue;
    }
    if (extracted.error) {
      lastError = `NVIDIA NIM stream error from ${model}: ${extracted.error}`;
      continue;
    }
    if (!extracted.content) {
      // Occasionally NIM returns 200 with no completion; treat as transient.
      lastError = `Empty response from ${model}`;
      continue;
    }

    return { kind: "ok", raw: extracted.content };
  }

  return { kind: "failed", error: `${lastError} (after ${MAX_ATTEMPTS} attempts)` };
}

export interface AnalyzeOptions {
  /**
   * Epoch ms by which the call must be done (e.g. the cron's function limit).
   * Requests are cut short to fit, and none starts with too little time left.
   */
  deadline?: number;
}

export async function analyzeFile(
  filePath: string,
  fileContent: string,
  apiKeyOverride?: string,
  { deadline }: AnalyzeOptions = {}
): Promise<AIRefactorResult> {
  const apiKey = apiKeyOverride || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("No NVIDIA/DeepSeek API key found. Save one in Settings.");
  }

  const userPrompt = `File: ${filePath}\n\n\`\`\`\n${fileContent}\n\`\`\``;
  const firstTokenMs = envMs("NIM_FIRST_TOKEN_TIMEOUT_MS", DEFAULT_FIRST_TOKEN_TIMEOUT_MS);
  const tried: string[] = [];
  const timedOut: string[] = [];
  const triedSummary = () => tried.join(", ") || "none";

  const attempt = async (model: string, limits: CallLimits) => {
    const outcome = await callModel(model, apiKey, userPrompt, limits);

    if (outcome.kind === "ok") {
      lastGoodModel = model;
      return { ...parseAIResponse(outcome.raw), model };
    }
    if (outcome.kind === "failed") throw new Error(outcome.error);

    tried.push(`${model} (${outcome.error})`);
    if (outcome.kind === "timeout") {
      // A slow model may well answer given more time; see the second pass.
      timedOut.push(model);
    } else {
      // Retired/unknown: remember it so later repos in this run skip it.
      deadModels.add(model);
      if (lastGoodModel === model) lastGoodModel = null;
    }
    return null;
  };

  for (const model of await candidateModels(apiKey, deadline)) {
    if (outOfTime(deadline)) {
      throw new Error(`Out of time budget (cron limit). Tried: ${triedSummary()}.`);
    }
    const result = await attempt(model, { deadline, firstTokenMs });
    if (result) return result;
  }

  // Everything else is exhausted but there may be plenty of the run left:
  // give the models that were merely slow the rest of it, best first.
  if (deadline !== undefined) {
    for (const model of timedOut) {
      if (outOfTime(deadline)) break;
      const result = await attempt(model, { deadline, firstTokenMs: Infinity });
      if (result) return result;
    }
  }

  throw new Error(
    `No usable NVIDIA NIM model. Tried: ${triedSummary()}. ` +
      "Set NVIDIA_MODEL to a model listed at https://build.nvidia.com/models."
  );
}

function parseAIResponse(raw: string): AIRefactorResult {
  let cleaned = raw.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Failed to extract JSON from AI response: ${cleaned.slice(0, 200)}`);
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.file_to_change !== "string") throw new Error("Missing file_to_change in AI response");
  if (typeof obj.unified_diff !== "string") throw new Error("Missing unified_diff in AI response");
  if (typeof obj.commit_message !== "string") throw new Error("Missing commit_message in AI response");
  if (typeof obj.isValid !== "boolean") throw new Error("Missing isValid in AI response");

  return {
    file_to_change: obj.file_to_change,
    unified_diff: obj.unified_diff,
    commit_message: obj.commit_message,
    isValid: obj.isValid,
  };
}

export function countDiffLines(diff: string): number {
  return diff
    .split("\n")
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .filter((line) => !line.startsWith("+++") && !line.startsWith("---"))
    .length;
}

export function validateDiff(result: AIRefactorResult): { valid: boolean; reason?: string } {
  if (!result.isValid) return { valid: false, reason: "AI flagged change as invalid" };
  if (!result.unified_diff || result.unified_diff.trim().length === 0) return { valid: false, reason: "Empty diff" };

  const lines = countDiffLines(result.unified_diff);
  if (lines > 30) return { valid: false, reason: `Diff too large: ${lines} lines (max 30)` };
  if (lines === 0) return { valid: false, reason: "No actual changes in diff" };
  if (!result.commit_message.startsWith("chore")) return { valid: false, reason: "Commit message must start with chore" };

  return { valid: true };
}
