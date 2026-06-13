"use client";

import { useState, useTransition, useEffect } from "react";
import { loadCommits, type CommitEntry } from "../actions";
import type { CommitStatus } from "@prisma/client";

type Props = {
  initial: CommitEntry[];
};

const STATUS_GLYPH: Record<CommitStatus, string> = {
  SUCCESS: "✓",
  FAILED: "✕",
  SKIPPED: "⊘",
  PENDING: "◌",
};

const STATUS_CLASS: Record<CommitStatus, string> = {
  SUCCESS: "status-success",
  FAILED: "status-failed",
  SKIPPED: "status-skipped",
  PENDING: "status-pending",
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

export function ActivityFeed({ initial }: Props) {
  const [commits, setCommits] = useState<CommitEntry[]>(initial);
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      startTransition(async () => {
        const fresh = await loadCommits(50);
        setCommits(fresh);
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  function handleRefresh() {
    startTransition(async () => {
      const fresh = await loadCommits(50);
      setCommits(fresh);
    });
  }

  const successCount = commits.filter((c) => c.status === "SUCCESS").length;
  const failedCount = commits.filter((c) => c.status === "FAILED").length;

  return (
    <section className="activity-section">
      <div className="panel-header">
        <span className="panel-icon">◈</span>
        <h2 className="panel-title">Activity</h2>
        <div className="activity-stats">
          <span className="stat-chip ok">{successCount} ok</span>
          <span className="stat-chip fail">{failedCount} fail</span>
        </div>
        <button
          type="button"
          className="refresh-btn"
          onClick={handleRefresh}
          disabled={isPending}
          title="Refresh feed"
        >
          {isPending ? "…" : "↻"}
        </button>
      </div>

      {commits.length === 0 ? (
        <div className="empty-feed">
          <p>No activity yet.</p>
          <p>Enable repositories and wait for the cron to run.</p>
        </div>
      ) : (
        <div className="feed-list">
          {commits.map((c) => (
            <div key={c.id} className="feed-item">
              <div
                className="feed-item-main"
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              >
                <span
                  className={`feed-status-glyph ${STATUS_CLASS[c.status]}`}
                >
                  {STATUS_GLYPH[c.status]}
                </span>
                <div className="feed-item-body">
                  <div className="feed-item-top">
                    <span className="feed-repo">{c.repository.fullName}</span>
                    <span className="feed-file">{c.filePath}</span>
                  </div>
                  <div className="feed-item-msg">{c.commitMessage}</div>
                </div>
                <div className="feed-item-meta">
                  {c.commitSha && (
                    <span className="feed-sha">
                      {c.commitSha.slice(0, 7)}
                    </span>
                  )}
                  <span className="feed-lines">
                    {c.linesChanged > 0 ? `±${c.linesChanged}` : ""}
                  </span>
                  <span className="feed-time">
                    {relativeTime(c.createdAt)}
                  </span>
                  <span className="feed-expand-indicator">
                    {expanded === c.id ? "▲" : "▼"}
                  </span>
                </div>
              </div>

              {expanded === c.id && (
                <div className="feed-item-detail">
                  {c.errorMessage && (
                    <div className="feed-error">{c.errorMessage}</div>
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
