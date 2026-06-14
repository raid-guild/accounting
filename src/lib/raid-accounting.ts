import "server-only";

import { and, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { ledgerEntries } from "@/db/schema";
import type { RaidView } from "@/lib/core-entities";

type RaidAccountingStatus =
  | "fully_paid"
  | "no_revenue"
  | "overpaid"
  | "payouts_pending";
type SpoilsStatus =
  | "no_revenue"
  | "over_received"
  | "received"
  | "spoils_pending";

type RaidLedgerTotals = {
  raidId: string | null;
  revenueUsd: string;
  spoilsUsd: string;
  subcontractorPayoutUsd: string;
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
  remainingSpoilsCents: bigint;
  revenueCents: bigint;
  spoilsReceivedCents: bigint;
  spoilsStatus: SpoilsStatus;
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
  spoilsReceivedCents: bigint;
  subcontractorPayoutCents: bigint;
};

export type RaidAccountingOverview = {
  clients: ClientRevenueSummary[];
  raids: RaidAccountingSummary[];
};

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

function getSpoilsStatus({
  expectedSpoilsCents,
  revenueCents,
  spoilsReceivedCents,
}: {
  expectedSpoilsCents: bigint;
  revenueCents: bigint;
  spoilsReceivedCents: bigint;
}): SpoilsStatus {
  if (spoilsReceivedCents > expectedSpoilsCents) {
    return "over_received";
  }

  if (revenueCents === ZERO) {
    return "no_revenue";
  }

  if (spoilsReceivedCents === expectedSpoilsCents) {
    return "received";
  }

  return "spoils_pending";
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

async function listRaidLedgerTotals(): Promise<RaidLedgerTotals[]> {
  const db = getDb();

  return db
    .select({
      raidId: ledgerEntries.raidId,
      revenueUsd: sql<string>`coalesce(sum(case when ${ledgerEntries.category} = 'raid_revenue' then ${ledgerEntries.usdAmount} else 0 end), 0)`,
      spoilsUsd: sql<string>`coalesce(sum(case when ${ledgerEntries.category} = 'raid_spoils' then ${ledgerEntries.usdAmount} else 0 end), 0)`,
      subcontractorPayoutUsd: sql<string>`coalesce(sum(case when ${ledgerEntries.category} = 'subcontractor_payout' then ${ledgerEntries.usdAmount} else 0 end), 0)`,
    })
    .from(ledgerEntries)
    .where(
      and(
        isNotNull(ledgerEntries.raidId),
        inArray(ledgerEntries.category, [
          "raid_revenue",
          "raid_spoils",
          "subcontractor_payout",
        ]),
      ),
    )
    .groupBy(ledgerEntries.raidId);
}

export async function getRaidAccountingOverview(
  raids: RaidView[],
): Promise<RaidAccountingOverview> {
  const ledgerRows = await listRaidLedgerTotals();
  const raidSummaries = new Map<string, RaidAccountingSummary>();
  const raidsById = new Map(raids.map((raid) => [raid.id, raid]));

  for (const raid of raids) {
    if (raid.archivedAt) {
      continue;
    }

    raidSummaries.set(raid.id, {
      clientId: raid.client.id,
      clientName: raid.client.name,
      expectedSpoilsCents: ZERO,
      expectedTeamPoolCents: ZERO,
      isShipped: false,
      raidId: raid.id,
      raidName: raid.name,
      remainingPoolCents: ZERO,
      remainingSpoilsCents: ZERO,
      revenueCents: ZERO,
      spoilsReceivedCents: ZERO,
      spoilsStatus: "no_revenue",
      status: "no_revenue",
      subcontractorPayoutCents: ZERO,
    });
  }

  for (const row of ledgerRows) {
    if (!row.raidId) {
      continue;
    }

    const raid = raidsById.get(row.raidId);

    if (!raid) {
      continue;
    }

    const summary =
      raidSummaries.get(row.raidId) ??
      ({
        clientId: raid.client.id,
        clientName: raid.client.name,
        expectedSpoilsCents: ZERO,
        expectedTeamPoolCents: ZERO,
        isShipped: Boolean(raid.archivedAt),
        raidId: raid.id,
        raidName: raid.name,
        remainingPoolCents: ZERO,
        remainingSpoilsCents: ZERO,
        revenueCents: ZERO,
        spoilsReceivedCents: ZERO,
        spoilsStatus: "no_revenue",
        status: "no_revenue",
        subcontractorPayoutCents: ZERO,
      } satisfies RaidAccountingSummary);

    summary.revenueCents = parseUsdCents(row.revenueUsd);
    summary.subcontractorPayoutCents = parseUsdCents(
      row.subcontractorPayoutUsd,
    );
    summary.spoilsReceivedCents = parseUsdCents(row.spoilsUsd);

    raidSummaries.set(row.raidId, summary);
  }

  const raidAccounting = Array.from(raidSummaries.values()).map((summary) => {
    const expectedSpoilsCents = divideAndRound(summary.revenueCents, TEN);
    const expectedTeamPoolCents = summary.revenueCents - expectedSpoilsCents;
    const remainingPoolCents =
      expectedTeamPoolCents - summary.subcontractorPayoutCents;
    const remainingSpoilsCents =
      expectedSpoilsCents - summary.spoilsReceivedCents;

    return {
      ...summary,
      expectedSpoilsCents,
      expectedTeamPoolCents,
      remainingPoolCents,
      remainingSpoilsCents,
      spoilsStatus: getSpoilsStatus({
        expectedSpoilsCents,
        revenueCents: summary.revenueCents,
        spoilsReceivedCents: summary.spoilsReceivedCents,
      }),
      status: getTeamPayoutStatus({
        expectedTeamPoolCents,
        revenueCents: summary.revenueCents,
        subcontractorPayoutCents: summary.subcontractorPayoutCents,
      }),
    };
  });
  const clientSummaries = new Map<string, ClientRevenueSummary>();

  for (const summary of raidAccounting) {
    if (summary.revenueCents === ZERO) {
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
        spoilsReceivedCents: ZERO,
        subcontractorPayoutCents: ZERO,
      } satisfies ClientRevenueSummary);

    clientSummary.expectedSpoilsCents += summary.expectedSpoilsCents;
    clientSummary.expectedTeamPoolCents += summary.expectedTeamPoolCents;
    clientSummary.raidCount += 1;
    clientSummary.revenueCents += summary.revenueCents;
    clientSummary.spoilsReceivedCents += summary.spoilsReceivedCents;
    clientSummary.subcontractorPayoutCents += summary.subcontractorPayoutCents;
    clientSummaries.set(summary.clientId, clientSummary);
  }

  return {
    clients: Array.from(clientSummaries.values()).sort(sortByRevenueThenName),
    raids: raidAccounting.sort(sortByRevenueThenName),
  };
}
