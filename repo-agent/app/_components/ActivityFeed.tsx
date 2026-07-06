"use client";

import { useState, useTransition, useEffect } from "react";
import { loadCommits, type CommitEntry } from "../actions";
import type { CommitStatus } from "@/generated/prisma/client";

type Props = { initial: CommitEntry[] };

type View = "recent" | "archive";

const GLYPH: Record<CommitStatus, string> = {
  SUCCESS: "OK",
  FAILED:  "!!",
  SKIPPED: "--",
  PENDING: "..",
};

const GLYPH_CLASS: Record<CommitStatus, string> = {
  SUCCESS: "ok",
  FAILED:  "err",
  SKIPPED: "skp",
  PENDING: "pnd",
};

function relTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "0m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function ActivityFeed({ initial }: Props) {
  const [view, setView] = useState<View>("recent");
  const [recent, setRecent] = useState<CommitEntry[]>(initial);
  // null = not fetched yet (archive is loaded lazily on first open)
  const [archive, setArchive] = useState<CommitEntry[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);

  // Auto-refresh only the recent feed; the archive is static history.
  useEffect(() => {
    const t = setInterval(() => {
      startTransition(async () => {
        setRecent(await loadCommits("recent", 50));
      });
    }, 30000);
    return () => clearInterval(t);
  }, []);

  function switchView(next: View) {
    setExpanded(null);
    setView(next);
    if (next === "archive" && archive === null) {
      startTransition(async () => {
        setArchive(await loadCommits("archive", 50));
      });
    }
  }

  function handleRefresh() {
    startTransition(async () => {
      if (view === "recent") setRecent(await loadCommits("recent", 50));
      else setArchive(await loadCommits("archive", 50));
    });
  }

  const commits = view === "recent" ? recent : archive ?? [];
  const loadingArchive = view === "archive" && archive === null;

  const okCount   = commits.filter((c) => c.status === "SUCCESS").length;
  const failCount = commits.filter((c) => c.status === "FAILED").length;

  return (
    <section className="panel panel-inner-corners">
      <div className="panel-header">
        <span className="panel-header-bracket">[</span>
        <span className="panel-header-label">COMMIT_LOG</span>
        <span className="panel-header-bracket">]</span>
        <div className="activity-header-stats">
          <span className="stat-pill ok">{okCount} OK</span>
          <span className="stat-pill fail">{failCount} ERR</span>
        </div>
        <button
          type="button"
          className="refresh-btn"
          onClick={handleRefresh}
          disabled={isPending}
          title="Refresh"
        >
          {isPending ? "…" : "↻"}
        </button>
      </div>

      <div className="feed-tabs">
        <button
          type="button"
          className={`feed-tab ${view === "recent" ? "active" : ""}`}
          onClick={() => switchView("recent")}
        >
          RECENT
        </button>
        <button
          type="button"
          className={`feed-tab ${view === "archive" ? "active" : ""}`}
          onClick={() => switchView("archive")}
        >
          ARCHIVE
        </button>
        <span className="feed-tabs-note">
          {view === "recent" ? "last 2 days" : "older than 2 days"}
        </span>
      </div>

      {loadingArchive ? (
        <div className="empty-feed">
          <p>LOADING ARCHIVE…</p>
        </div>
      ) : commits.length === 0 ? (
        <div className="empty-feed">
          {view === "recent" ? (
            <>
              <p>AWAITING COMMIT DATA</p>
              <p>ENABLE REPOS → RUN CRON</p>
            </>
          ) : (
            <>
              <p>NO ARCHIVED ENTRIES</p>
              <p>OLDER THAN 2 DAYS APPEARS HERE</p>
            </>
          )}
        </div>
      ) : (
        <div className="feed-list">
          {commits.map((c) => (
            <div key={c.id} className="feed-entry">
              <div
                className="feed-entry-main"
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              >
                <span className={`feed-glyph ${GLYPH_CLASS[c.status]}`}>
                  [{GLYPH[c.status]}]
                </span>
                <div className="feed-body">
                  <div className="feed-top">
                    <span className="feed-repo-label">{c.repository.fullName}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>›</span>
                    <span className="feed-file-label">{c.filePath}</span>
                  </div>
                  <div className="feed-msg">{c.commitMessage}</div>
                </div>
                <div className="feed-meta">
                  {c.commitSha && (
                    <span className="feed-sha">{c.commitSha.slice(0, 7)}</span>
                  )}
                  {c.linesChanged > 0 && (
                    <span className="feed-lines">±{c.linesChanged}</span>
                  )}
                  <span className="feed-time">{relTime(c.createdAt)}</span>
                  <span className="feed-expander">
                    {expanded === c.id ? "▲" : "▼"}
                  </span>
                </div>
              </div>

              {expanded === c.id && (
                <div className="feed-detail">
                  {c.errorMessage && (
                    <div className="feed-err-block">{c.errorMessage}</div>
                  )}
                  {c.diffSummary && (
                    <pre className="feed-diff">{c.diffSummary}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
