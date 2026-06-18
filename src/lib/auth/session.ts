import "server-only";

import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

import type { AuthPermissions, AuthSessionData } from "@/lib/auth/types";

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

export function canUseAdminAccess(session: AuthSessionData) {
  return Boolean(
    session.address &&
      session.permissions?.canAdmin &&
      session.viewMode !== "member",
  );
}

export function canUseRaidAccountingAccess(session: AuthSessionData) {
  return Boolean(
    session.address &&
      session.permissions?.canWriteRaidAccounting &&
      session.viewMode !== "member",
  );
}

export function serializeSession(session: AuthSessionData) {
  const canUseMemberView = Boolean(session.permissions?.canAdmin);
  const viewMode: "admin" | "member" =
    canUseMemberView && session.viewMode === "member" ? "member" : "admin";
  const memberViewRoles: AuthPermissions["roles"] = ["member"];
  const permissions: AuthPermissions | null =
    session.permissions && viewMode === "member"
      ? {
          ...session.permissions,
          canAdmin: false,
          canWriteRaidAccounting: false,
          roles: memberViewRoles,
        }
      : (session.permissions ?? null);

  return {
    address: session.address ?? null,
    authenticated: Boolean(session.address && permissions?.canAccess),
    canUseMemberView,
    chainId: session.chainId ?? null,
    permissions,
    viewMode,
  };
}
