import { NextResponse } from "next/server";

import { getAuthSession, serializeSession } from "@/lib/auth/session";
import type { AuthPermissions, AuthRole } from "@/lib/auth/types";

type E2ESessionRequest = {
  role?: unknown;
};

const E2E_WALLET_ADDRESS = "0x0000000000000000000000000000000000000e2e";

function isE2EAuthEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_ENABLED === "true"
  );
}

function getPermissions(role: AuthRole): AuthPermissions {
  if (role === "admin") {
    return {
      canAccess: true,
      canAdmin: true,
      canWriteRaidAccounting: true,
      roles: ["admin", "cleric", "member"],
    };
  }

  if (role === "cleric") {
    return {
      canAccess: true,
      canAdmin: false,
      canWriteRaidAccounting: true,
      roles: ["cleric"],
    };
  }

  return {
    canAccess: true,
    canAdmin: false,
    canWriteRaidAccounting: false,
    roles: ["member"],
  };
}

function parseRole(value: unknown): AuthRole | null {
  return value === "admin" || value === "cleric" || value === "member"
    ? value
    : null;
}

export async function POST(request: Request) {
  if (!isE2EAuthEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | E2ESessionRequest
    | null;
  const role = parseRole(body?.role);

  if (!role) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const session = await getAuthSession();

  session.address = E2E_WALLET_ADDRESS;
  session.authenticatedAt = new Date().toISOString();
  session.chainId = 100;
  session.permissions = getPermissions(role);
  session.viewMode = role;
  delete session.nonce;
  await session.save();

  return NextResponse.json(serializeSession(session));
}

export async function DELETE() {
  if (!isE2EAuthEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await getAuthSession();
  session.destroy();

  return NextResponse.json({ ok: true });
}
