import { NextResponse } from "next/server";
import {
  getSettings,
  getEnabledRepos,
  getCommitsToday,
  createCommitLog,
  updateLastScanned,
} from "@/lib/db";
import { fetchTree, fetchFileContent, createCommit, applyUnifiedDiff } from "@/lib/github";
import { analyzeFile, validateDiff } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface CronResult {
  repo: string;
  status: string;
  message: string;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getSettings();
  if (!settings) {
    return NextResponse.json({ error: "No settings configured" }, { status: 400 });
  }

  const repos = await getEnabledRepos();
  if (repos.length === 0) {
    return NextResponse.json({ message: "No enabled repos" });
  }

  const results: CronResult[] = [];

  for (const repo of repos) {
    try {
      const todayCount = await getCommitsToday(repo.id);
      if (todayCount >= settings.maxCommitsDay) {
        results.push({
          repo: repo.fullName,
          status: "skipped",
          message: `Daily limit reached (${todayCount}/${settings.maxCommitsDay})`,
        });
        continue;
      }

      const { sha, files } = await fetchTree(
        settings.githubToken,
        repo.owner,
        repo.name
      );

      if (files.length === 0) {
        results.push({
          repo: repo.fullName,
          status: "skipped",
          message: "No eligible files found",
        });
        continue;
      }

      const randomIndex = Math.floor(Math.random() * files.length);
      const targetFile = files[randomIndex];

      const content = await fetchFileContent(
        settings.githubToken,
        repo.owner,
        repo.name,
        targetFile.sha
      );

      const aiResult = await analyzeFile(
        settings.deepseekKey,
        targetFile.path,
        content
      );

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

        results.push({
          repo: repo.fullName,
          status: "skipped",
          message: validation.reason || "Invalid diff",
        });
        continue;
      }

      const newContent = applyUnifiedDiff(content, aiResult.unified_diff);

      const commitResult = await createCommit(
        settings.githubToken,
        repo.owner,
        repo.name,
        "main",
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

      results.push({
        repo: repo.fullName,
        status: "success",
        message: `Committed ${commitResult.sha.slice(0, 7)}: ${aiResult.commit_message}`,
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
        repo: repo.fullName,
        status: "failed",
        message: errMsg,
      });
    }
  }

  return NextResponse.json({ results, timestamp: new Date().toISOString() });
}
