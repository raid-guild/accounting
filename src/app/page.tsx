import {
  CircleDollarSign,
  Coins,
  FileSpreadsheet,
  LockKeyhole,
  WalletCards,
} from "lucide-react";
import Image from "next/image";

import { WalletConnect } from "@/components/auth/wallet-connect";
import { CopyAddressButton } from "@/components/treasury/copy-address-button";
import { SyncStatusBadge } from "@/components/treasury/sync-status-badge";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import { getTreasuryBalanceSnapshot } from "@/lib/treasury/balances";
import type { TreasuryBalanceSnapshot } from "@/lib/treasury/types";

async function getSessionState() {
  try {
    const session = await getAuthSession();
    return serializeSession(session);
  } catch {
    return {
      address: null,
      authenticated: false,
      chainId: null,
      permissions: null,
    };
  }
}

type SessionState = Awaited<ReturnType<typeof getSessionState>>;

function formatCurrency(value: string) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value));
}

function formatNumber(value: string) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 2,
  }).format(Number(value));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function PublicHome({ session }: { session: SessionState }) {
  return (
    <main className="min-h-screen bg-moloch-800 text-scroll-100">
      <section className="container-custom flex min-h-screen items-center py-10">
        <div className="grid w-full items-center gap-10 lg:grid-cols-[1fr_0.8fr]">
          <div className="max-w-3xl">
            <Image
              src="/raidguild-full-logo.svg"
              alt="RaidGuild"
              width={420}
              height={110}
              priority
              className="h-auto w-64 max-w-full"
            />
            <p className="mt-10 type-label text-scroll-300">
              Accounting Dashboard
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-normal text-scroll-100 md:text-6xl">
              Member access for treasury reporting.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-scroll-200">
              Connect a RaidGuild member wallet to view treasury balances and
              export-ready accounting records.
            </p>
          </div>

          <div className="rounded-lg border border-scroll-300/20 bg-moloch-700/60 p-6 shadow-2xl shadow-black/20">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <LockKeyhole className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="type-label-sm text-scroll-300">
                  Wallet Required
                </p>
                <h2 className="text-xl font-semibold text-scroll-100">
                  Sign in with Ethereum
                </h2>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-scroll-200">
              Access is checked against DAO shares, Angry Dwarf Hats, and
              database-managed Cleric permissions.
            </p>
            <div className="mt-6 flex justify-start">
              <WalletConnect initialSession={session} />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function MemberHome({
  session,
  snapshot,
}: {
  session: SessionState;
  snapshot: TreasuryBalanceSnapshot;
}) {
  const treasury = snapshot.accounts[0];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-moloch-800 bg-moloch-800 text-scroll-100">
        <div className="container-custom flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/raidguild-full-logo.svg"
              alt="RaidGuild"
              width={120}
              height={32}
              className="h-7 w-auto"
            />
            <div>
              <p className="type-label-sm text-scroll-200">RaidGuild</p>
              <h1 className="text-base font-semibold leading-none">
                Accounting
              </h1>
            </div>
          </div>
          <WalletConnect initialSession={session} />
        </div>
      </header>

      <section className="container-custom py-8 md:py-12">
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="type-label text-muted-foreground">
                  Current Treasury Balance
                </p>
                <p className="mt-4 text-4xl font-semibold tracking-normal md:text-5xl">
                  {formatCurrency(snapshot.totalUsd)}
                </p>
                <p className="mt-4 text-sm text-muted-foreground">
                  Snapshot as of {formatTimestamp(snapshot.asOf)}
                </p>
              </div>
              <SyncStatusBadge />
            </div>

            <dl className="mt-8 grid gap-5 sm:grid-cols-3">
              <div>
                <dt className="type-label-sm text-muted-foreground">
                  Accounts
                </dt>
                <dd className="mt-2 text-xl font-semibold">
                  {snapshot.accounts.length}
                </dd>
              </div>
              <div>
                <dt className="type-label-sm text-muted-foreground">
                  Assets
                </dt>
                <dd className="mt-2 text-xl font-semibold">
                  {treasury.assets.length}
                </dd>
              </div>
              <div>
                <dt className="type-label-sm text-muted-foreground">
                  Source
                </dt>
                <dd className="mt-2 text-sm font-medium">Gnosis Safe</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <WalletCards className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="type-label-sm text-muted-foreground">
                  Account
                </p>
                <h2 className="text-lg font-semibold">{treasury.name}</h2>
              </div>
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <p className="type-label-sm text-muted-foreground">
                Configured Safe
              </p>
              {treasury.address ? (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <code className="min-w-0 truncate text-sm font-medium">
                    {formatAddress(treasury.address)}
                  </code>
                  <CopyAddressButton address={treasury.address} />
                </div>
              ) : (
                <p className="mt-3 text-sm font-medium text-muted-foreground">
                  Address not configured
                </p>
              )}
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <p className="type-label-sm text-muted-foreground">
                Account Total
              </p>
              <p className="mt-3 text-2xl font-semibold tracking-normal">
                {formatCurrency(treasury.totalUsd)}
              </p>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Coins className="size-5 text-primary" aria-hidden="true" />
            <div>
              <p className="type-label-sm text-muted-foreground">
                Asset Breakdown
              </p>
              <h2 className="text-lg font-semibold">Tracked treasury assets</h2>
            </div>
          </div>
          <div className="mt-6 overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[1fr_1fr] gap-3 border-b border-border bg-muted px-4 py-3 text-xs font-medium uppercase text-muted-foreground sm:grid-cols-[1fr_1fr_1fr]">
              <span>Asset</span>
              <span className="text-right sm:text-left">Balance</span>
              <span className="hidden text-right sm:block">USD Value</span>
            </div>
            {treasury.assets.map((asset) => (
              <div
                key={asset.symbol}
                className="grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-border px-4 py-4 last:border-b-0 sm:grid-cols-[1fr_1fr_1fr]"
              >
                <div>
                  <p className="text-sm font-semibold">{asset.symbol}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {asset.name}
                  </p>
                </div>
                <p className="text-right text-sm font-medium sm:text-left">
                  {formatNumber(asset.balance)} {asset.symbol}
                </p>
                <p className="hidden text-right text-sm font-semibold sm:block">
                  {formatCurrency(asset.usdValue)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CircleDollarSign
                  className="size-5 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <p className="type-label-sm text-muted-foreground">
                    Revenue Priority
                  </p>
                  <h2 className="text-lg font-semibold">
                    Revenue-first reporting
                  </h2>
                </div>
              </div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {["Taxable Revenue", "P&L Summary", "Q1 Workbook"].map((label) => (
                <div
                  key={label}
                  className="rounded-md border border-border bg-background px-4 py-3 text-sm font-medium"
                >
                  <FileSpreadsheet
                    data-icon="inline-start"
                    className="text-primary"
                  />
                  {label}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <FileSpreadsheet
                className="size-5 text-primary"
                aria-hidden="true"
              />
              <div>
                <p className="type-label-sm text-muted-foreground">
                  Reporting Window
                </p>
                <h2 className="text-lg font-semibold">Q1 export readiness</h2>
              </div>
            </div>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="type-label-sm text-muted-foreground">
                  Status
                </dt>
                <dd className="mt-2 text-sm font-medium">Draft</dd>
              </div>
              <div>
                <dt className="type-label-sm text-muted-foreground">
                  Access
                </dt>
                <dd className="mt-2 text-sm font-medium">Member view</dd>
              </div>
              <div>
                <dt className="type-label-sm text-muted-foreground">
                  Revenue
                </dt>
                <dd className="mt-2 text-sm font-medium">$0.00</dd>
              </div>
              <div>
                <dt className="type-label-sm text-muted-foreground">
                  Expenses
                </dt>
                <dd className="mt-2 text-sm font-medium">$0.00</dd>
              </div>
            </dl>
          </section>
        </div>
      </section>
    </main>
  );
}

export default async function Home() {
  const session = await getSessionState();

  if (!session.authenticated) {
    return <PublicHome session={session} />;
  }

  const snapshot = await getTreasuryBalanceSnapshot();

  return <MemberHome session={session} snapshot={snapshot} />;
}
