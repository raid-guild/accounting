import {
  ArrowLeft,
  ExternalLink,
  ShieldCheck,
  UserRoundPlus,
} from "lucide-react";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { CopyableAddress } from "@/components/copyable-address";
import { grantClericRole, revokeClericRole } from "@/app/membership/actions";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import { listClericRoles, type ClericRoleRow } from "@/lib/cleric-roles";
import {
  formatMembershipCurrency,
  getMembershipActivityReport,
  type MembershipActivityRow,
} from "@/lib/membership-activity";

type MembershipSearchParams = Promise<{
  cleric?: string | string[];
}>;

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

function getQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function ClericRoleMessage({ value }: { value?: string }) {
  if (!value) {
    return null;
  }

  const messages: Record<
    string,
    { tone: "success" | "error"; text: string }
  > = {
    exists: {
      text: "That wallet already has active Cleric access.",
      tone: "error",
    },
    granted: {
      text: "Cleric access granted.",
      tone: "success",
    },
    invalid: {
      text: "Enter a valid EVM wallet address.",
      tone: "error",
    },
    missing: {
      text: "That Cleric role was not found or is already revoked.",
      tone: "error",
    },
    revoked: {
      text: "Cleric access revoked.",
      tone: "success",
    },
  };
  const message = messages[value];

  if (!message) {
    return null;
  }

  return (
    <div
      className={
        message.tone === "success"
          ? "rounded-lg border border-emerald-600/20 bg-emerald-600/10 p-4 text-sm font-medium text-emerald-800"
          : "rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive"
      }
    >
      {message.text}
    </div>
  );
}

function ClericAccessSection({
  clericRoles,
  query,
}: {
  clericRoles: ClericRoleRow[];
  query?: string;
}) {
  const activeRoles = clericRoles.filter((role) => !role.revokedAt);

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="type-label-sm text-muted-foreground">
              Angry Dwarf Access
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Clerics</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Clerics can create and manage raid-oriented accounting records.
              They do not get provider, account, quarter publishing, or role
              management permissions.
            </p>
          </div>
        </div>
        <span className="rounded-lg border border-border bg-background px-3 py-1 text-sm font-medium text-muted-foreground">
          {activeRoles.length} active
        </span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <div className="rounded-lg border border-border bg-background p-4">
          <div className="mb-4 flex items-center gap-2">
            <UserRoundPlus className="size-4 text-primary" aria-hidden="true" />
            <h3 className="font-semibold">Grant Cleric access</h3>
          </div>
          <form action={grantClericRole} className="grid gap-3">
            <label className="grid gap-2 text-sm font-medium text-muted-foreground">
              Wallet address
              <input
                name="walletAddress"
                placeholder="0x..."
                autoComplete="off"
                className="h-10 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <button
              type="submit"
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 active:translate-y-px"
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              Grant Cleric
            </button>
          </form>
        </div>

        <div className="grid gap-4">
          <ClericRoleMessage value={query} />

          {clericRoles.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border bg-background">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Wallet</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Granted</th>
                    <th className="px-4 py-3 font-medium">Revoked</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {clericRoles.map((role) => (
                    <tr key={role.id}>
                      <td className="px-4 py-4">
                        <CopyableAddress
                          address={role.walletAddress}
                          className="font-medium"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={
                            role.revokedAt
                              ? "inline-flex rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
                              : "inline-flex rounded-md border border-emerald-600/20 bg-emerald-600/10 px-2 py-1 text-xs font-medium text-emerald-800"
                          }
                        >
                          {role.revokedAt ? "Revoked" : "Active"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {formatTimestamp(role.createdAt.toISOString())}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {role.revokedAt
                          ? formatTimestamp(role.revokedAt.toISOString())
                          : "-"}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {role.revokedAt ? null : (
                          <form action={revokeClericRole}>
                            <input
                              type="hidden"
                              name="roleId"
                              value={role.id}
                            />
                            <button
                              type="submit"
                              className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg bg-destructive/10 px-3 text-sm font-medium text-destructive transition-all hover:bg-destructive/20 active:translate-y-px"
                            >
                              Revoke
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
              No Cleric roles have been granted yet.
            </div>
          )}
        </div>
      </div>
    </section>
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
                <CopyableAddress
                  address={row.memberAddress}
                  className="font-medium"
                />
                {row.recipientAddress &&
                row.recipientAddress.toLowerCase() !==
                  row.memberAddress.toLowerCase() ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    <CopyableAddress
                      address={row.recipientAddress}
                      label="To"
                    />
                  </div>
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

export default async function MembershipPage({
  searchParams,
}: {
  searchParams?: MembershipSearchParams;
}) {
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

  const params = await searchParams;
  const canManageClerics = Boolean(session.permissions.canAdmin);
  const [report, clericRoles] = await Promise.all([
    getMembershipActivityReport({
      visibility: session.permissions.canAdmin ? "admin" : "member",
    }),
    canManageClerics ? listClericRoles() : Promise.resolve([]),
  ]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader initialSession={session} />

      <section className="container-custom grid gap-8 py-8 md:py-12">
        {canManageClerics ? (
          <ClericAccessSection
            clericRoles={clericRoles}
            query={getQueryValue(params?.cleric)}
          />
        ) : null}

        <div>
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
        </div>
      </section>
    </main>
  );
}
