import type { ReactNode } from "react";

import type { QuarterReportData } from "@/lib/quarter-report";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    style: "percent",
  }).format(value);
}

function getPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max((value / total) * 100, value > 0 ? 2 : 0);
}

function ChartShell({
  children,
  eyebrow,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <p className="type-label-sm text-muted-foreground">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function QuarterFlowChart({ report }: { report: QuarterReportData }) {
  const rows = [
    {
      label: "Revenue",
      tone: "bg-chart-1",
      value: report.metrics.revenue,
    },
    {
      label: "Subcontractors",
      tone: "bg-chart-2",
      value: -report.expenseBreakdown.subcontractorPayouts,
    },
    {
      label: "Providers",
      tone: "bg-chart-3",
      value: -report.expenseBreakdown.providerExpenses,
    },
    {
      label: "RIPs",
      tone: "bg-chart-4",
      value: -report.expenseBreakdown.ripExpenses,
    },
    {
      label: "Ragequits",
      tone: "bg-chart-5",
      value: -report.expenseBreakdown.ragequits,
    },
    {
      label: "Net",
      tone:
        report.metrics.net >= 0 ? "bg-emerald-700" : "bg-destructive",
      value: report.metrics.net,
    },
  ];
  const maxValue = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <ChartShell eyebrow="Quarter Flow" title="Revenue to Net">
      <div className="mt-5 grid gap-3">
        {rows.map((row) => {
          const width = `${getPercent(Math.abs(row.value), maxValue)}%`;

          return (
            <div key={row.label} className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{row.label}</span>
                <span className="font-semibold tabular-nums">
                  {formatCurrency(row.value)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div className="h-3 overflow-hidden rounded-l-full bg-muted">
                  {row.value < 0 ? (
                    <div
                      className={`ml-auto h-full rounded-l-full ${row.tone}`}
                      style={{ width }}
                    />
                  ) : null}
                </div>
                <div className="h-3 overflow-hidden rounded-r-full bg-muted">
                  {row.value >= 0 ? (
                    <div
                      className={`h-full rounded-r-full ${row.tone}`}
                      style={{ width }}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ChartShell>
  );
}

function OutflowMixChart({ report }: { report: QuarterReportData }) {
  const rows = [
    {
      label: "Subcontractors",
      tone: "bg-chart-2",
      value: report.expenseBreakdown.subcontractorPayouts,
    },
    {
      label: "Providers",
      tone: "bg-chart-3",
      value: report.expenseBreakdown.providerExpenses,
    },
    {
      label: "RIPs",
      tone: "bg-chart-4",
      value: report.expenseBreakdown.ripExpenses,
    },
    {
      label: "Ragequits",
      tone: "bg-chart-5",
      value: report.expenseBreakdown.ragequits,
    },
  ].filter((row) => row.value > 0);
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <ChartShell eyebrow="Outflow Mix" title="Where Expenses Went">
      {total > 0 ? (
        <>
          <div className="mt-5 flex h-4 overflow-hidden rounded-full bg-muted">
            {rows.map((row) => (
              <div
                key={row.label}
                className={row.tone}
                style={{ width: `${getPercent(row.value, total)}%` }}
                title={`${row.label}: ${formatCurrency(row.value)}`}
              />
            ))}
          </div>
          <div className="mt-5 grid gap-3">
            {rows.map((row) => (
              <div key={row.label} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${row.tone}`}
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium">{row.label}</span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatPercent(row.value / total)}
                  </span>
                </div>
                <p className="text-right text-sm font-semibold tabular-nums">
                  {formatCurrency(row.value)}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <EmptyChart message="No expenses were recorded for this quarter." />
      )}
    </ChartShell>
  );
}

function TopRaidRevenueChart({ report }: { report: QuarterReportData }) {
  const rows = report.raidEconomics
    .filter((row) => row.revenue > 0)
    .slice(0, 5);
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 1);

  return (
    <ChartShell eyebrow="Raid Revenue" title="Top Raids by Revenue">
      {rows.length > 0 ? (
        <div className="mt-5">
          <div className="grid h-64 grid-cols-5 items-end gap-3 border-b border-border px-1">
            {rows.map((row, index) => (
              <div
                key={row.raid}
                className="flex h-full min-w-0 flex-col justify-end gap-2"
              >
                <p className="text-center text-xs font-semibold tabular-nums">
                  {formatCurrency(row.revenue)}
                </p>
                <div
                  className={`min-h-2 rounded-t-md ${
                    index === 0 ? "bg-chart-1" : "bg-chart-3"
                  }`}
                  style={{
                    height: `${getPercent(row.revenue, maxRevenue)}%`,
                  }}
                  title={`${row.raid}: ${formatCurrency(row.revenue)}`}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-5 gap-3 px-1">
            {rows.map((row) => (
              <p
                key={row.raid}
                className="min-w-0 text-center text-xs font-medium leading-5 text-muted-foreground"
                title={row.raid}
              >
                <span className="line-clamp-2">{row.raid}</span>
              </p>
            ))}
          </div>
        </div>
      ) : (
        <EmptyChart message="No raid revenue was linked for this quarter." />
      )}
    </ChartShell>
  );
}

export function ReportCharts({ report }: { report: QuarterReportData }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <QuarterFlowChart report={report} />
        <OutflowMixChart report={report} />
      </div>
      <TopRaidRevenueChart report={report} />
    </div>
  );
}
