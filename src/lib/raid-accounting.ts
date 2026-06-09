import "server-only";

import { asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { entities, ledgerEntries, raids } from "@/db/schema";
import { decryptField, type EncryptedField } from "@/lib/encryption";

type RaidAccountingStatus =
  | "fully_paid"
  | "no_revenue"
  | "overpaid"
  | "payouts_pending";

type LedgerRow = {
  category: "raid_revenue" | "subcontractor_payout";
  clientId: string;
  clientName: string;
  raidArchivedAt: Date | null;
  raidId: string;
  raidName: string;
  usdAmount: string;
};

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
const ONE_HUNDRED = BigInt(100);

export type RaidAccountingSummary = {
  clientId: string;
  clientName: string;
  expectedSpoilsCents: bigint;
  expectedTeamPoolCents: bigint;
  isShipped: boolean;
  raidId: string;
  raidName: string;
  remainingPoolCents: bigint;
  revenueCents: bigint;
  status: RaidAccountingStatus;
  subcontractorPayoutCents: bigint;
};

export type ClientRevenueSummary = {
  clientId: string;
  clientName: string;
  expectedSpoilsCents: bigint;
  expectedTeamPoolCents: bigint;
  raidCount: number;
  revenueCents: bigint;
  subcontractorPayoutCents: bigint;
};

export type RaidAccountingOverview = {
  clients: ClientRevenueSummary[];
  raids: RaidAccountingSummary[];
};

function decryptNullableField(value: unknown) {
  return value ? decryptField(value as EncryptedField) : null;
}

function parseUsdCents(value: string) {
  const [dollars = "0", rawCents = ""] = value.split(".");
  const cents = rawCents.padEnd(2, "0").slice(0, 2);
  const sign = dollars.trim().startsWith("-") ? -ONE : ONE;
  const wholeDollars = dollars.replace("-", "") || "0";

  return sign * (BigInt(wholeDollars) * ONE_HUNDRED + BigInt(cents || "0"));
}

function divideAndRound(value: bigint, divisor: bigint) {
  const quotient = value / divisor;
  const remainder = value % divisor;

  if (remainder * TWO >= divisor) {
    return quotient + ONE;
  }

  return quotient;
}

function getTeamPayoutStatus({
  expectedTeamPoolCents,
  revenueCents,
  subcontractorPayoutCents,
}: {
  expectedTeamPoolCents: bigint;
  revenueCents: bigint;
  subcontractorPayoutCents: bigint;
}): RaidAccountingStatus {
  if (revenueCents === ZERO) {
    return "no_revenue";
  }

  if (subcontractorPayoutCents > expectedTeamPoolCents) {
    return "overpaid";
  }

  if (subcontractorPayoutCents === expectedTeamPoolCents) {
    return "fully_paid";
  }

  return "payouts_pending";
}

function sortByRevenueThenName<
  T extends { clientName?: string; raidName?: string; revenueCents: bigint },
>(left: T, right: T) {
  if (left.revenueCents !== right.revenueCents) {
    return left.revenueCents > right.revenueCents ? -1 : 1;
  }

  return (left.raidName ?? left.clientName ?? "").localeCompare(
    right.raidName ?? right.clientName ?? "",
  );
}

export function formatAccountingCurrency(cents: bigint) {
  const isNegative = cents < ZERO;
  const absolute = isNegative ? -cents : cents;
  const dollars = absolute / ONE_HUNDRED;
  const remainder = absolute % ONE_HUNDRED;
  const formatted = `${dollars.toLocaleString("en-US")}.${remainder
    .toString()
    .padStart(2, "0")}`;

  return `${isNegative ? "-" : ""}$${formatted}`;
}

export async function getRaidAccountingOverview(): Promise<RaidAccountingOverview> {
  const db = getDb();
  const [raidRows, ledgerRows] = await Promise.all([
    db
      .select({ client: entities, raid: raids })
      .from(raids)
      .innerJoin(entities, eq(raids.clientEntityId, entities.id))
      .orderBy(asc(raids.createdAt)),
    db
      .select({
        category: ledgerEntries.category,
        clientId: entities.id,
        clientNameEncrypted: entities.nameEncrypted,
        raidArchivedAt: raids.archivedAt,
        raidId: raids.id,
        raidNameEncrypted: raids.nameEncrypted,
        usdAmount: ledgerEntries.usdAmount,
      })
      .from(ledgerEntries)
      .innerJoin(raids, eq(ledgerEntries.raidId, raids.id))
      .innerJoin(entities, eq(raids.clientEntityId, entities.id))
      .where(
        inArray(ledgerEntries.category, [
          "raid_revenue",
          "subcontractor_payout",
        ]),
      ),
  ]);

  const raidSummaries = new Map<string, RaidAccountingSummary>();

  for (const { client, raid } of raidRows) {
    if (raid.archivedAt) {
      continue;
    }

    raidSummaries.set(raid.id, {
      clientId: client.id,
      clientName: decryptField(client.nameEncrypted as EncryptedField),
      expectedSpoilsCents: ZERO,
      expectedTeamPoolCents: ZERO,
      isShipped: false,
      raidId: raid.id,
      raidName: decryptField(raid.nameEncrypted as EncryptedField),
      remainingPoolCents: ZERO,
      revenueCents: ZERO,
      status: "no_revenue",
      subcontractorPayoutCents: ZERO,
    });
  }

  for (const row of ledgerRows) {
    const ledgerRow: LedgerRow = {
      category: row.category as LedgerRow["category"],
      clientId: row.clientId,
      clientName:
        decryptNullableField(row.clientNameEncrypted) ?? "Unknown client",
      raidArchivedAt: row.raidArchivedAt,
      raidId: row.raidId,
      raidName: decryptNullableField(row.raidNameEncrypted) ?? "Unknown raid",
      usdAmount: row.usdAmount,
    };
    const summary =
      raidSummaries.get(ledgerRow.raidId) ??
      ({
        clientId: ledgerRow.clientId,
        clientName: ledgerRow.clientName,
        expectedSpoilsCents: ZERO,
        expectedTeamPoolCents: ZERO,
        isShipped: Boolean(ledgerRow.raidArchivedAt),
        raidId: ledgerRow.raidId,
        raidName: ledgerRow.raidName,
        remainingPoolCents: ZERO,
        revenueCents: ZERO,
        status: "no_revenue",
        subcontractorPayoutCents: ZERO,
      } satisfies RaidAccountingSummary);
    const cents = parseUsdCents(ledgerRow.usdAmount);

    if (ledgerRow.category === "raid_revenue") {
      summary.revenueCents += cents;
    }

    if (ledgerRow.category === "subcontractor_payout") {
      summary.subcontractorPayoutCents += cents;
    }

    raidSummaries.set(ledgerRow.raidId, summary);
  }

  const raidAccounting = Array.from(raidSummaries.values()).map((summary) => {
    const expectedSpoilsCents = divideAndRound(summary.revenueCents, TEN);
    const expectedTeamPoolCents = summary.revenueCents - expectedSpoilsCents;
    const remainingPoolCents =
      expectedTeamPoolCents - summary.subcontractorPayoutCents;

    return {
      ...summary,
      expectedSpoilsCents,
      expectedTeamPoolCents,
      remainingPoolCents,
      status: getTeamPayoutStatus({
        expectedTeamPoolCents,
        revenueCents: summary.revenueCents,
        subcontractorPayoutCents: summary.subcontractorPayoutCents,
      }),
    };
  });
  const clientSummaries = new Map<string, ClientRevenueSummary>();

  for (const summary of raidAccounting) {
    if (summary.revenueCents <= ZERO) {
      continue;
    }

    const clientSummary =
      clientSummaries.get(summary.clientId) ??
      ({
        clientId: summary.clientId,
        clientName: summary.clientName,
        expectedSpoilsCents: ZERO,
        expectedTeamPoolCents: ZERO,
        raidCount: 0,
        revenueCents: ZERO,
        subcontractorPayoutCents: ZERO,
      } satisfies ClientRevenueSummary);

    clientSummary.expectedSpoilsCents += summary.expectedSpoilsCents;
    clientSummary.expectedTeamPoolCents += summary.expectedTeamPoolCents;
    clientSummary.raidCount += 1;
    clientSummary.revenueCents += summary.revenueCents;
    clientSummary.subcontractorPayoutCents += summary.subcontractorPayoutCents;
    clientSummaries.set(summary.clientId, clientSummary);
  }

  return {
    clients: Array.from(clientSummaries.values()).sort(sortByRevenueThenName),
    raids: raidAccounting.sort(sortByRevenueThenName),
  };
}
