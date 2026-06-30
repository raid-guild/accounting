import "server-only";

import type { QuarterReportData } from "@/lib/quarter-report";
import type { QuarterSummary } from "@/lib/quarters";

export const MACHINE_REPORT_SLICES = [
  "quarter-summary",
  "taxable-revenue",
  "client-revenue",
  "raid-revenue",
  "provider-expenses",
  "full-ledger",
] as const;

export type MachineReportSlice = (typeof MACHINE_REPORT_SLICES)[number];

export type MachineReportResponse = {
  data: unknown;
  provenance: {
    publishedAt: string;
    quarter: string;
    quarterId: string;
    reportExportVersion: string;
    reportSlice: MachineReportSlice;
    source: "published-quarter-report";
  };
};

export function isMachineReportSlice(
  value: unknown,
): value is MachineReportSlice {
  return (
    typeof value === "string" &&
    MACHINE_REPORT_SLICES.includes(value as MachineReportSlice)
  );
}

function toNumber(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`Invalid usdAmount: ${value}`);
  }

  return number;
}

function sumUsd(rows: QuarterReportData["ledgerRows"]) {
  return rows.reduce((total, row) => total + toNumber(row.usdAmount), 0);
}

export function getMachineReportSlice({
  quarter,
  report,
  reportSlice,
}: {
  quarter: QuarterSummary;
  report: QuarterReportData;
  reportSlice: MachineReportSlice;
}): MachineReportResponse {
  const base = {
    provenance: {
      publishedAt: quarter.publishedAt ?? quarter.updatedAt,
      quarter: quarter.label,
      quarterId: quarter.id,
      reportExportVersion: "2026-q1-v1",
      reportSlice,
      source: "published-quarter-report" as const,
    },
  };

  if (reportSlice === "quarter-summary") {
    return {
      ...base,
      data: {
        balances: report.balances,
        expenseBreakdown: report.expenseBreakdown,
        metrics: report.metrics,
        providerExpenses: report.providerExpenses,
        raidEconomics: report.raidEconomics,
        ripExpenses: report.ripExpenses,
        topRaids: report.topRaids,
      },
    };
  }

  if (reportSlice === "taxable-revenue") {
    return {
      ...base,
      data: {
        metric: "taxableRevenue",
        totalUsd: report.metrics.revenue,
        rows: report.ledgerRows.filter((row) =>
          ["member_dues", "raid_revenue"].includes(row.category ?? ""),
        ),
      },
    };
  }

  if (reportSlice === "client-revenue") {
    const rows = report.ledgerRows.filter(
      (row) => row.category === "member_dues",
    );

    return {
      ...base,
      data: {
        metric: "memberDuesRevenue",
        rows,
        totalUsd: sumUsd(rows),
      },
    };
  }

  if (reportSlice === "raid-revenue") {
    const rows = report.ledgerRows.filter(
      (row) => row.category === "raid_revenue",
    );

    return {
      ...base,
      data: {
        ledgerRows: rows,
        metric: "raidRevenue",
        rows: report.topRaids,
        totalUsd: sumUsd(rows),
      },
    };
  }

  if (reportSlice === "provider-expenses") {
    return {
      ...base,
      data: {
        rows: report.providerExpenses,
        totalUsd: report.expenseBreakdown.providerExpenses,
      },
    };
  }

  return {
    ...base,
    data: {
      rows: report.ledgerRows,
    },
  };
}
