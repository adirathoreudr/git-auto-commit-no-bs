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

type Props = { repos: Repo[] };

function relTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RepoGrid({ repos: initial }: Props) {
  const [repos, setRepos] = useState<Repo[]>(initial);
  const [syncMsg, setSyncMsg] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [filter, setFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSync() {
    startTransition(async () => {
      const res = await syncRepos();
      if (res.ok) {
        setSyncMsg({ msg: `>> SYNCED ${res.data} REPOS FROM ORIGIN`, kind: "ok" });
        setTimeout(() => setSyncMsg(null), 4000);
        window.location.reload();
      } else {
        setSyncMsg({ msg: `ERR: ${res.error}`, kind: "err" });
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
    <section className="panel panel-inner-corners">
      <div className="panel-header">
        <span className="panel-header-bracket">[</span>
        <span className="panel-header-label">REPO_INDEX</span>
        <span className="panel-header-bracket">]</span>
        <span className="panel-header-num">02</span>
      </div>

      <div className="repo-controls">
        <span className="repo-count-chip">
          {enabledCount}/{repos.length} ACTIVE
        </span>
        <input
          type="search"
          className="search-input"
          placeholder="> filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          type="button"
          className="sync-btn"
          onClick={handleSync}
          disabled={isPending}
        >
          {isPending ? "SYNCING..." : "FETCH_REPOS"}
        </button>
      </div>

      {syncMsg && (
        <div className={`sync-flash ${syncMsg.kind}`}>{syncMsg.msg}</div>
      )}

      {repos.length === 0 ? (
        <div className="empty-repos">
          <p>NO REPOS FOUND</p>
          <p>SAVE PAT → FETCH_REPOS</p>
        </div>
      ) : (
        <div className="repo-grid-wrap">
          {filtered.map((repo) => (
            <div
              key={repo.id}
              className={`repo-card ${repo.enabled ? "enabled" : ""}`}
              onClick={() => handleToggle(repo.fullName, !repo.enabled)}
            >
              <div className="repo-card-top">
                <span className="repo-name">{repo.name}</span>
                <span
                  className={`pixel-toggle ${repo.enabled ? "on" : "off"}`}
                  aria-label={repo.enabled ? "Enabled" : "Disabled"}
                />
              </div>
              <div className="repo-card-bottom">
                <span className="repo-owner">{repo.owner}/</span>
                {repo.lastScannedAt && (
                  <span className="repo-scanned">
                    {relTime(repo.lastScannedAt)}
                  </span>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && filter && (
            <p style={{ padding: "16px", color: "var(--text-muted)", fontSize: "10px", fontFamily: "var(--font-mono)" }}>
              NO MATCH: "{filter}"
            </p>
          )}
        </div>
      )}
    </section>
  );
}
