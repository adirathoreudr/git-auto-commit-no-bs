"use client";

import { useState, useTransition, useEffect } from "react";
import { loadCommits, type CommitEntry } from "../actions";
import type { CommitStatus } from "@prisma/client";

type Props = { initial: CommitEntry[] };

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
  const [commits, setCommits] = useState<CommitEntry[]>(initial);
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      startTransition(async () => {
        const fresh = await loadCommits(50);
        setCommits(fresh);
      });
    }, 30000);
    return () => clearInterval(t);
  }, []);

  function handleRefresh() {
    startTransition(async () => {
      const fresh = await loadCommits(50);
      setCommits(fresh);
    });
  }

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

      {commits.length === 0 ? (
        <div className="empty-feed">
          <p>AWAITING COMMIT DATA</p>
          <p>ENABLE REPOS → RUN CRON</p>
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
