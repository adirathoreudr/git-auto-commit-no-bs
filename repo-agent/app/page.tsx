import { loadSettings, loadRepos, loadCommits, checkEnvStatus } from "./actions";
import { getCurrentUser } from "@/lib/auth";
import { SettingsPanel } from "./_components/SettingsPanel";
import { RepoGrid } from "./_components/RepoGrid";
import { ActivityFeed } from "./_components/ActivityFeed";
import { Onboarding } from "./_components/Onboarding";
import { IdentityBar } from "./_components/IdentityBar";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  // No session -> show the onboarding gate. A fresh visitor never sees
  // another user's repos, keys or commit log.
  if (!user) {
    return <Onboarding />;
  }

  const [settings, repos, commits, envStatus] = await Promise.all([
    loadSettings(),
    loadRepos(),
    loadCommits(50),
    checkEnvStatus(),
  ]);

  const settingsInitial = settings
    ? {
        cronSchedule: settings.cronSchedule,
        maxCommitsDay: settings.maxCommitsDay,
      }
    : null;

  const enabledCount = repos.filter((r) => r.enabled).length;
  const totalCommits = commits.length;

  return (
    <main className="dashboard">
      <header className="dash-header">
        <div className="dash-logo">
          <div className="logo-pixel" aria-hidden="true">
            {Array.from({ length: 16 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
          <span className="logo-text">REPO_AGENT</span>
        </div>

        <span className="dash-tagline">
          autonomous refactor sys // git-native // vercel-hosted
        </span>

        <IdentityBar
          login={envStatus.githubLogin}
          enabledCount={enabledCount}
          totalCommits={totalCommits}
        />
      </header>

      <div className="dash-boot">
        <span className="boot-caret">&gt;</span> SESSION UNLOCKED FOR{" "}
        <span className="boot-user">@{envStatus.githubLogin}</span>. NVIDIA NIM
        ENGINE READY. CRON SCHEDULER ARMED.
        <br />
        <span className="boot-caret">&gt;</span> CONFIGURE CRON. SELECT TARGETS.
        WATCH THE AGENT WORK.
      </div>

      <div className="dash-body">
        <div className="dash-left">
          <SettingsPanel initial={settingsInitial} envStatus={envStatus} />
          <ActivityFeed initial={commits} />
        </div>
        <div className="dash-right">
          <RepoGrid repos={repos} />
        </div>
      </div>

      <footer className="dash-footer">
        <span>REPO_AGENT v0.6.0</span>
        <span>DEEPSEEK-R1 · GITHUB REST API · VERCEL CRON</span>
        <span className="footer-sig">▓▒░ CTRL_YOUR_CODE ░▒▓</span>
      </footer>
    </main>
  );
}
