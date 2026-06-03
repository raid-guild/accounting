import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getAuthSession } from "@/lib/auth/session";
import {
  getRecentTreasuryTransactionTransfers,
  syncTreasuryTransactions,
} from "@/lib/treasury/transactions";

const DEFAULT_RECENT_TRANSFER_LIMIT = 25;

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
  const limit =
    getPositiveQueryInteger(url.searchParams.get("limit")) ??
    DEFAULT_RECENT_TRANSFER_LIMIT;
  const transfers = await getRecentTreasuryTransactionTransfers(limit);

  return NextResponse.json({ transfers });
}

function getErrorMetadata(error: unknown) {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }

  return { errorMessage: "Treasury transaction sync failed" };
}

async function writeTransactionSyncAuditEvent({
  actorWalletAddress,
  metadata,
  summary,
}: {
  actorWalletAddress: string;
  metadata: Record<string, unknown>;
  summary: string;
}) {
  try {
    await writeAuditEvent({
      action: "import",
      actorWalletAddress,
      metadata,
      subjectTable: "treasury_transactions",
      summary,
    });
  } catch (auditError) {
    console.error("Failed to write treasury transaction sync audit event", auditError);
  }
}

export async function POST(request: Request) {
  const session = await requireAdminSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actorWalletAddress = session.address;

  if (!actorWalletAddress) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const result = await syncTreasuryTransactions({
      limit: getPositiveQueryInteger(url.searchParams.get("limit")),
      maxPages: getPositiveQueryInteger(url.searchParams.get("maxPages")),
    });

    await writeTransactionSyncAuditEvent({
      actorWalletAddress,
      metadata: {
        accountCount: result.accounts.length,
        errorCount: result.errors.length,
        importedTransactions: result.importedTransactions,
        importedTransfers: result.importedTransfers,
        scannedTransfers: result.scannedTransfers,
      },
      summary: "Synced treasury transactions",
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Treasury transaction sync failed", error);

    await writeTransactionSyncAuditEvent({
      actorWalletAddress,
      metadata: getErrorMetadata(error),
      summary: "Treasury transaction sync failed",
    });

    return NextResponse.json(
      { error: "Treasury transaction sync failed" },
      { status: 502 },
    );
  }
}
