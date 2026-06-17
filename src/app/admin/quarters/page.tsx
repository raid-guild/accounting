import {
  ArrowLeft,
  CheckCircle2,
  History,
  LockKeyhole,
  RotateCcw,
  Save,
  Tags,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  createQ1ReportingPeriod,
  updateQuarterStatus,
} from "@/app/admin/quarters/actions";
import { AppHeader } from "@/components/app-header";
import { QuarterWorkflowProgress } from "@/components/quarters/quarter-workflow-progress";
import { Button } from "@/components/ui/button";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import {
  listQuarterReportingPeriods,
  type QuarterReportingPeriod,
  type QuarterStatus,
} from "@/lib/quarters";

const STATUS_COPY: Record<
  QuarterStatus,
  { description: string; label: string; tone: string }
> = {
  draft: {
    description: "Admins can import and classify data.",
    label: "Draft",
    tone: "border-muted bg-muted text-muted-foreground",
  },
  ready_for_review: {
    description: "Admins believe the quarter is ready for review.",
    label: "Ready for Review",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-800",
  },
  published: {
    description: "Members can view and export this locked quarter.",
    label: "Published",
    tone: "border-emerald-600/25 bg-emerald-600/10 text-emerald-800",
  },
  reopened: {
    description: "A published quarter is open for correction.",
    label: "Reopened",
    tone: "border-primary/25 bg-primary/10 text-primary",
  },
};

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

function StatusBadge({ status }: { status: QuarterStatus }) {
  const copy = STATUS_COPY[status];

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${copy.tone}`}
    >
      {copy.label}
    </span>
  );
}

function StatusAction({
  children,
  disabled,
  quarter,
  status,
  variant = "outline",
}: {
  children: ReactNode;
  disabled?: boolean;
  quarter: QuarterReportingPeriod;
  status: QuarterStatus;
  variant?: "default" | "outline" | "destructive";
}) {
  return (
    <form action={updateQuarterStatus}>
      <input type="hidden" name="id" value={quarter.id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant} disabled={disabled}>
        {children}
      </Button>
    </form>
  );
}

function ReopenForm({ quarter }: { quarter: QuarterReportingPeriod }) {
  if (quarter.status !== "published") {
    return null;
  }

  return (
    <form
      action={updateQuarterStatus}
      className="mt-6 grid gap-3 rounded-md border border-border bg-background p-4"
    >
      <input type="hidden" name="id" value={quarter.id} />
      <input type="hidden" name="status" value="reopened" />
      <label className="grid gap-2 text-sm font-medium">
        <span className="type-label-sm text-muted-foreground">
          Reopen Reason
        </span>
        <textarea
          name="reason"
          required
          className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      <div>
        <Button
          type="submit"
          variant="destructive"
        >
          <RotateCcw data-icon="inline-start" />
          Reopen Quarter
        </Button>
      </div>
    </form>
  );
}

function QuarterCard({
  canManage,
  quarter,
}: {
  canManage: boolean;
  quarter: QuarterReportingPeriod;
}) {
  const statusCopy = STATUS_COPY[quarter.status];
  const readyStep = quarter.workflowSteps.find((step) => step.key === "ready");
  const publishStep = quarter.workflowSteps.find(
    (step) => step.key === "publish",
  );

  return (
    <article className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="type-label-sm text-muted-foreground">
            {formatDate(quarter.startsOn)} - {formatDate(quarter.endsOn)}
          </p>
          <h2 className="mt-2 text-2xl font-semibold">{quarter.label}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {statusCopy.description}
          </p>
        </div>
        <StatusBadge status={quarter.status} />
      </div>

      <dl className="mt-6 grid gap-4 border-t border-border pt-4 sm:grid-cols-4">
        <div>
          <dt className="type-label-sm text-muted-foreground">
            Transactions
          </dt>
          <dd className="mt-2 text-sm font-medium">
            {quarter.classificationSummary.classifiedTransfers} /{" "}
            {quarter.classificationSummary.totalTransfers} classified
          </dd>
        </div>
        <div>
          <dt className="type-label-sm text-muted-foreground">Published</dt>
          <dd className="mt-2 text-sm font-medium">
            {quarter.publishedAt ? formatTimestamp(quarter.publishedAt) : "-"}
          </dd>
        </div>
        <div>
          <dt className="type-label-sm text-muted-foreground">Reopened</dt>
          <dd className="mt-2 text-sm font-medium">
            {quarter.reopenedAt ? formatTimestamp(quarter.reopenedAt) : "-"}
          </dd>
        </div>
        <div>
          <dt className="type-label-sm text-muted-foreground">Last Updated</dt>
          <dd className="mt-2 text-sm font-medium">
            {formatTimestamp(quarter.updatedAt)}
          </dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-border pt-5">
        <QuarterWorkflowProgress compact steps={quarter.workflowSteps} />
      </div>

      {canManage ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href={`/admin/quarters/${quarter.id}/transactions`}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all hover:bg-muted hover:text-foreground"
          >
            <Tags data-icon="inline-start" />
            Review Transactions
          </Link>
          <StatusAction
            quarter={quarter}
            status="draft"
            disabled={
              quarter.status === "draft" || quarter.status === "published"
            }
          >
            <Save data-icon="inline-start" />
            Draft
          </StatusAction>
          <StatusAction
            quarter={quarter}
            status="ready_for_review"
            disabled={
              quarter.status === "ready_for_review" ||
              quarter.status === "published" ||
              readyStep?.status !== "current"
            }
          >
            <CheckCircle2 data-icon="inline-start" />
            Mark Ready
          </StatusAction>
          <StatusAction
            quarter={quarter}
            status="published"
            variant="default"
            disabled={
              quarter.status === "published" ||
              publishStep?.status !== "current"
            }
          >
            <LockKeyhole data-icon="inline-start" />
            Publish Quarter
          </StatusAction>
        </div>
      ) : null}

      {canManage ? <ReopenForm quarter={quarter} /> : null}

      <details className="mt-5 rounded-md border border-border bg-background">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
          <History className="size-4 text-primary" aria-hidden="true" />
          Status History
        </summary>
        {quarter.history.length > 0 ? (
          <ol className="divide-y divide-border px-4 pb-4">
            {quarter.history.map((event) => (
              <li key={event.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">{event.summary}</p>
                  <time className="text-xs text-muted-foreground">
                    {formatTimestamp(event.createdAt)}
                  </time>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.actorWalletAddress
                    ? `${event.actorWalletAddress.slice(0, 6)}...${event.actorWalletAddress.slice(-4)}`
                    : "System"}
                </p>
                {typeof event.metadata?.reason === "string" &&
                event.metadata.reason ? (
                  <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    {event.metadata.reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            No history yet.
          </p>
        )}
      </details>
    </article>
  );
}

function AdminGate() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="container-custom py-10">
        <Link
          href="/"
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
        >
          <ArrowLeft data-icon="inline-start" />
          Home
        </Link>
        <div className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm">
          <p className="type-label-sm text-muted-foreground">Admin</p>
          <h1 className="mt-2 text-2xl font-semibold">
            Admin access required
          </h1>
        </div>
      </section>
    </main>
  );
}

export default async function QuartersPage() {
  const session = await getAuthSession();
  const sessionState = serializeSession(session);

  if (!sessionState.authenticated || !sessionState.permissions?.canAccess) {
    return <AdminGate />;
  }

  const reportingPeriods = await listQuarterReportingPeriods();
  const canManage = Boolean(sessionState.permissions.canAdmin);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader initialSession={sessionState} />

      <section className="container-custom grid gap-8 py-8 md:py-12">
        {canManage ? (
          <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="type-label-sm text-muted-foreground">
                  Q1 Export Target
                </p>
                <h2 className="mt-2 text-xl font-semibold">
                  Q1 2026 reporting period
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Create the calendar quarter used for accounting preparation,
                  review, publishing, and member exports.
                </p>
              </div>
              <form action={createQ1ReportingPeriod}>
                <Button type="submit">
                  <Save data-icon="inline-start" />
                  Create Q1 2026
                </Button>
              </form>
            </div>
          </section>
        ) : null}

        {reportingPeriods.length > 0 ? (
          <div className="grid gap-5">
            {reportingPeriods.map((quarter) => (
              <QuarterCard
                key={quarter.id}
                canManage={canManage}
                quarter={quarter}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            No reporting periods yet.
          </div>
        )}
      </section>
    </main>
  );
}
