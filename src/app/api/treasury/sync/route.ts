import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth/session";
import {
  getTreasuryBalanceSnapshot,
  syncTreasuryBalanceSnapshot,
} from "@/lib/treasury/balances";

async function requireMemberSession() {
  const session = await getAuthSession();

  if (!session.address || !session.permissions?.canAccess) {
    return null;
  }

  return session;
}

function getPublicSyncError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Treasury balance sync failed";
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("gnosis_rpc_url")) {
    return "GNOSIS_RPC_URL is required to sync treasury balances";
  }

  if (lowerMessage.includes("main_safe_address")) {
    return "MAIN_SAFE_ADDRESS is required to sync treasury balances";
  }

  return "Treasury balance sync failed";
}

export async function POST() {
  const session = await requireMemberSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cachedSnapshot = await getTreasuryBalanceSnapshot();

    if (!cachedSnapshot.isStale && cachedSnapshot.syncedAt) {
      return NextResponse.json(cachedSnapshot);
    }

    const snapshot = await syncTreasuryBalanceSnapshot();

    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("Treasury balance sync failed", error);

    const snapshot = await getTreasuryBalanceSnapshot();

    return NextResponse.json(
      {
        ...snapshot,
        errorMessage: getPublicSyncError(error),
        status: "failed",
      },
      { status: 502 },
    );
  }
}
