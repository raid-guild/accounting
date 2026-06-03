import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getAuthSession } from "@/lib/auth/session";
import {
  getRecentTreasuryTransactions,
  syncTreasuryTransactions,
} from "@/lib/treasury/transactions";

function getPositiveQueryInteger(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function requireAdminSession() {
  const session = await getAuthSession();

  if (!session.address || !session.permissions?.canAdmin) {
    return null;
  }

  return session;
}

export async function GET(request: Request) {
  const session = await requireAdminSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = getPositiveQueryInteger(url.searchParams.get("limit"));
  const transfers = await getRecentTreasuryTransactions(limit);

  return NextResponse.json({ transfers });
}

export async function POST(request: Request) {
  const session = await requireAdminSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const result = await syncTreasuryTransactions({
      limit: getPositiveQueryInteger(url.searchParams.get("limit")),
      maxPages: getPositiveQueryInteger(url.searchParams.get("maxPages")),
    });

    await writeAuditEvent({
      action: "import",
      actorWalletAddress: session.address,
      metadata: {
        accountCount: result.accounts.length,
        importedTransactions: result.importedTransactions,
        importedTransfers: result.importedTransfers,
        scannedTransfers: result.scannedTransfers,
      },
      subjectTable: "treasury_transactions",
      summary: "Synced treasury transactions",
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Treasury transaction sync failed", error);

    return NextResponse.json(
      { error: "Treasury transaction sync failed" },
      { status: 502 },
    );
  }
}
