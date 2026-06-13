"use client";

import { useState, useTransition } from "react";
import { syncRepos, setRepoEnabled } from "../actions";

type Repo = {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  enabled: boolean;
  lastScannedAt: Date | null;
};

type Props = {
  repos: Repo[];
};

function relativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function RepoGrid({ repos: initial }: Props) {
  const [repos, setRepos] = useState<Repo[]>(initial);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState(false);
  const [filter, setFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSync() {
    startTransition(async () => {
      const res = await syncRepos();
      if (res.ok) {
        setSyncErr(false);
        setSyncMsg(`Synced ${res.data} repos from GitHub.`);
        setTimeout(() => setSyncMsg(null), 3500);
        window.location.reload();
      } else {
        setSyncErr(true);
        setSyncMsg(res.error);
        setTimeout(() => setSyncMsg(null), 4000);
      }
    });
  }

  function handleToggle(fullName: string, enabled: boolean) {
    setRepos((prev) =>
      prev.map((r) => (r.fullName === fullName ? { ...r, enabled } : r))
    );
    startTransition(async () => {
      const res = await setRepoEnabled(fullName, enabled);
      if (!res.ok) {
        setRepos((prev) =>
          prev.map((r) =>
            r.fullName === fullName ? { ...r, enabled: !enabled } : r
          )
        );
      }
    });
  }

  const filtered = repos.filter((r) =>
    r.fullName.toLowerCase().includes(filter.toLowerCase())
  );
  const enabledCount = repos.filter((r) => r.enabled).length;

  return (
    <section className="repo-section">
      <div className="panel-header">
        <span className="panel-icon">⬡</span>
        <h2 className="panel-title">Repositories</h2>
        <span className="repo-count">
          {enabledCount}/{repos.length} active
        </span>
        <div className="repo-header-actions">
          <input
            type="search"
            className="search-input"
            placeholder="filter repos…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            type="button"
            className="sync-btn"
            onClick={handleSync}
            disabled={isPending}
          >
            {isPending ? "syncing…" : "↻ sync"}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className={`sync-msg ${syncErr ? "err" : "ok"}`}>{syncMsg}</div>
      )}

      {repos.length === 0 ? (
        <div className="empty-repos">
          <p>No repositories found.</p>
          <p>Save your GitHub PAT above then click sync.</p>
        </div>
      ) : (
        <div className="repo-grid">
          {filtered.map((repo) => (
            <div
              key={repo.id}
              className={`repo-card ${repo.enabled ? "enabled" : ""}`}
              onClick={() => handleToggle(repo.fullName, !repo.enabled)}
            >
              <div className="repo-card-top">
                <span className="repo-name">{repo.name}</span>
                <span
                  className={`repo-toggle ${repo.enabled ? "on" : "off"}`}
                  aria-label={repo.enabled ? "Enabled" : "Disabled"}
                />
              </div>
              <div className="repo-card-bottom">
                <span className="repo-owner">{repo.owner}</span>
                {repo.lastScannedAt && (
                  <span className="repo-scanned">
                    scanned {relativeTime(repo.lastScannedAt)}
                  </span>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && filter && (
            <p className="no-match">No repos match "{filter}"</p>
          )}
        </div>
      )}
    </section>
  );
}
