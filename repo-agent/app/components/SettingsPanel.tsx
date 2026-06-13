"use client";

import { useState, useTransition } from "react";
import {
  saveSettings,
  verifyGithubToken,
  type SettingsPayload,
} from "../actions";

type Props = {
  initial: {
    githubToken: string;
    deepseekKey: string;
    cronSchedule: string;
    maxCommitsDay: number;
  } | null;
};

export function SettingsPanel({ initial }: Props) {
  const [githubToken, setGithubToken] = useState(initial?.githubToken ?? "");
  const [deepseekKey, setDeepseekKey] = useState(initial?.deepseekKey ?? "");
  const [cronSchedule, setCronSchedule] = useState(
    initial?.cronSchedule ?? "0 */12 * * *"
  );
  const [maxCommitsDay, setMaxCommitsDay] = useState(
    initial?.maxCommitsDay ?? 1
  );
  const [showGhToken, setShowGhToken] = useState(false);
  const [showDsKey, setShowDsKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"ok" | "err">("ok");
  const [verifiedLogin, setVerifiedLogin] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function flash(msg: string, kind: "ok" | "err") {
    setStatus(msg);
    setStatusKind(kind);
    setTimeout(() => setStatus(null), 3500);
  }

  function handleSave() {
    startTransition(async () => {
      const payload: SettingsPayload = {
        githubToken,
        deepseekKey,
        cronSchedule,
        maxCommitsDay,
      };
      const res = await saveSettings(payload);
      if (res.ok) {
        flash("Settings saved.", "ok");
      } else {
        flash(res.error, "err");
      }
    });
  }

  function handleVerify() {
    startTransition(async () => {
      const res = await verifyGithubToken(githubToken);
      if (res.ok) {
        setVerifiedLogin(res.data);
        flash(`Authenticated as @${res.data}`, "ok");
      } else {
        setVerifiedLogin(null);
        flash(res.error, "err");
      }
    });
  }

  return (
    <section className="settings-panel">
      <div className="panel-header">
        <span className="panel-icon">⚙</span>
        <h2 className="panel-title">Configuration</h2>
        {verifiedLogin && (
          <span className="verified-badge">✓ @{verifiedLogin}</span>
        )}
      </div>

      <div className="fields-grid">
        <div className="field-group">
          <label className="field-label">GitHub PAT</label>
          <div className="input-row">
            <input
              type={showGhToken ? "text" : "password"}
              className="field-input"
              placeholder="ghp_xxxxxxxxxxxx"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              className="toggle-vis"
              onClick={() => setShowGhToken((v) => !v)}
              aria-label="Toggle visibility"
            >
              {showGhToken ? "○" : "●"}
            </button>
            <button
              type="button"
              className="verify-btn"
              onClick={handleVerify}
              disabled={!githubToken || isPending}
            >
              verify
            </button>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">DeepSeek / NVIDIA NIM Key</label>
          <div className="input-row">
            <input
              type={showDsKey ? "text" : "password"}
              className="field-input"
              placeholder="nvapi-xxxxxxxxxxxx"
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              className="toggle-vis"
              onClick={() => setShowDsKey((v) => !v)}
              aria-label="Toggle visibility"
            >
              {showDsKey ? "○" : "●"}
            </button>
          </div>
        </div>

        <div className="field-row-pair">
          <div className="field-group">
            <label className="field-label">Cron Schedule</label>
            <input
              type="text"
              className="field-input mono"
              value={cronSchedule}
              onChange={(e) => setCronSchedule(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Max Commits / Day</label>
            <input
              type="number"
              className="field-input mono"
              min={1}
              max={20}
              value={maxCommitsDay}
              onChange={(e) => setMaxCommitsDay(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="panel-footer">
        {status && (
          <span className={`status-msg ${statusKind === "ok" ? "ok" : "err"}`}>
            {status}
          </span>
        )}
        <button
          type="button"
          className="save-btn"
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? "saving…" : "save settings"}
        </button>
      </div>
    </section>
  );
}
