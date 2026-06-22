"use server";

import { revalidatePath } from "next/cache";
import {
  getSettings,
  upsertSettings,
  upsertApiKeys,
  getApiKeys,
  getAllRepos,
  toggleRepository,
  upsertRepository,
  getRecentCommits,
} from "@/lib/db";
import { listRepos, verifyToken } from "@/lib/github";
import type { CommitStatus } from "@/generated/prisma/client";

export type SettingsPayload = {
  cronSchedule?: string;
  maxCommitsDay?: number;
};

export type ApiKeysPayload = {
  githubToken?: string;
  nvidiaApiKey?: string;
};

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function loadSettings() {
  return getSettings();
}

export async function saveSettings(
  payload: SettingsPayload
): Promise<ActionResult> {
  try {
    await upsertSettings(payload);
    revalidatePath("/");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function saveApiKeys(
  payload: ApiKeysPayload
): Promise<ActionResult> {
  try {
    await upsertApiKeys(payload);
    revalidatePath("/");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function syncRepos(): Promise<ActionResult<number>> {
  /* Try DB-stored key first, fall back to env */
  const keys = await getApiKeys();
  const token = keys.githubToken || process.env.GITHUB_PAT;
  if (!token) {
    return { ok: false, error: "No GitHub token found. Save one in Settings." };
  }
  try {
    const repos = await listRepos(token);
    for (const repo of repos) {
      await upsertRepository({
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
      });
    }
    revalidatePath("/");
    return { ok: true, data: repos.length };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function loadRepos() {
  return getAllRepos();
}

export async function setRepoEnabled(
  fullName: string,
  enabled: boolean
): Promise<ActionResult> {
  try {
    await toggleRepository(fullName, enabled);
    revalidatePath("/");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export type CommitEntry = {
  id: string;
  filePath: string;
  commitSha: string | null;
  commitMessage: string;
  diffSummary: string;
  linesChanged: number;
  status: CommitStatus;
  errorMessage: string | null;
  createdAt: Date;
  repository: { fullName: string };
};

export async function loadCommits(limit?: number): Promise<CommitEntry[]> {
  const rows = await getRecentCommits(limit ?? 50);
  return rows as CommitEntry[];
}

export async function checkEnvStatus() {
  const keys = await getApiKeys();
  const githubPat = keys.githubToken || process.env.GITHUB_PAT;
  const nvidiaApiKey = keys.nvidiaApiKey || process.env.DEEPSEEK_API_KEY; // keep old env var for backward compat

  return {
    githubPat: !!githubPat,
    nvidiaApiKey: !!nvidiaApiKey,
    githubLogin: null,
  };
}