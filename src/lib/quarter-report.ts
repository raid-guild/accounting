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

export type QuarterReportData = {
  balances: QuarterAccountBalanceSummary[];
  ledgerRows: QuarterExportLedgerRow[];
  metrics: {
    expenses: number;
    net: number;
    revenue: number;
    spoilsReceived: number;
  };
  providerExpenses: QuarterReportLinkedRow[];
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
  const expenses = sumRows(ledgerRows, [
    "provider_expense",
    "ragequit",
    "rip_expense",
    "subcontractor_payout",
  ]);
  const spoilsReceived = sumRows(ledgerRows, ["raid_spoils"]);

  return {
    balances: summarizeQuarterBalanceRows(balanceRows),
    ledgerRows,
    metrics: {
      expenses,
      net: revenue - expenses,
      revenue,
      spoilsReceived,
    },
    providerExpenses: summarizeLinkedRows({
      category: "provider_expense",
      fallbackLabel: "Unlinked Provider",
      getLabel: (row) => row.counterparty,
      rows: ledgerRows,
    }),
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
