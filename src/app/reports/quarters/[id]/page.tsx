import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { CopyableAddress } from "@/components/copyable-address";
import { ReportAssistant } from "@/components/reports/report-assistant";
import { ReportCharts } from "@/components/reports/report-charts";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import { isQuarterExportReady } from "@/lib/quarter-export-readiness";
import { getQuarterReportData } from "@/lib/quarter-report";
import { listQuarterReportingPeriods, type QuarterSummary } from "@/lib/quarters";

type PageParams = Promise<{ id: string }>;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
    style: "percent",
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ReportGate({
  message,
  session,
  title,
}: {
  message: string;
  session: Parameters<typeof AppHeader>[0]["initialSession"];
  title: string;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader initialSession={session} />
      <section className="container-custom py-10">
        <Link
          href="/reports"
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
        >
          <ArrowLeft data-icon="inline-start" />
          Reports
        </Link>
        <div className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm">
          <p className="type-label-sm text-muted-foreground">Quarter Report</p>
          <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <p className="type-label-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{formatCurrency(value)}</p>
      {detail ? (
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function RankedTable({
  empty,
  rows,
  title,
}: {
  empty: string;
  rows: { entries: number; label: string; totalUsd: number }[];
  title: string;
}) {
  const totals = rows.reduce(
    (summary, row) => ({
      entries: summary.entries + row.entries,
      totalUsd: summary.totalUsd + row.totalUsd,
    }),
    { entries: 0, totalUsd: 0 },
  );

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="type-label-sm text-muted-foreground">
          {rows.length} linked
        </span>
      </div>
      {rows.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[420px] text-left text-sm md:min-w-0">
            <thead className="border-b border-border bg-muted text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Entries</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="bg-primary/5">
                <td className="px-3 py-3 font-semibold">Total</td>
                <td className="px-3 py-3 text-right font-semibold">
                  {totals.entries}
                </td>
                <td className="px-3 py-3 text-right font-semibold">
                  {formatCurrency(totals.totalUsd)}
                </td>
              </tr>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className="px-3 py-3 font-medium break-words">
                    {row.label}
                  </td>
                  <td className="px-3 py-3 text-right">{row.entries}</td>
                  <td className="px-3 py-3 text-right font-semibold">
                    {formatCurrency(row.totalUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
          {empty}
        </div>
      )}
    </section>
  );
}

function BalanceTable({
  balances,
}: {
  balances: Awaited<ReturnType<typeof getQuarterReportData>>["balances"];
}) {
  const total = balances.reduce(
    (summary, balance) => ({
      closingUsd: summary.closingUsd + balance.closingUsd,
      netChangeUsd: summary.netChangeUsd + balance.netChangeUsd,
      openingUsd: summary.openingUsd + balance.openingUsd,
    }),
    { closingUsd: 0, netChangeUsd: 0, openingUsd: 0 },
  );

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="type-label-sm text-muted-foreground">Balances</p>
          <h2 className="mt-1 text-lg font-semibold">Quarter Balances</h2>
        </div>
        <span className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
          {balances.length} accounts
        </span>
      </div>
      {balances.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 text-right font-medium">Opening</th>
                <th className="px-3 py-2 text-right font-medium">Closing</th>
                <th className="px-3 py-2 text-right font-medium">
                  Net Change
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="bg-primary/5">
                <td className="px-3 py-3 font-semibold">Total</td>
                <td className="px-3 py-3 text-right font-semibold">
                  {formatCurrency(total.openingUsd)}
                </td>
                <td className="px-3 py-3 text-right font-semibold">
                  {formatCurrency(total.closingUsd)}
                </td>
                <td className="px-3 py-3 text-right font-semibold">
                  {formatCurrency(total.netChangeUsd)}
                </td>
              </tr>
              {balances.map((balance) => (
                <tr key={`${balance.chainId}:${balance.accountAddress}`}>
                  <td className="px-3 py-3">
                    <p className="font-medium">{balance.accountName}</p>
                    <CopyableAddress
                      address={balance.accountAddress}
                      className="mt-1 text-xs text-muted-foreground"
                    />
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatCurrency(balance.openingUsd)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatCurrency(balance.closingUsd)}
                  </td>
                  <td className="px-3 py-3 text-right font-medium">
                    {formatCurrency(balance.netChangeUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
          No quarter balances have been synced.
        </div>
      )}
    </section>
  );
}

function ReportStatus({
  quarter,
}: {
  quarter: QuarterSummary;
}) {
  if (quarter.status === "published") {
    return (
      <span className="rounded-md border border-emerald-600/25 bg-emerald-600/10 px-2 py-1 text-xs font-medium text-emerald-800">
        Published
      </span>
    );
  }

  return (
    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-800">
      Admin Preview
    </span>
  );
}

export default async function QuarterReportPage({
  params,
}: {
  params: PageParams;
}) {
  const session = serializeSession(await getAuthSession());
  const { id } = await params;

  if (!session.authenticated || !session.permissions?.canAccess) {
    return (
      <ReportGate
        message="Connect a RaidGuild member wallet to view published reports."
        session={session}
        title="Member access required"
      />
    );
  }

  const quarter = (await listQuarterReportingPeriods()).find(
    (item) => item.id === id,
  );

  if (!quarter) {
    return (
      <ReportGate
        message="That quarter could not be found."
        session={session}
        title="Report not found"
      />
    );
  }

  const exportReady = isQuarterExportReady(quarter);
  const canPreview = Boolean(session.permissions.canAdmin) && exportReady;

  if (!exportReady || (quarter.status !== "published" && !canPreview)) {
    return (
      <ReportGate
        message={
          quarter.status === "published"
            ? "This quarter report needs to be refreshed before it can be viewed."
            : "This quarter is not published yet."
        }
        session={session}
        title="Report unavailable"
      />
    );
  }

  const report = await getQuarterReportData(quarter);
  const subcontractorExpensePercent =
    report.metrics.expenses > 0
      ? report.expenseBreakdown.subcontractorPayouts / report.metrics.expenses
      : 0;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader initialSession={session} />

      <section className="container-custom grid gap-6 py-8 md:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/reports"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
          >
            <ArrowLeft data-icon="inline-start" />
            Reports
          </Link>
          <Link
            href={`/reports/quarters/${quarter.id}/export.xlsx`}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all hover:bg-muted hover:text-foreground"
          >
            <Download data-icon="inline-start" />
            Export XLSX
          </Link>
        </div>

        <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="type-label-sm text-muted-foreground">
                Quarter Report
              </p>
              <h1 className="mt-2 text-3xl font-semibold">{quarter.label}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {formatDate(quarter.startsOn)} - {formatDate(quarter.endsOn)}
              </p>
              {quarter.publishedAt ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Published {formatTimestamp(quarter.publishedAt)}
                </p>
              ) : null}
            </div>
            <ReportStatus quarter={quarter} />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Revenue" value={report.metrics.revenue} />
            <MetricCard
              detail={`${formatCurrency(report.expenseBreakdown.subcontractorPayouts)} / ${formatPercent(subcontractorExpensePercent)} to raiders`}
              label="Expenses"
              value={report.metrics.expenses}
            />
            <MetricCard label="Net" value={report.metrics.net} />
            <MetricCard
              label="Spoils Received"
              value={report.metrics.spoilsReceived}
            />
          </div>
        </section>

        <ReportCharts report={report} />

        {quarter.status === "published" ? (
          <ReportAssistant
            key={`${quarter.id}:${session.address ?? "member"}`}
            quarterId={quarter.id}
            walletAddress={session.address}
          />
        ) : null}

        <BalanceTable balances={report.balances} />

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="type-label-sm text-muted-foreground">
                Balance Validation
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                Ledger reconciliation
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {quarter.balanceValidation?.status === "acknowledged"
                  ? "Published with acknowledged variance."
                  : "Balances validated against classified ledger activity."}
              </p>
            </div>
            <span
              className={`rounded-md border px-2 py-1 text-xs font-medium ${
                quarter.balanceValidation?.status === "acknowledged"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-800"
                  : "border-emerald-600/25 bg-emerald-600/10 text-emerald-800"
              }`}
            >
              {quarter.balanceValidation?.status === "acknowledged"
                ? "Acknowledged"
                : "Validated"}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-background p-3">
              <dt className="type-label-sm text-muted-foreground">Checked</dt>
              <dd className="mt-1 text-lg font-semibold">
                {quarter.balanceValidation?.checkedCount ?? 0}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <dt className="type-label-sm text-muted-foreground">
                Variances
              </dt>
              <dd className="mt-1 text-lg font-semibold">
                {quarter.balanceValidation?.varianceCount ?? 0}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <dt className="type-label-sm text-muted-foreground">Excluded</dt>
              <dd className="mt-1 text-lg font-semibold">
                {quarter.balanceValidation?.excludedCount ?? 0}
              </dd>
            </div>
          </dl>
        </section>

        <div className="grid gap-5">
          <RankedTable
            empty="No raid revenue was linked for this quarter."
            rows={report.topRaids}
            title="Top Raids by Revenue"
          />
          <RankedTable
            empty="No provider expenses were linked for this quarter."
            rows={report.providerExpenses}
            title="Provider Expenses"
          />
          <RankedTable
            empty="No RIP expenses were linked for this quarter."
            rows={report.ripExpenses}
            title="RIP Expenses"
          />
        </div>

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <FileSpreadsheet className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="type-label-sm text-muted-foreground">Ledger</p>
                <h2 className="text-lg font-semibold">Report Rows</h2>
              </div>
            </div>
            <span className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
              {report.ledgerRows.length} rows
            </span>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Download the XLSX export for the full ledger, balances, proposals,
            membership events, RIPs, and provider expense tabs.
          </p>
        </section>
      </section>
    </main>
  );
}
