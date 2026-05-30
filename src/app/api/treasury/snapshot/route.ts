import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth/session";
import { getTreasuryBalanceSnapshot } from "@/lib/treasury/balances";

async function requireMemberSession() {
  const session = await getAuthSession();

  if (!session.address || !session.permissions?.canAccess) {
    return null;
  }

  return session;
}

export async function GET() {
  const session = await requireMemberSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getTreasuryBalanceSnapshot();

  return NextResponse.json(snapshot);
}
