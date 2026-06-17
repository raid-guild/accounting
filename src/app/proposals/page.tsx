import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import {
  listProposalActivity,
  type ProposalActivityRow,
} from "@/lib/proposal-activity";

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatAmount(value: string) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
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

function ProposalLink({
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

function ProposalActivityTable({ rows }: { rows: ProposalActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
        No proposal-linked activity yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full min-w-[1080px] text-left text-sm">
        <thead className="border-b border-border text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Proposal</th>
            <th className="px-4 py-3 font-medium">Quarter</th>
            <th className="px-4 py-3 font-medium">Executed</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
            <th className="px-4 py-3 text-right font-medium">USD</th>
            <th className="px-4 py-3 font-medium">Classification</th>
            <th className="px-4 py-3 font-medium">Links</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.transferId}>
              <td className="max-w-[320px] px-4 py-4">
                <p className="truncate font-medium">{row.title}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {row.proposalNumber ?? row.proposalId}
                </p>
              </td>
              <td className="px-4 py-4">
                <p className="font-medium">{row.quarterLabel ?? "-"}</p>
                {row.quarterStatus ? (
                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                    {row.quarterStatus.replaceAll("_", " ")}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-4 text-muted-foreground">
                {formatTimestamp(row.executedAt)}
              </td>
              <td className="px-4 py-4 text-right font-medium">
                {formatAmount(row.assetAmount)} {row.assetSymbol}
              </td>
              <td className="px-4 py-4 text-right font-medium">
                {formatCurrency(row.usdAmount)}
              </td>
              <td className="px-4 py-4">
                <p className="font-medium">{row.category ?? "Unclassified"}</p>
                {row.counterpartyName ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.counterpartyName}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-4">
                <div className="flex flex-col items-start gap-1.5">
                  <ProposalLink href={row.daohausUrl}>DAOhaus</ProposalLink>
                  {row.explorerUrl ? (
                    <ProposalLink href={row.explorerUrl}>
                      {formatAddress(row.txHash)}
                    </ProposalLink>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatAddress(row.txHash)}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ProposalsPage() {
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
            <p className="type-label-sm text-muted-foreground">Proposals</p>
            <h1 className="mt-2 text-2xl font-semibold">
              Member access required
            </h1>
          </div>
        </section>
      </main>
    );
  }

  const rows = await listProposalActivity({
    visibility: session.permissions?.canAdmin ? "admin" : "member",
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader initialSession={session} />

      <section className="container-custom py-8 md:py-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="type-label-sm text-muted-foreground">
              Synced Proposal Links
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              Proposal-linked money movement
            </h2>
          </div>
          <span className="type-label-sm text-muted-foreground">
            {rows.length} transfers
          </span>
        </div>
        <ProposalActivityTable rows={rows} />
      </section>
    </main>
  );
}
