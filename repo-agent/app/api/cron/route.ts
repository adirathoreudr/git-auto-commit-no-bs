import { NextResponse } from "next/server";
import {
  getUsersReadyForCron,
  getEnabledRepos,
  getCommitsToday,
  createCommitLog,
  updateLastScanned,
} from "@/lib/db";
import { fetchTree, fetchFileContent, createCommit, applyUnifiedDiff } from "@/lib/github";
import { analyzeFile, validateDiff } from "@/lib/ai";
import type { Repository } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface CronResult {
  user: string;
  repo: string;
  status: string;
  message: string;
}

async function processRepo(
  repo: Repository,
  githubToken: string,
  nvidiaApiKey: string,
  maxCommitsDay: number
): Promise<{ status: string; message: string }> {
  const todayCount = await getCommitsToday(repo.id);
  if (todayCount >= maxCommitsDay) {
    return {
      status: "skipped",
      message: `Daily limit reached (${todayCount}/${maxCommitsDay})`,
    };
  }

  const branch = repo.defaultBranch || "main";

  const { sha, files } = await fetchTree(
    githubToken,
    repo.owner,
    repo.name,
    branch
  );

  if (files.length === 0) {
    return { status: "skipped", message: "No eligible files found" };
  }

  const targetFile = files[Math.floor(Math.random() * files.length)];

  const content = await fetchFileContent(
    githubToken,
    repo.owner,
    repo.name,
    targetFile.sha
  );

  const aiResult = await analyzeFile(targetFile.path, content, nvidiaApiKey);

  const validation = validateDiff(aiResult);
  if (!validation.valid) {
    await createCommitLog({
      repositoryId: repo.id,
      filePath: targetFile.path,
      commitMessage: aiResult.commit_message || "N/A",
      diffSummary: aiResult.unified_diff || "",
      linesChanged: 0,
      status: "SKIPPED",
      errorMessage: validation.reason,
    });
    return { status: "skipped", message: validation.reason || "Invalid diff" };
  }

  // Apply the diff strictly. If it does not match the file cleanly, skip the
  // commit rather than pushing a corrupted file that would break the repo's
  // build. A no-op result is skipped too.
  let newContent: string;
  try {
    newContent = applyUnifiedDiff(content, aiResult.unified_diff);
  } catch (e) {
    const reason = `Diff did not apply cleanly: ${e instanceof Error ? e.message : String(e)}`;
    await createCommitLog({
      repositoryId: repo.id,
      filePath: targetFile.path,
      commitMessage: aiResult.commit_message || "N/A",
      diffSummary: aiResult.unified_diff || "",
      linesChanged: 0,
      status: "SKIPPED",
      errorMessage: reason,
    });
    return { status: "skipped", message: reason };
  }

  if (newContent === content) {
    await createCommitLog({
      repositoryId: repo.id,
      filePath: targetFile.path,
      commitMessage: aiResult.commit_message || "N/A",
      diffSummary: aiResult.unified_diff || "",
      linesChanged: 0,
      status: "SKIPPED",
      errorMessage: "Diff produced no change",
    });
    return { status: "skipped", message: "No effective change" };
  }

  const commitResult = await createCommit(
    githubToken,
    repo.owner,
    repo.name,
    branch,
    targetFile.path,
    newContent,
    aiResult.commit_message
  );

  await createCommitLog({
    repositoryId: repo.id,
    filePath: targetFile.path,
    commitSha: commitResult.sha,
    commitMessage: aiResult.commit_message,
    diffSummary: aiResult.unified_diff,
    linesChanged: aiResult.unified_diff
      .split("\n")
      .filter(
        (l) =>
          (l.startsWith("+") || l.startsWith("-")) &&
          !l.startsWith("+++") &&
          !l.startsWith("---")
      ).length,
    status: "SUCCESS",
  });

  await updateLastScanned(repo.id, sha);

  return {
    status: "success",
    message: `Committed ${commitResult.sha.slice(0, 7)}: ${aiResult.commit_message}`,
  };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Every user with both keys set and at least one enabled repo runs
  // independently against their own token, key and daily limit.
  const users = await getUsersReadyForCron();
  if (users.length === 0) {
    return NextResponse.json({ message: "No users ready for cron" });
  }

  const results: CronResult[] = [];

  for (const user of users) {
    const repos = await getEnabledRepos(user.id);

    for (const repo of repos) {
      try {
        const outcome = await processRepo(
          repo,
          user.githubToken,
          user.nvidiaApiKey,
          user.maxCommitsDay
        );
        results.push({
          user: user.githubLogin,
          repo: repo.fullName,
          ...outcome,
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        await createCommitLog({
          repositoryId: repo.id,
          filePath: "unknown",
          commitMessage: "N/A",
          diffSummary: "",
          linesChanged: 0,
          status: "FAILED",
          errorMessage: errMsg,
        }).catch(() => {});
        results.push({
          user: user.githubLogin,
          repo: repo.fullName,
          status: "failed",
          message: errMsg,
        });
      }
    }
  }

  return NextResponse.json({ results, timestamp: new Date().toISOString() });
}
