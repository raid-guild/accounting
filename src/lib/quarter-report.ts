import "server-only";

import type { QuarterSummary } from "@/lib/quarters";
import {
  listQuarterBalanceRows,
  summarizeQuarterBalanceRows,
  type QuarterAccountBalanceSummary,
} from "@/lib/quarter-balances";
import {
  buildQuarterLedgerRows,
  type QuarterExportLedgerRow,
} from "@/lib/quarter-xlsx-export";

export type QuarterReportMetric = {
  label: string;
  value: number;
};

export type QuarterReportLinkedRow = {
  label: string;
  totalUsd: number;
  entries: number;
};

export type QuarterReportRaidEconomicsRow = {
  expectedSpoils: number;
  payouts: number;
  raid: string;
  remainingPool: number;
  revenue: number;
  spoilsReceived: number;
};

export type QuarterReportData = {
  balances: QuarterAccountBalanceSummary[];
  expenseBreakdown: {
    providerExpenses: number;
    ragequits: number;
    ripExpenses: number;
    subcontractorPayouts: number;
  };
  ledgerRows: QuarterExportLedgerRow[];
  metrics: {
    expenses: number;
    net: number;
    revenue: number;
    spoilsReceived: number;
    subcontractorPayouts: number;
  };
  providerExpenses: QuarterReportLinkedRow[];
  raidEconomics: QuarterReportRaidEconomicsRow[];
  ripExpenses: QuarterReportLinkedRow[];
  topRaids: QuarterReportLinkedRow[];
};

function toNumber(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function sumRows(
  rows: QuarterExportLedgerRow[],
  categories: NonNullable<QuarterExportLedgerRow["category"]>[],
) {
  return rows.reduce((total, row) => {
    if (!row.category || !categories.includes(row.category)) {
      return total;
    }

    return total + toNumber(row.usdAmount);
  }, 0);
}

function sumRaidLinkedSubcontractorPayouts(rows: QuarterExportLedgerRow[]) {
  return rows.reduce((total, row) => {
    if (row.category !== "subcontractor_payout" || !row.raid) {
      return total;
    }

    return total + toNumber(row.usdAmount);
  }, 0);
}

function getQuarterRaidEconomicsRows(ledgerRows: QuarterExportLedgerRow[]) {
  const rows = new Map<string, QuarterReportRaidEconomicsRow>();

  for (const ledgerRow of ledgerRows) {
    if (!ledgerRow.raid) {
      continue;
    }

    const row =
      rows.get(ledgerRow.raid) ??
      ({
        expectedSpoils: 0,
        payouts: 0,
        raid: ledgerRow.raid,
        remainingPool: 0,
        revenue: 0,
        spoilsReceived: 0,
      } satisfies QuarterReportRaidEconomicsRow);
    const usdAmount = toNumber(ledgerRow.usdAmount);

    if (ledgerRow.category === "raid_revenue") {
      row.revenue += usdAmount;
    }

    if (ledgerRow.category === "raid_spoils") {
      row.spoilsReceived += usdAmount;
    }

    if (ledgerRow.category === "subcontractor_payout") {
      row.payouts += usdAmount;
    }

    row.expectedSpoils = row.revenue / 10;
    row.remainingPool = row.revenue - row.expectedSpoils - row.payouts;
    rows.set(ledgerRow.raid, row);
  }

  return Array.from(rows.values()).sort((left, right) => {
    if (left.revenue !== right.revenue) {
      return right.revenue - left.revenue;
    }

    return left.raid.localeCompare(right.raid);
  });
}

function summarizeLinkedRows({
  category,
  fallbackLabel,
  getLabel,
  rows,
}: {
  category: NonNullable<QuarterExportLedgerRow["category"]>;
  fallbackLabel: string;
  getLabel: (row: QuarterExportLedgerRow) => string;
  rows: QuarterExportLedgerRow[];
}) {
  const summaries = new Map<string, QuarterReportLinkedRow>();

  for (const row of rows) {
    if (row.category !== category) {
      continue;
    }

    const label = getLabel(row) || fallbackLabel;
    const summary =
      summaries.get(label) ??
      ({
        entries: 0,
        label,
        totalUsd: 0,
      } satisfies QuarterReportLinkedRow);

    summary.entries += 1;
    summary.totalUsd += toNumber(row.usdAmount);
    summaries.set(label, summary);
  }

  return Array.from(summaries.values()).sort((left, right) => {
    if (left.totalUsd !== right.totalUsd) {
      return right.totalUsd - left.totalUsd;
    }

    return left.label.localeCompare(right.label);
  });
}

export async function getQuarterReportData(
  quarter: QuarterSummary,
): Promise<QuarterReportData> {
  const [ledgerRows, balanceRows] = await Promise.all([
    buildQuarterLedgerRows({ quarter }),
    listQuarterBalanceRows(quarter.id),
  ]);
  const revenue = sumRows(ledgerRows, ["raid_revenue", "member_dues"]);
  const providerExpenses = sumRows(ledgerRows, ["provider_expense"]);
  const ragequits = sumRows(ledgerRows, ["ragequit"]);
  const ripExpenses = sumRows(ledgerRows, ["rip_expense"]);
  const subcontractorPayouts = sumRows(ledgerRows, ["subcontractor_payout"]);
  const expenses =
    providerExpenses + ragequits + ripExpenses + subcontractorPayouts;
  const spoilsReceived = sumRows(ledgerRows, ["raid_spoils"]);
  const raidLinkedSubcontractorPayouts =
    sumRaidLinkedSubcontractorPayouts(ledgerRows);

  return {
    balances: summarizeQuarterBalanceRows(balanceRows),
    expenseBreakdown: {
      providerExpenses,
      ragequits,
      ripExpenses,
      subcontractorPayouts,
    },
    ledgerRows,
    metrics: {
      expenses,
      net: revenue - expenses,
      revenue,
      spoilsReceived,
      subcontractorPayouts: raidLinkedSubcontractorPayouts,
    },
    providerExpenses: summarizeLinkedRows({
      category: "provider_expense",
      fallbackLabel: "Unlinked Provider",
      getLabel: (row) => row.counterparty,
      rows: ledgerRows,
    }),
    raidEconomics: getQuarterRaidEconomicsRows(ledgerRows),
    ripExpenses: summarizeLinkedRows({
      category: "rip_expense",
      fallbackLabel: "Unlinked RIP",
      getLabel: (row) => row.rip,
      rows: ledgerRows,
    }),
    topRaids: summarizeLinkedRows({
      category: "raid_revenue",
      fallbackLabel: "Unlinked Raid",
      getLabel: (row) => row.raid,
      rows: ledgerRows,
    }),
  };
}
