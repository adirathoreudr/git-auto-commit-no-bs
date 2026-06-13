import { loadSettings, loadRepos, loadCommits } from "./actions";
import { SettingsPanel } from "./components/SettingsPanel";
import { RepoGrid } from "./components/RepoGrid";
import { ActivityFeed } from "./components/ActivityFeed";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [settings, repos, commits] = await Promise.all([
    loadSettings(),
    loadRepos(),
    loadCommits(50),
  ]);

  const settingsInitial = settings
    ? {
        githubToken: settings.githubToken,
        deepseekKey: settings.deepseekKey,
        cronSchedule: settings.cronSchedule,
        maxCommitsDay: settings.maxCommitsDay,
      }
    : null;

  return (
    <main className="dashboard">
      <header className="dash-header">
        <div className="dash-logo">
          <span className="logo-glyph">◉</span>
          <span className="logo-text">RepoAgent</span>
        </div>
        <p className="dash-tagline">autonomous refactoring · git-native · vercel-hosted</p>
      </header>

      <div className="dash-body">
        <div className="dash-left">
          <SettingsPanel initial={settingsInitial} />
          <ActivityFeed initial={commits} />
        </div>
        <div className="dash-right">
          <RepoGrid repos={repos} />
        </div>
      </div>
    </main>
  );
}
