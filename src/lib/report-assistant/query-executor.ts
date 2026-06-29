import "server-only";

import type { QuarterExportLedgerRow } from "@/lib/quarter-xlsx-export";
import type { QuarterReportData } from "@/lib/quarter-report";
import type { QuarterSummary } from "@/lib/quarters";
import {
  type ReportAssistantChart,
  type ReportAssistantPlan,
  type ReportAssistantResponse,
  type ReportAssistantTableRow,
} from "@/lib/report-assistant/types";
import { getCategoryLabel } from "@/lib/transaction-classification";

const REVENUE_CATEGORIES: NonNullable<QuarterExportLedgerRow["category"]>[] = [
  "raid_revenue",
  "member_dues",
];
const EXPENSE_CATEGORIES: NonNullable<QuarterExportLedgerRow["category"]>[] = [
  "provider_expense",
  "ragequit",
  "rip_expense",
  "subcontractor_payout",
];
const REPORT_TOTAL_CATEGORIES = [
  ...REVENUE_CATEGORIES,
  ...EXPENSE_CATEGORIES,
  "raid_spoils",
] satisfies NonNullable<QuarterExportLedgerRow["category"]>[];

function toNumber(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

function limitRows(rows: ReportAssistantTableRow[], limit: number | null) {
  return rows.slice(0, limit ?? 5);
}

function tableForRows(rows: ReportAssistantTableRow[]) {
  return rows.length > 1 ? rows : [];
}

function summarizeLedgerRows({
  category,
  fallbackLabel,
  getLabel,
  ledgerRows,
}: {
  category: NonNullable<QuarterExportLedgerRow["category"]>;
  fallbackLabel: string;
  getLabel: (row: QuarterExportLedgerRow) => string;
  ledgerRows: QuarterExportLedgerRow[];
}) {
  const rows = new Map<string, ReportAssistantTableRow>();

  for (const ledgerRow of ledgerRows) {
    if (ledgerRow.category !== category) {
      continue;
    }

    const label = getLabel(ledgerRow) || fallbackLabel;
    const row = rows.get(label) ?? { entries: 0, label, value: 0 };

    row.entries = (row.entries ?? 0) + 1;
    row.value += toNumber(ledgerRow.usdAmount);
    rows.set(label, row);
  }

  return Array.from(rows.values()).sort((left, right) => {
    if (left.value !== right.value) {
      return right.value - left.value;
    }

    return left.label.localeCompare(right.label);
  });
}

function getClientFromRaidLabel(raidLabel: string) {
  const match = /\(([^()]*)\)\s*$/.exec(raidLabel);

  return match?.[1]?.trim() || raidLabel || "Unlinked Client";
}

function chartFromRows({
  plan,
  rows,
  title,
}: {
  plan: ReportAssistantPlan;
  rows: ReportAssistantTableRow[];
  title: string;
}): ReportAssistantChart | null {
  if ((plan.chart !== "bar" && plan.chart !== "pie") || rows.length < 2) {
    return null;
  }

  return {
    rows,
    title,
    type: plan.chart,
  };
}

function makeResponse({
  answer,
  chart,
  grouping,
  metric,
  plan,
  quarter,
  table,
}: {
  answer: string;
  chart: ReportAssistantChart | null;
  grouping: string;
  metric: string;
  plan: ReportAssistantPlan;
  quarter: QuarterSummary;
  table: ReportAssistantTableRow[];
}): ReportAssistantResponse {
  return {
    answer,
    chart,
    plan,
    provenance: {
      grouping,
      lastPublishedAt: quarter.publishedAt,
      metric,
      quarter: quarter.label,
    },
    table,
  };
}

function summarizeTopRow(rows: ReportAssistantTableRow[]) {
  const [topRow] = rows;

  if (!topRow) {
    return "No matching published report rows were found.";
  }

  return `${topRow.label} leads with ${formatCurrency(topRow.value)}.`;
}

function summarizeTopMonthByRevenue(rows: ReportAssistantTableRow[]) {
  const [topRow] = rows;

  if (!topRow) {
    return "No published report revenue rows were found for this quarter.";
  }

  return `${topRow.label} had the highest revenue this quarter at ${formatCurrency(topRow.value)}.`;
}

function summarizeTopMonthByExpenses(rows: ReportAssistantTableRow[]) {
  const [topRow] = rows;

  if (!topRow) {
    return "No published report expense rows were found for this quarter.";
  }

  return `${topRow.label} had the most expenses this quarter at ${formatCurrency(topRow.value)}.`;
}

function summarizeCategoriesByMonth({
  categories,
  ledgerRows,
}: {
  categories: NonNullable<QuarterExportLedgerRow["category"]>[];
  ledgerRows: QuarterExportLedgerRow[];
}) {
  const rows = new Map<string, ReportAssistantTableRow>();

  for (const ledgerRow of ledgerRows) {
    if (!ledgerRow.category || !categories.includes(ledgerRow.category)) {
      continue;
    }

    const occurredAt = new Date(ledgerRow.occurredAt);

    if (Number.isNaN(occurredAt.getTime())) {
      continue;
    }

    const monthKey = `${occurredAt.getUTCFullYear()}-${String(
      occurredAt.getUTCMonth() + 1,
    ).padStart(2, "0")}-01T00:00:00.000Z`;
    const label = formatMonth(monthKey);
    const row = rows.get(monthKey) ?? { entries: 0, label, value: 0 };

    row.entries = (row.entries ?? 0) + 1;
    row.value += toNumber(ledgerRow.usdAmount);
    rows.set(monthKey, row);
  }

  return Array.from(rows.entries())
    .map(([monthKey, row]) => ({ monthKey, ...row }))
    .sort((left, right) => {
      if (left.value !== right.value) {
        return right.value - left.value;
      }

      return left.monthKey.localeCompare(right.monthKey);
    })
    .map((row) => ({
      entries: row.entries,
      label: row.label,
      value: row.value,
    }));
}

export function executeReportAssistantPlan({
  plan,
  quarter,
  report,
}: {
  plan: ReportAssistantPlan;
  quarter: QuarterSummary;
  report: QuarterReportData;
}): ReportAssistantResponse {
  if (plan.intent === "unsupported_report_question") {
    return makeResponse({
      answer:
        plan.unsupportedReason === "small_talk"
          ? "Ask me a question about this published report, such as revenue, expenses, raids, clients, subcontractors, providers, or report totals."
          : plan.unsupportedReason === "nonsense"
            ? "I can only answer questions about the published quarter report, such as revenue, expenses, raids, clients, subcontractors, providers, and report totals."
            : "This published report does not include the data needed to answer that. I can answer questions about report totals, raid revenue, client revenue, subcontractor payouts, provider expenses, and category totals.",
      chart: null,
      grouping: "Unsupported",
      metric: "Report scope",
      plan,
      quarter,
      table: [],
    });
  }

  if (plan.intent === "quarter_summary") {
    const rows: ReportAssistantTableRow[] = [
      { label: "Revenue", value: report.metrics.revenue },
      { label: "Expenses", value: report.metrics.expenses },
      { label: "Net", value: report.metrics.net },
      { label: "Spoils Received", value: report.metrics.spoilsReceived },
    ];

    return makeResponse({
      answer: `${quarter.label} shows ${formatCurrency(report.metrics.revenue)} in revenue, ${formatCurrency(report.metrics.expenses)} in expenses, ${formatCurrency(report.metrics.net)} net, and ${formatCurrency(report.metrics.spoilsReceived)} in spoils received.`,
      chart: chartFromRows({ plan, rows, title: "Quarter Summary" }),
      grouping: "Summary metrics",
      metric: "USD totals",
      plan,
      quarter,
      table: rows,
    });
  }

  if (plan.intent === "top_raids_by_revenue") {
    const rows = limitRows(
      report.topRaids.map((row) => ({
        entries: row.entries,
        label: row.label,
        value: row.totalUsd,
      })),
      plan.limit,
    );

    return makeResponse({
      answer: summarizeTopRow(rows),
      chart: chartFromRows({ plan, rows, title: "Top Raids by Revenue" }),
      grouping: "Raid",
      metric: "Raid revenue",
      plan,
      quarter,
      table: tableForRows(rows),
    });
  }

  if (plan.intent === "top_clients_by_revenue") {
    const rows = limitRows(
      summarizeLedgerRows({
        category: "raid_revenue",
        fallbackLabel: "Unlinked Client",
        getLabel: (row) => getClientFromRaidLabel(row.raid),
        ledgerRows: report.ledgerRows,
      }),
      plan.limit,
    );

    return makeResponse({
      answer: summarizeTopRow(rows),
      chart: chartFromRows({ plan, rows, title: "Top Clients by Revenue" }),
      grouping: "Client",
      metric: "Raid revenue",
      plan,
      quarter,
      table: tableForRows(rows),
    });
  }

  if (plan.intent === "top_subcontractors_by_payout") {
    const rows = limitRows(
      summarizeLedgerRows({
        category: "subcontractor_payout",
        fallbackLabel: "Unlinked Subcontractor",
        getLabel: (row) => row.counterparty,
        ledgerRows: report.ledgerRows,
      }),
      plan.limit,
    );

    return makeResponse({
      answer: summarizeTopRow(rows),
      chart: chartFromRows({ plan, rows, title: "Top Subcontractor Payouts" }),
      grouping: "Subcontractor",
      metric: "Subcontractor payouts",
      plan,
      quarter,
      table: tableForRows(rows),
    });
  }

  if (plan.intent === "top_providers_by_expense") {
    const rows = limitRows(
      report.providerExpenses.map((row) => ({
        entries: row.entries,
        label: row.label,
        value: row.totalUsd,
      })),
      plan.limit,
    );

    return makeResponse({
      answer: summarizeTopRow(rows),
      chart: chartFromRows({ plan, rows, title: "Top Provider Expenses" }),
      grouping: "Provider",
      metric: "Provider expenses",
      plan,
      quarter,
      table: tableForRows(rows),
    });
  }

  if (plan.intent === "revenue_by_month") {
    const rows = limitRows(
      summarizeCategoriesByMonth({
        categories: REVENUE_CATEGORIES,
        ledgerRows: report.ledgerRows,
      }),
      plan.limit,
    );

    return makeResponse({
      answer: summarizeTopMonthByRevenue(rows),
      chart: chartFromRows({ plan, rows, title: "Revenue by Month" }),
      grouping: "Month",
      metric: "Revenue",
      plan,
      quarter,
      table: tableForRows(rows),
    });
  }

  if (plan.intent === "expenses_by_month") {
    const rows = limitRows(
      summarizeCategoriesByMonth({
        categories: EXPENSE_CATEGORIES,
        ledgerRows: report.ledgerRows,
      }),
      plan.limit,
    );

    return makeResponse({
      answer: summarizeTopMonthByExpenses(rows),
      chart: chartFromRows({ plan, rows, title: "Expenses by Month" }),
      grouping: "Month",
      metric: "Expenses",
      plan,
      quarter,
      table: tableForRows(rows),
    });
  }

  const rows = limitRows(
    Object.entries(
      report.ledgerRows.reduce<Record<string, ReportAssistantTableRow>>(
        (summary, row) => {
          if (!row.category || !REPORT_TOTAL_CATEGORIES.includes(row.category)) {
            return summary;
          }

          const label = getCategoryLabel(row.category);
          const existing = summary[label] ?? { entries: 0, label, value: 0 };

          existing.entries = (existing.entries ?? 0) + 1;
          existing.value += toNumber(row.usdAmount);
          summary[label] = existing;
          return summary;
        },
        {},
      ),
    )
      .map(([, row]) => row)
      .sort((left, right) => right.value - left.value),
    plan.limit,
  );

  return makeResponse({
    answer: summarizeTopRow(rows),
    chart: chartFromRows({
      plan,
      rows,
      title: "Expenses and Revenue by Category",
    }),
    grouping: "Category",
    metric: "Ledger USD totals",
    plan,
    quarter,
    table: rows,
  });
}
