import { prisma } from "./prisma";
import type { CommitStatus } from "@/generated/prisma/client";

export async function getSettings() {
  return prisma.userSettings.findFirst({
    orderBy: { createdAt: "desc" },
  });
}

/* Save config-only fields (cron + max commits) */
export async function upsertSettings(data: {
  cronSchedule?: string;
  maxCommitsDay?: number;
}) {
  const existing = await getSettings();
  if (existing) {
    return prisma.userSettings.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.userSettings.create({ data });
}

/* Save API keys (plain text in private DB) */
export async function upsertApiKeys(data: {
  githubToken?: string;
  nvidiaApiKey?: string;
}) {
  const existing = await getSettings();
  if (existing) {
    return prisma.userSettings.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.userSettings.create({ data });
}

/* Read stored API keys */
export async function getApiKeys(): Promise<{
  githubToken: string;
  nvidiaApiKey: string;
}> {
  const settings = await getSettings();
  return {
    githubToken: settings?.githubToken ?? "",
    nvidiaApiKey: settings?.nvidiaApiKey ?? "",
  };
}

export async function getEnabledRepos() {
  return prisma.repository.findMany({
    where: { enabled: true },
    orderBy: { fullName: "asc" },
  });
}

export async function getAllRepos() {
  return prisma.repository.findMany({
    orderBy: { fullName: "asc" },
  });
}

export async function upsertRepository(data: {
  owner: string;
  name: string;
  fullName: string;
}) {
  return prisma.repository.upsert({
    where: { fullName: data.fullName },
    update: { owner: data.owner, name: data.name },
    create: data,
  });
}

export async function toggleRepository(fullName: string, enabled: boolean) {
  return prisma.repository.update({
    where: { fullName },
    data: { enabled },
  });
}

export async function updateLastScanned(
  repoId: string,
  sha: string
) {
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

export async function getRecentCommits(limit: number = 50) {
  return prisma.commitLog.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    include: { repository: { select: { fullName: true } } },
  });
}
