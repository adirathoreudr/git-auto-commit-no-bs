"use client";

import { useState, useTransition } from "react";
import { saveSettings, saveApiKeys, type SettingsPayload } from "../actions";

type Props = {
  initial: {
    cronSchedule: string;
    maxCommitsDay: number;
  } | null;
  envStatus: {
    githubPat: boolean;
    nvidiaApiKey: boolean;
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
  const [githubToken, setGithubToken] = useState("");
  const [nvidiaApiKey, setNvidiaApiKey] = useState("");
  const [showGithub, setShowGithub] = useState(false);
  const [showNvidia, setShowNvidia] = useState(false);
  const [flash, setFlash] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [keyFlash, setKeyFlash] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [isPending, startTransition] = useTransition();

  function showFlashMsg(msg: string, kind: "ok" | "err", setter: typeof setFlash) {
    setter({ msg, kind });
    setTimeout(() => setter(null), 3500);
  }

  function handleSave() {
    startTransition(async () => {
      const payload: SettingsPayload = { cronSchedule, maxCommitsDay };
      const res = await saveSettings(payload);
      if (res.ok) showFlashMsg("// CONFIG SAVED OK", "ok", setFlash);
      else showFlashMsg(`ERR: ${res.error}`, "err", setFlash);
    });
  }

  function handleSaveKeys() {
    if (!githubToken && !nvidiaApiKey) {
      showFlashMsg("ENTER AT LEAST ONE KEY", "err", setKeyFlash);
      return;
    }
    startTransition(async () => {
      const payload: Record<string, string> = {};
      if (githubToken) payload.githubToken = githubToken;
      if (nvidiaApiKey) payload.nvidiaApiKey = nvidiaApiKey;
      const res = await saveApiKeys(payload);
      if (res.ok) {
        showFlashMsg("// KEYS SAVED SECURELY", "ok", setKeyFlash);
        setGithubToken("");
        setNvidiaApiKey("");
      } else {
        showFlashMsg(`ERR: ${res.error}`, "err", setKeyFlash);
      }
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
        {/* ── API Key Status ── */}
        <div className="env-status-card">
          <div className="env-status-title">
            <span className="env-lock-icon">🔒</span>
            <span className="panel-header-label" style={{ color: "var(--crt-green)" }}>
              API KEY STATUS
            </span>
          </div>
          <div className="env-status-rows">
            <div className="env-row">
              <span className="env-row-key">GITHUB_TOKEN</span>
              <span className={`env-row-val ${envStatus.githubPat ? "ok" : "err"}`}>
                {envStatus.githubPat
                  ? `[SET]${envStatus.githubLogin ? ` @${envStatus.githubLogin}` : ""}`
                  : "[MISSING]"}
              </span>
            </div>
            <div className="env-row">
              <span className="env-row-key">NVIDIA_API_KEY</span>
              <span className={`env-row-val ${envStatus.nvidiaApiKey ? "ok" : "err"}`}>
                {envStatus.nvidiaApiKey ? "[SET]" : "[MISSING]"}
              </span>
            </div>
          </div>
        </div>

        {/* ── API Key Inputs ── */}
        <div className="key-input-card">
          <div className="field-group">
            <label className="field-label">GITHUB_TOKEN (PAT)</label>
            <div className="input-row">
              <input
                type={showGithub ? "text" : "password"}
                className="field-input"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder={envStatus.githubPat ? "••••••• (already set)" : "ghp_xxxxxx..."}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowGithub(!showGithub)}
                title={showGithub ? "Hide" : "Show"}
              >
                {showGithub ? "◉" : "○"}
              </button>
            </div>
          </div>
          <div className="field-group">
            <label className="field-label">NVIDIA_API_KEY</label>
            <div className="input-row">
              <input
                type={showNvidia ? "text" : "password"}
                className="field-input"
                value={nvidiaApiKey}
                onChange={(e) => setNvidiaApiKey(e.target.value)}
                placeholder={envStatus.nvidiaApiKey ? "••••••• (already set)" : "nvapi-xxxxxx..."}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowNvidia(!showNvidia)}
                title={showNvidia ? "Hide" : "Show"}
              >
                {showNvidia ? "◉" : "○"}
              </button>
            </div>
          </div>
          <div className="key-save-row">
            {keyFlash && (
              <span className={`flash-msg ${keyFlash.kind}`}>{keyFlash.msg}</span>
            )}
            <button
              type="button"
              className="save-btn key-save-btn"
              onClick={handleSaveKeys}
              disabled={isPending}
            >
              {isPending ? "SAVING..." : "SAVE_KEYS"}
            </button>
          </div>
        </div>

        {/* ── Config Fields ── */}
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
