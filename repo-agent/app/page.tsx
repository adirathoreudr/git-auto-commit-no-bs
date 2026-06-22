import { loadSettings, loadRepos, loadCommits, checkEnvStatus } from "./actions";
import { SettingsPanel } from "./_components/SettingsPanel";
import { RepoGrid } from "./_components/RepoGrid";
import { ActivityFeed } from "./_components/ActivityFeed";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
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

        <div className="dash-status-bar">
          <span className="status-dot">ONLINE</span>
          <span
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "8px",
              color: "var(--text-muted)",
              letterSpacing: "0.05em",
            }}
          >
            {enabledCount} REPOS ACTIVE · {totalCommits} COMMITS LOGGED
          </span>
        </div>
      </header>

      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          color: "var(--text-muted)",
          marginBottom: "20px",
          letterSpacing: "0.04em",
          borderLeft: "2px solid var(--crt-green-border)",
          paddingLeft: "10px",
          lineHeight: "1.8",
        }}
      >
        <span style={{ color: "var(--crt-green)", opacity: 0.7 }}>&gt;</span>{" "}
        SYSTEM BOOT OK. NVIDIA NIM ENGINE READY. CRON SCHEDULER ARMED.
        <br />
        <span style={{ color: "var(--crt-green)", opacity: 0.7 }}>&gt;</span>{" "}
        CONFIGURE CRON. SELECT TARGETS. WATCH THE AGENT WORK.
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

      <footer
        style={{
          marginTop: "32px",
          paddingTop: "12px",
          borderTop: "1px solid var(--border-dim)",
          fontFamily: "var(--font-pixel)",
          fontSize: "7px",
          color: "var(--text-muted)",
          letterSpacing: "0.08em",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>REPO_AGENT v0.5.0</span>
        <span>DEEPSEEK-R1 · GITHUB REST API · VERCEL CRON</span>
        <span style={{ color: "var(--crt-green)", opacity: 0.4 }}>
          ▓▒░ CTRL_YOUR_CODE ░▒▓
        </span>
      </footer>
    </main>
  );
}
