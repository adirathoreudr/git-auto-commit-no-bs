"use server";

import { revalidatePath } from "next/cache";
import {
  getSettings,
  upsertSettings,
  getAllRepos,
  toggleRepository,
  upsertRepository,
  getRecentCommits,
} from "@/lib/db";
import { listRepos, verifyToken } from "@/lib/github";
import type { CommitStatus } from "@prisma/client";

export type SettingsPayload = {
  githubToken: string;
  deepseekKey: string;
  cronSchedule?: string;
  maxCommitsDay?: number;
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
  if (!payload.githubToken.trim() || !payload.deepseekKey.trim()) {
    return { ok: false, error: "Both tokens are required." };
  }
  try {
    await upsertSettings(payload);
    revalidatePath("/");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function syncRepos(): Promise<ActionResult<number>> {
  const settings = await getSettings();
  if (!settings) {
    return { ok: false, error: "Save your GitHub token first." };
  }
  try {
    const repos = await listRepos(settings.githubToken);
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

export async function verifyGithubToken(
  token: string
): Promise<ActionResult<string>> {
  try {
    const login = await verifyToken(token);
    return { ok: true, data: login };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
