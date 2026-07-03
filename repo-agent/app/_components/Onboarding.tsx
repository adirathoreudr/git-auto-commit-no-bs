"use client";

import { useState, useTransition } from "react";
import { login } from "../actions";

export function Onboarding() {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUnlock() {
    setError(null);
    startTransition(async () => {
      const res = await login(token);
      if (res.ok) {
        window.location.reload();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <main className="onboard">
      <div className="onboard-card panel">
        <div className="onboard-brand">
          <div className="logo-pixel" aria-hidden="true">
            {Array.from({ length: 16 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
          <span className="logo-text">REPO_AGENT</span>
        </div>

        <p className="onboard-tag">
          autonomous refactor sys // git-native // vercel-hosted
        </p>

        <div className="onboard-body">
          <p className="onboard-line">
            <span className="boot-caret">&gt;</span> Paste a GitHub personal
            access token to unlock <span className="onboard-hl">your</span>{" "}
            private workspace.
          </p>
          <p className="onboard-line dim">
            <span className="boot-caret">&gt;</span> Your token, keys and repos
            are stored only for you. Nobody else who opens this link can see
            them.
          </p>

          <label className="field-label">GITHUB_TOKEN (PAT)</label>
          <div className="input-row">
            <input
              type={show ? "text" : "password"}
              className="field-input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isPending && handleUnlock()}
              placeholder="ghp_xxxxxx..."
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShow(!show)}
              title={show ? "Hide" : "Show"}
            >
              {show ? "◉" : "○"}
            </button>
          </div>

          {error && <div className="onboard-error">ERR: {error}</div>}

          <button
            type="button"
            className="onboard-btn"
            onClick={handleUnlock}
            disabled={isPending}
          >
            {isPending ? "VERIFYING..." : "UNLOCK_WORKSPACE ▸"}
          </button>

          <p className="onboard-hint">
            Needs <code>repo</code> scope to read and commit. Create one at{" "}
            <span className="onboard-hl">github.com/settings/tokens</span>
          </p>
        </div>
      </div>
    </main>
  );
}
