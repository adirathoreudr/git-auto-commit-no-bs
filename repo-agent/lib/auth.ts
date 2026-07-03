import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import type { User } from "@/generated/prisma/client";

const COOKIE_NAME = "repo_agent_session";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Resolve the currently signed-in user from the session cookie.
 *
 * The cookie only ever holds an opaque, unguessable token that is looked up
 * server-side, so a visitor cannot forge another user's session or read their
 * keys. Returns null when there is no valid session (fresh visitor).
 */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  return prisma.user.findUnique({ where: { sessionToken: token } });
}

/**
 * Persist a workspace for an already-verified GitHub login and set the session
 * cookie for this browser.
 *
 * The login (derived from the pasted PAT via `verifyToken`) is the stable
 * identity: each login maps to exactly one User row with a persistent session
 * token, so pasting the PAT again from any device re-attaches the same
 * workspace. The verified PAT is stored so the daily cron can act on the user's
 * behalf. Kept separate from token verification so callers can report a GitHub
 * failure and a database/session failure distinctly.
 */
export async function createSession(login: string, token: string): Promise<void> {
  const user = await prisma.user.upsert({
    where: { githubLogin: login },
    update: { githubToken: token },
    create: {
      githubLogin: login,
      githubToken: token,
      sessionToken: randomBytes(32).toString("hex"),
    },
  });

  const store = await cookies();
  store.set(COOKIE_NAME, user.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
  });
}

/** Clear the session cookie for the current browser. */
export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
