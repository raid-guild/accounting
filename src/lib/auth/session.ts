import "server-only";

import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

import type { AuthSessionData } from "@/lib/auth/types";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function getSessionPassword() {
  const password = process.env.SESSION_SECRET;

  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }

  return password;
}

export function getSessionOptions(): SessionOptions {
  return {
    cookieName: "raidguild-accounting-session",
    password: getSessionPassword(),
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  };
}

export async function getAuthSession() {
  return getIronSession<AuthSessionData>(
    await cookies(),
    getSessionOptions(),
  );
}

export function serializeSession(session: AuthSessionData) {
  return {
    address: session.address ?? null,
    authenticated: Boolean(session.address && session.permissions?.canAccess),
    chainId: session.chainId ?? null,
    permissions: session.permissions ?? null,
  };
}
