import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import {
  formatMembershipCurrency,
  getMembershipActivityReport,
  type MembershipActivityRow,
} from "@/lib/membership-activity";

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAddress(value: string | null) {
  if (!value) {
    return "-";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatAmount({
  amount,
  symbol,
}: {
  amount: string | null;
  symbol: string | null;
}) {
  if (!amount || !symbol) {
    return "-";
  }

  const number = Number(amount);
  const formatted = Number.isFinite(number)
    ? new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 6,
        minimumFractionDigits: 0,
      }).format(number)
    : amount;

  return `${formatted} ${symbol}`;
}

function formatShares(value: string | null) {
  if (!value) {
    return "-";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  }).format(number);
}

function formatCurrency(value: string | null) {
  if (!value) {
    return "-";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(number);
}

function ActivityType({ type }: { type: MembershipActivityRow["type"] }) {
  const label = type === "join" ? "Membership Join" : "Ragequit";

  return (
    <span className="inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
      {label}
    </span>
  );
}

function ReportLink({
  children,
  href,
}: {
  children: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80 hover:underline"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="type-label-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  );
}

function MembershipActivityTable({ rows }: { rows: MembershipActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
        No synced membership activity yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full min-w-[1120px] text-left text-sm">
        <thead className="border-b border-border text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Activity</th>
            <th className="px-4 py-3 font-medium">Member</th>
            <th className="px-4 py-3 font-medium">Executed</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
            <th className="px-4 py-3 text-right font-medium">USD</th>
            <th className="px-4 py-3 text-right font-medium">Shares</th>
            <th className="px-4 py-3 font-medium">Quarter</th>
            <th className="px-4 py-3 font-medium">Links</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={`${row.type}:${row.txHash}:${row.memberAddress}`}>
              <td className="max-w-[280px] px-4 py-4">
                <ActivityType type={row.type} />
                {row.proposalTitle ? (
                  <p className="mt-2 truncate font-medium">
                    {row.proposalTitle}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-4">
                <p className="font-mono font-medium">
                  {formatAddress(row.memberAddress)}
                </p>
                {row.recipientAddress &&
                row.recipientAddress.toLowerCase() !==
                  row.memberAddress.toLowerCase() ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    To {formatAddress(row.recipientAddress)}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-4 text-muted-foreground">
                {formatTimestamp(row.executedAt)}
              </td>
              <td className="px-4 py-4 text-right font-medium">
                {formatAmount({
                  amount: row.assetAmount,
                  symbol: row.assetSymbol,
                })}
              </td>
              <td className="px-4 py-4 text-right font-medium">
                {formatCurrency(row.usdAmount)}
              </td>
              <td className="px-4 py-4 text-right">
                <p className="font-medium">{formatShares(row.shares)}</p>
                {row.loot ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatShares(row.loot)} loot
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-4">
                <p className="font-medium">{row.quarterLabel ?? "-"}</p>
                {row.quarterStatus ? (
                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                    {row.quarterStatus.replaceAll("_", " ")}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-4">
                <div className="flex flex-col items-start gap-1.5">
                  {row.daohausUrl ? (
                    <ReportLink href={row.daohausUrl}>DAOhaus</ReportLink>
                  ) : null}
                  <ReportLink href={row.explorerUrl}>
                    {formatAddress(row.txHash)}
                  </ReportLink>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MembershipPage() {
  const session = serializeSession(await getAuthSession());

  if (!session.authenticated || !session.permissions?.canAccess) {
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
            <p className="type-label-sm text-muted-foreground">Membership</p>
            <h1 className="mt-2 text-2xl font-semibold">
              Member access required
            </h1>
          </div>
        </section>
      </main>
    );
  }

  const report = await getMembershipActivityReport({
    visibility: session.permissions.canAdmin ? "admin" : "member",
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader initialSession={session} />

      <section className="container-custom py-8 md:py-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="type-label-sm text-muted-foreground">
              Synced Membership Events
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              Joins, dues, and ragequits
            </h2>
          </div>
          <span className="type-label-sm text-muted-foreground">
            {report.rows.length} events
          </span>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-5">
          <SummaryMetric
            label="New Members"
            value={String(report.summary.joinCount)}
          />
          <SummaryMetric
            label="Ragequits"
            value={String(report.summary.ragequitCount)}
          />
          <SummaryMetric
            label="Member Dues"
            value={formatMembershipCurrency(report.summary.memberDuesCents)}
          />
          <SummaryMetric
            label="Ragequit Outflows"
            value={formatMembershipCurrency(
              report.summary.ragequitOutflowCents,
            )}
          />
          <SummaryMetric
            label="Net Membership"
            value={formatMembershipCurrency(report.summary.netCents)}
          />
        </div>

        <MembershipActivityTable rows={report.rows} />
      </section>
    </main>
  );
}
