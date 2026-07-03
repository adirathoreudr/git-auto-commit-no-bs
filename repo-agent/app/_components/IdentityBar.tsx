"use client";

import { useTransition } from "react";
import { signOut } from "../actions";

type Props = {
  login: string | null;
  enabledCount: number;
  totalCommits: number;
};

export function IdentityBar({ login, enabledCount, totalCommits }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await signOut();
      window.location.reload();
    });
  }

  return (
    <div className="dash-status-bar">
      <span className="status-dot">ONLINE</span>
      <span className="dash-stats">
        {enabledCount} REPOS ACTIVE · {totalCommits} COMMITS LOGGED
      </span>
      {login && <span className="identity-chip">@{login}</span>}
      <button
        type="button"
        className="logout-btn"
        onClick={handleSignOut}
        disabled={isPending}
        title="Sign out of this workspace"
      >
        {isPending ? "..." : "LOGOUT"}
      </button>
    </div>
  );
}
