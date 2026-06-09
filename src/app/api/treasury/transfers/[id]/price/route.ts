import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { treasuryTransactionTransfers } from "@/db/schema";
import { getAuthSession } from "@/lib/auth/session";
import { getHistoricalUsdPricing } from "@/lib/treasury/pricing";

async function requireAdminSession() {
  const session = await getAuthSession();

  if (!session.address || !session.permissions?.canAdmin) {
    return null;
  }

  return session;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [transfer] = await getDb()
    .select()
    .from(treasuryTransactionTransfers)
    .where(eq(treasuryTransactionTransfers.id, id))
    .limit(1);

  if (!transfer) {
    return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
  }

  try {
    const pricing = await getHistoricalUsdPricing({
      amount: transfer.amount,
      assetSymbol: transfer.assetSymbol,
      executedAt: transfer.executedAt,
    });

    return NextResponse.json({
      ...pricing,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Historical pricing unavailable",
      },
      { status: 502 },
    );
  }
}
