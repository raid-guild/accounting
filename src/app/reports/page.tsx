import { ArrowLeft, Download, Eye } from "lucide-react";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import { isQuarterExportReady } from "@/lib/quarter-export-readiness";
import { listQuarterReportingPeriods } from "@/lib/quarters";

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

function EmptyReports() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
      No published reports yet.
    </div>
  );
}

export default async function ReportsPage() {
  const session = serializeSession(await getAuthSession());

  if (!session.authenticated || !session.permissions?.canAccess) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <AppHeader initialSession={session} />
        <section className="container-custom py-10">
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <p className="type-label-sm text-muted-foreground">Reports</p>
            <h1 className="mt-2 text-2xl font-semibold">
              Member access required
            </h1>
          </div>
        </section>
      </main>
    );
  }

  const canAdmin = Boolean(session.permissions.canAdmin);
  const reports = (await listQuarterReportingPeriods()).filter(
    (quarter) =>
      isQuarterExportReady(quarter) &&
      (quarter.status === "published" || canAdmin),
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader initialSession={session} />

      <section className="container-custom grid gap-6 py-8 md:py-12">
        <Link
          href="/"
          className="inline-flex h-8 w-fit shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
        >
          <ArrowLeft data-icon="inline-start" />
          Dashboard
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="type-label-sm text-muted-foreground">Reports</p>
            <h1 className="mt-2 text-3xl font-semibold">Quarter Reports</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Published accounting reports for member review and export.
            </p>
          </div>
          <span className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground">
            {reports.length} available
          </span>
        </div>

        {reports.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {reports.map((quarter) => {
              const isPreview = quarter.status !== "published";

              return (
                <article
                  key={quarter.id}
                  className="rounded-lg border border-border bg-card p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="type-label-sm text-muted-foreground">
                        {formatDate(quarter.startsOn)} -{" "}
                        {formatDate(quarter.endsOn)}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold">
                        {quarter.label}
                      </h2>
                    </div>
                    <span
                      className={`rounded-md border px-2 py-1 text-xs font-medium ${
                        isPreview
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-800"
                          : "border-emerald-600/25 bg-emerald-600/10 text-emerald-800"
                      }`}
                    >
                      {isPreview ? "Admin Preview" : "Published"}
                    </span>
                  </div>

                  <p className="mt-4 text-sm text-muted-foreground">
                    {quarter.publishedAt
                      ? `Published ${formatTimestamp(quarter.publishedAt)}`
                      : "Ready for publication preview"}
                  </p>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link
                      href={`/reports/quarters/${quarter.id}`}
                      className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all hover:bg-muted hover:text-foreground"
                    >
                      <Eye data-icon="inline-start" />
                      View Report
                    </Link>
                    <Link
                      href={`/reports/quarters/${quarter.id}/export.xlsx`}
                      className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all hover:bg-muted hover:text-foreground"
                    >
                      <Download data-icon="inline-start" />
                      Export XLSX
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyReports />
        )}
      </section>
    </main>
  );
}
