"use server";

import { revalidatePath } from "next/cache";
import {
  getUserSettings,
  upsertSettings,
  upsertApiKeys,
  getAllRepos,
  toggleRepository,
  upsertRepository,
  getRecentCommits,
} from "@/lib/db";
import { getCurrentUser, loginWithPat, logout } from "@/lib/auth";
import { listRepos } from "@/lib/github";
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

const NOT_AUTHED = "Not authenticated. Unlock your workspace first." as const;

/* ── Auth ── */

export async function login(token: string): Promise<ActionResult<string>> {
  const trimmed = token.trim();
  if (!trimmed) return { ok: false, error: "Paste your GitHub token first." };
  try {
    const login = await loginWithPat(trimmed);
    revalidatePath("/");
    return { ok: true, data: login };
  } catch {
    // Never echo the token or raw GitHub error back to the client.
    return { ok: false, error: "Invalid GitHub token, or GitHub is unreachable." };
  }
}

export async function signOut(): Promise<ActionResult> {
  await logout();
  revalidatePath("/");
  return { ok: true, data: undefined };
}

/* ── Settings ── */

export async function loadSettings() {
  const user = await getCurrentUser();
  if (!user) return null;
  return getUserSettings(user.id);
}

export async function saveSettings(
  payload: SettingsPayload
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: NOT_AUTHED };
  try {
    await upsertSettings(user.id, payload);
    revalidatePath("/");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function saveApiKeys(
  payload: ApiKeysPayload
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: NOT_AUTHED };
  try {
    await upsertApiKeys(user.id, payload);
    revalidatePath("/");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/* ── Repositories ── */

export async function syncRepos(): Promise<ActionResult<number>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: NOT_AUTHED };

  const token = user.githubToken;
  if (!token) {
    return { ok: false, error: "No GitHub token found. Save one in Settings." };
  }
  try {
    const repos = await listRepos(token);
    for (const repo of repos) {
      await upsertRepository(user.id, {
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
      });
    }
    revalidatePath("/");
    return { ok: true, data: repos.length };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function loadRepos() {
  const user = await getCurrentUser();
  if (!user) return [];
  return getAllRepos(user.id);
}

export async function setRepoEnabled(
  fullName: string,
  enabled: boolean
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: NOT_AUTHED };
  try {
    await toggleRepository(user.id, fullName, enabled);
    revalidatePath("/");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/* ── Commit log ── */

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
  const user = await getCurrentUser();
  if (!user) return [];
  const rows = await getRecentCommits(user.id, limit ?? 50);
  return rows as CommitEntry[];
}

export async function checkEnvStatus() {
  const user = await getCurrentUser();
  return {
    githubPat: !!user?.githubToken,
    nvidiaApiKey: !!user?.nvidiaApiKey,
    githubLogin: user?.githubLogin ?? null,
  };
}
