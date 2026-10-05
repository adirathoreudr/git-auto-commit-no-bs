const NVIDIA_NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";

/**
 * Models to try, best first. NVIDIA retires model snapshots regularly (410
 * Gone), so a single hardcoded id eventually takes every repo down. Un-dated
 * aliases come first; non-DeepSeek models are a last resort. Set NVIDIA_MODEL
 * to put a specific model at the front without a code change.
 */
export const DEFAULT_MODELS = [
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
}

/** Attempts (including the first) for transient upstream failures. */
const MAX_ATTEMPTS = 3;
/** Base backoff; delay is BACKOFF_MS * 2^attempt, so ~1s then ~2s. */
const BACKOFF_MS = 1000;

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

/**
 * Asks NIM which models exist and keeps our preferred ones that are listed,
 * followed by any other DeepSeek model. Falls back to DEFAULT_MODELS if the
 * catalog can't be read, so discovery never adds a failure mode of its own.
 */
async function discoverModels(apiKey: string): Promise<string[]> {
  if (discoveredModels) return discoveredModels;
  try {
    const res = await fetch(NVIDIA_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return DEFAULT_MODELS;
    const data = (await res.json()) as { data?: { id?: unknown }[] };
    const ids = new Set(
      (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string")
    );
    const preferred = DEFAULT_MODELS.filter((m) => ids.has(m));
    const otherDeepSeek = [...ids]
      .filter((id) => id.startsWith("deepseek-ai/") && !preferred.includes(id))
      .sort()
      .reverse();
    const models = [...preferred, ...otherDeepSeek];
    if (models.length === 0) return DEFAULT_MODELS;
    discoveredModels = models;
    return models;
  } catch {
    return DEFAULT_MODELS;
  }
}

async function candidateModels(apiKey: string): Promise<string[]> {
  const override = process.env.NVIDIA_MODEL?.trim();
  const ordered = [override, lastGoodModel, ...(await discoverModels(apiKey))];
  return [...new Set(ordered)].filter(
    (m): m is string => !!m && !deadModels.has(m)
  );
}

type ModelOutcome =
  | { kind: "ok"; raw: string }
  | { kind: "unavailable"; error: string }
  | { kind: "failed"; error: string };

/** One model, with retries for transient upstream failures. */
async function callModel(
  model: string,
  apiKey: string,
  userPrompt: string
): Promise<ModelOutcome> {
  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS * 2 ** (attempt - 1));

    let res: Response;
    try {
      res = await fetch(NVIDIA_NIM_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.15,
          max_tokens: 4096,
          // Non-think mode: fast, deterministic output without reasoning
          // preambles polluting the JSON payload. DeepSeek-specific template
          // flag, so other fallback models don't get it.
          ...(model.startsWith("deepseek-ai/")
            ? { chat_template_kwargs: { thinking: false } }
            : {}),
        }),
      });
    } catch (e) {
      // Network-level failure (DNS, socket reset) — worth another attempt.
      lastError = `NVIDIA NIM request failed: ${e instanceof Error ? e.message : String(e)}`;
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      lastError = `NVIDIA NIM API ${res.status}: ${body}`;
      if (isModelUnavailable(res.status, body)) {
        return { kind: "unavailable", error: `HTTP ${res.status}` };
      }
      if (isRetryableStatus(res.status)) continue;
      throw new Error(lastError);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      // Occasionally NIM returns 200 with no completion; treat as transient.
      lastError = `Empty response from ${model}`;
      continue;
    }

    return { kind: "ok", raw };
  }

  return { kind: "failed", error: `${lastError} (after ${MAX_ATTEMPTS} attempts)` };
}

export async function analyzeFile(
  filePath: string,
  fileContent: string,
  apiKeyOverride?: string
): Promise<AIRefactorResult> {
  const apiKey = apiKeyOverride || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("No NVIDIA/DeepSeek API key found. Save one in Settings.");
  }

  const userPrompt = `File: ${filePath}\n\n\`\`\`\n${fileContent}\n\`\`\``;
  const tried: string[] = [];

  for (const model of await candidateModels(apiKey)) {
    const outcome = await callModel(model, apiKey, userPrompt);

    if (outcome.kind === "ok") {
      lastGoodModel = model;
      return parseAIResponse(outcome.raw);
    }
    if (outcome.kind === "failed") throw new Error(outcome.error);

    // Retired or unknown model: remember it so later repos in this run skip
    // it, and move straight on to the next candidate.
    deadModels.add(model);
    if (lastGoodModel === model) lastGoodModel = null;
    tried.push(`${model} (${outcome.error})`);
  }

  throw new Error(
    `No usable NVIDIA NIM model. Tried: ${tried.join(", ") || "none"}. ` +
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
