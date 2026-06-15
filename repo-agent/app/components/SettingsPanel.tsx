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
  const [showGh, setShowGh] = useState(false);
  const [showDs, setShowDs] = useState(false);
  const [flash, setFlash] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [verifiedLogin, setVerifiedLogin] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function showFlash(msg: string, kind: "ok" | "err") {
    setFlash({ msg, kind });
    setTimeout(() => setFlash(null), 3500);
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
      if (res.ok) showFlash("// CONFIG SAVED OK", "ok");
      else showFlash(`ERR: ${res.error}`, "err");
    });
  }

  function handleVerify() {
    startTransition(async () => {
      const res = await verifyGithubToken(githubToken);
      if (res.ok) {
        setVerifiedLogin(res.data);
        showFlash(`AUTH OK >> @${res.data}`, "ok");
      } else {
        setVerifiedLogin(null);
        showFlash(`AUTH FAIL: ${res.error}`, "err");
      }
    });
  }

  return (
    <section className="panel panel-inner-corners">
      <div className="panel-header">
        <span className="panel-header-bracket">[</span>
        <span className="panel-header-label">SYS_CONFIG</span>
        <span className="panel-header-bracket">]</span>
        {verifiedLogin && (
          <span className="verified-badge">@{verifiedLogin}</span>
        )}
        <span className="panel-header-num">01</span>
      </div>

      <div className="settings-body">
        <div className="field-group">
          <label className="field-label">GITHUB_PAT</label>
          <div className="input-row">
            <input
              type={showGh ? "text" : "password"}
              className="field-input"
              placeholder="ghp_xxxxxxxxxxxx"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowGh((v) => !v)}
              aria-label="Toggle visibility"
              title={showGh ? "Hide" : "Show"}
            >
              {showGh ? "○" : "●"}
            </button>
            <button
              type="button"
              className="verify-btn"
              onClick={handleVerify}
              disabled={!githubToken || isPending}
            >
              VERIFY
            </button>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">DEEPSEEK_KEY / NIM_API</label>
          <div className="input-row">
            <input
              type={showDs ? "text" : "password"}
              className="field-input"
              placeholder="nvapi-xxxxxxxxxxxx"
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowDs((v) => !v)}
              aria-label="Toggle visibility"
            >
              {showDs ? "○" : "●"}
            </button>
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
