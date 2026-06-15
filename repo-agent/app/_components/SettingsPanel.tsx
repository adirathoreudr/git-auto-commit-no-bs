"use client";

import { useState, useTransition } from "react";
import { saveSettings, type SettingsPayload } from "../actions";

type Props = {
  initial: {
    cronSchedule: string;
    maxCommitsDay: number;
  } | null;
  envStatus: {
    githubPat: boolean;
    deepseekKey: boolean;
    githubLogin: string | null;
  };
};

export function SettingsPanel({ initial, envStatus }: Props) {
  const [cronSchedule, setCronSchedule] = useState(
    initial?.cronSchedule ?? "0 */12 * * *"
  );
  const [maxCommitsDay, setMaxCommitsDay] = useState(
    initial?.maxCommitsDay ?? 1
  );
  const [flash, setFlash] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [isPending, startTransition] = useTransition();

  function showFlash(msg: string, kind: "ok" | "err") {
    setFlash({ msg, kind });
    setTimeout(() => setFlash(null), 3500);
  }

  function handleSave() {
    startTransition(async () => {
      const payload: SettingsPayload = { cronSchedule, maxCommitsDay };
      const res = await saveSettings(payload);
      if (res.ok) showFlash("// CONFIG SAVED OK", "ok");
      else showFlash(`ERR: ${res.error}`, "err");
    });
  }

  return (
    <section className="panel panel-inner-corners">
      <div className="panel-header">
        <span className="panel-header-bracket">[</span>
        <span className="panel-header-label">SYS_CONFIG</span>
        <span className="panel-header-bracket">]</span>
        <span className="panel-header-num">01</span>
      </div>

      <div className="settings-body">
        <div className="env-status-card">
          <div className="env-status-title">
            <span className="env-lock-icon">🔒</span>
            <span className="panel-header-label" style={{ color: "var(--crt-green)" }}>
              API KEYS SECURED VIA VERCEL ENV
            </span>
          </div>
          <div className="env-status-rows">
            <div className="env-row">
              <span className="env-row-key">GITHUB_PAT</span>
              <span className={`env-row-val ${envStatus.githubPat ? "ok" : "err"}`}>
                {envStatus.githubPat
                  ? `[SET]${envStatus.githubLogin ? ` @${envStatus.githubLogin}` : ""}`
                  : "[MISSING]"}
              </span>
            </div>
            <div className="env-row">
              <span className="env-row-key">DEEPSEEK_API_KEY</span>
              <span className={`env-row-val ${envStatus.deepseekKey ? "ok" : "err"}`}>
                {envStatus.deepseekKey ? "[SET]" : "[MISSING]"}
              </span>
            </div>
          </div>
        </div>

        <div className="field-row-pair">
          <div className="field-group">
            <label className="field-label">CRON_EXPR</label>
            <input
              type="text"
              className="field-input"
              value={cronSchedule}
              onChange={(e) => setCronSchedule(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="field-group">
            <label className="field-label">MAX_COMMITS/DAY</label>
            <input
              type="number"
              className="field-input"
              min={1}
              max={20}
              value={maxCommitsDay}
              onChange={(e) => setMaxCommitsDay(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="panel-footer">
        {flash && (
          <span className={`flash-msg ${flash.kind}`}>{flash.msg}</span>
        )}
        <button
          type="button"
          className="save-btn"
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? "WRITING..." : "WRITE_CFG"}
        </button>
      </div>
    </section>
  );
}
