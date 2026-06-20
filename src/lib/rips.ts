import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { ledgerEntries, rips } from "@/db/schema";
import { decryptField, type EncryptedField } from "@/lib/encryption";

const RIP_LINKED_SPEND_CATEGORIES = [
  "rip_expense",
  "subcontractor_payout",
] as const;

export type RipOption = {
  id: string;
  title: string;
  url: string;
};

export type RipView = RipOption & {
  createdAt: string;
  entryCount: number;
  totalUsd: string;
};

function decryptRip(rip: typeof rips.$inferSelect): RipOption {
  return {
    id: rip.id,
    title: decryptField(rip.titleEncrypted as EncryptedField),
    url: decryptField(rip.urlEncrypted as EncryptedField),
  };
}

export async function listRipOptions(): Promise<RipOption[]> {
  const rows = await getDb()
    .select()
    .from(rips)
    .orderBy(asc(rips.createdAt));

  return rows.map(decryptRip);
}

export async function listRipsWithTotals(): Promise<RipView[]> {
  const db = getDb();
  const ripRows = await db.select().from(rips).orderBy(asc(rips.createdAt));

  if (ripRows.length === 0) {
    return [];
  }

  const totals = await db
    .select({
      entryCount: sql<string>`count(${ledgerEntries.id})`,
      ripId: ledgerEntries.ripId,
      totalUsd: sql<string>`coalesce(sum(${ledgerEntries.usdAmount}), 0)`,
    })
    .from(ledgerEntries)
    .where(
      and(
        inArray(ledgerEntries.category, RIP_LINKED_SPEND_CATEGORIES),
        inArray(
          ledgerEntries.ripId,
          ripRows.map((rip) => rip.id),
        ),
      ),
    )
    .groupBy(ledgerEntries.ripId);

  const totalsByRipId = new Map(
    totals.map((total) => [
      total.ripId,
      {
        entryCount: Number(total.entryCount),
        totalUsd: total.totalUsd,
      },
    ]),
  );

  return ripRows
    .map((rip) => {
      const total = totalsByRipId.get(rip.id);

      return {
        ...decryptRip(rip),
        createdAt: rip.createdAt.toISOString(),
        entryCount: total?.entryCount ?? 0,
        totalUsd: total?.totalUsd ?? "0",
      };
    })
    .sort((a, b) => Number(b.totalUsd) - Number(a.totalUsd));
}

export async function assertRipIsAvailable(ripId: string | null) {
  if (!ripId) {
    return;
  }

  const [rip] = await getDb()
    .select({ id: rips.id })
    .from(rips)
    .where(eq(rips.id, ripId))
    .limit(1);

  if (!rip) {
    throw new Error("RIP not found");
  }
}
