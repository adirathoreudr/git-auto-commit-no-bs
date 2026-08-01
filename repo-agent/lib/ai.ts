const NVIDIA_NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "deepseek-ai/deepseek-v4-flash";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.15,
          max_tokens: 4096,
          // Non-think mode: fast, deterministic output without reasoning
          // preambles polluting the JSON payload.
          chat_template_kwargs: { thinking: false },
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
      if (isRetryableStatus(res.status)) continue;
      throw new Error(lastError);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      // Occasionally NIM returns 200 with no completion; treat as transient.
      lastError = "Empty response from DeepSeek";
      continue;
    }

    return parseAIResponse(raw);
  }

  throw new Error(`${lastError} (after ${MAX_ATTEMPTS} attempts)`);
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
