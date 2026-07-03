import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { verifyToken } from "./github";
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
 * Unlock a workspace by pasting a GitHub PAT.
 *
 * The PAT is verified against GitHub to derive the account's login, which
 * becomes the stable identity. Each login maps to exactly one User row with a
 * persistent session token; pasting the PAT again from any device re-attaches
 * the same workspace. The verified PAT is stored so the daily cron can act on
 * the user's behalf.
 */
export async function loginWithPat(token: string): Promise<string> {
  const login = await verifyToken(token);

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

  return login;
}

/** Clear the session cookie for the current browser. */
export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
