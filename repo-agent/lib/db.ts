import { prisma } from "./prisma";
import type { CommitStatus } from "@/generated/prisma/client";

/* ── User settings (config + keys live on the User row) ── */

export async function getUserSettings(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

/* Save config-only fields (cron + max commits) for a user */
export async function upsertSettings(
  userId: string,
  data: {
    cronSchedule?: string;
    maxCommitsDay?: number;
  }
) {
  return prisma.user.update({ where: { id: userId }, data });
}

/* Save API keys for a user (plain text in their private DB row) */
export async function upsertApiKeys(
  userId: string,
  data: {
    githubToken?: string;
    nvidiaApiKey?: string;
  }
) {
  return prisma.user.update({ where: { id: userId }, data });
}

/* Read a user's stored API keys */
export async function getApiKeys(userId: string): Promise<{
  githubToken: string;
  nvidiaApiKey: string;
}> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return {
    githubToken: user?.githubToken ?? "",
    nvidiaApiKey: user?.nvidiaApiKey ?? "",
  };
}

/* ── Repositories (scoped to a user) ── */

export async function getEnabledRepos(userId: string) {
  return prisma.repository.findMany({
    where: { userId, enabled: true },
    orderBy: { fullName: "asc" },
  });
}

export async function getAllRepos(userId: string) {
  return prisma.repository.findMany({
    where: { userId },
    orderBy: { fullName: "asc" },
  });
}

export async function upsertRepository(
  userId: string,
  data: {
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  }
) {
  return prisma.repository.upsert({
    where: { userId_fullName: { userId, fullName: data.fullName } },
    update: {
      owner: data.owner,
      name: data.name,
      defaultBranch: data.defaultBranch,
    },
    create: { ...data, userId },
  });
}

export async function toggleRepository(
  userId: string,
  fullName: string,
  enabled: boolean
) {
  return prisma.repository.update({
    where: { userId_fullName: { userId, fullName } },
    data: { enabled },
  });
}

export async function updateLastScanned(repoId: string, sha: string) {
  return prisma.repository.update({
    where: { id: repoId },
    data: { lastScannedAt: new Date(), lastScannedSha: sha },
  });
}

export async function getCommitsToday(repositoryId: string) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  return prisma.commitLog.count({
    where: {
      repositoryId,
      status: "SUCCESS",
      createdAt: { gte: startOfDay },
    },
  });
}

export async function createCommitLog(data: {
  repositoryId: string;
  filePath: string;
  commitSha?: string;
  commitMessage: string;
  diffSummary: string;
  linesChanged: number;
  status: CommitStatus;
  errorMessage?: string;
}) {
  return prisma.commitLog.create({ data });
}

/**
 * Entries older than this drop out of the default "recent" feed and into the
 * archive. Nothing is deleted — the split is purely by age so the feed stays
 * tidy while full history remains one click away.
 */
export const ARCHIVE_AFTER_DAYS = 2;

export type CommitScope = "recent" | "archive";

export async function getCommits(
  userId: string,
  scope: CommitScope = "recent",
  limit: number = 50
) {
  const cutoff = new Date(
    Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000
  );

  return prisma.commitLog.findMany({
    where: {
      repository: { userId },
      createdAt: scope === "recent" ? { gte: cutoff } : { lt: cutoff },
    },
    take: limit,
    orderBy: { createdAt: "desc" },
    include: { repository: { select: { fullName: true } } },
  });
}

/* ── Cron: every user with a complete key pair ── */

export async function getUsersReadyForCron() {
  return prisma.user.findMany({
    where: {
      githubToken: { not: "" },
      nvidiaApiKey: { not: "" },
      repositories: { some: { enabled: true } },
    },
  });
}
