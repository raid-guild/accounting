"use client";

import {
  CircleDollarSign,
  Coins,
  FileSpreadsheet,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CopyAddressButton } from "@/components/treasury/copy-address-button";
import { SyncStatusBadge } from "@/components/treasury/sync-status-badge";
import type { TreasuryBalanceSnapshot } from "@/lib/treasury/types";

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

function isTreasuryBalanceSnapshot(
  value: unknown,
): value is TreasuryBalanceSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const snapshot = value as Partial<TreasuryBalanceSnapshot>;

  return (
    Array.isArray(snapshot.accounts) &&
    snapshot.accounts.length > 0 &&
    Array.isArray(snapshot.assets) &&
    typeof snapshot.status === "string" &&
    typeof snapshot.totalUsd === "string"
  );
}

function getSyncCopy(snapshot: TreasuryBalanceSnapshot, isRefreshing: boolean) {
  if (isRefreshing) {
    return snapshot.syncedAt
      ? `Refreshing. Last synced ${formatTimestamp(snapshot.syncedAt)}`
      : "Fetching live treasury balances";
  }

  if (snapshot.status === "failed" && snapshot.errorMessage) {
    return snapshot.errorMessage;
  }

  if (snapshot.syncedAt) {
    return snapshot.status === "partial"
      ? `Synced at ${formatTimestamp(snapshot.syncedAt)}. wETH price unavailable.`
      : `Synced at ${formatTimestamp(snapshot.syncedAt)}`;
  }

  return "Waiting for the first live treasury sync";
}

export function TreasuryDashboard({
  initialSnapshot,
}: {
  initialSnapshot: TreasuryBalanceSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const shouldRefresh = snapshot.isStale || !snapshot.syncedAt;

  useEffect(() => {
    let isMounted = true;

    if (!shouldRefresh) {
      return;
    }

    async function refreshSnapshot() {
      setIsRefreshing(true);

      try {
        const response = await fetch("/api/treasury/sync", {
          method: "POST",
        });
        const nextSnapshot = (await response.json()) as unknown;

        if (!isMounted) {
          return;
        }

        if (!response.ok || !isTreasuryBalanceSnapshot(nextSnapshot)) {
          setSnapshot((currentSnapshot) => ({
            ...currentSnapshot,
            errorMessage: "Treasury balance sync failed",
            status: "failed",
          }));
          return;
        }

        setSnapshot(nextSnapshot);

        setJustUpdated(true);
      } catch {
        if (!isMounted) {
          return;
        }

        try {
          const response = await fetch("/api/treasury/snapshot");
          const nextSnapshot = (await response.json()) as unknown;

          if (!isMounted) {
            return;
          }

          if (!response.ok || !isTreasuryBalanceSnapshot(nextSnapshot)) {
            setSnapshot((currentSnapshot) => ({
              ...currentSnapshot,
              errorMessage: "Treasury balance sync failed",
              status: "failed",
            }));
            return;
          }

          setSnapshot({
            ...nextSnapshot,
            errorMessage: "Treasury balance sync failed",
            status: "failed",
          });
        } catch {
          if (!isMounted) {
            return;
          }

          setSnapshot((currentSnapshot) => ({
            ...currentSnapshot,
            errorMessage: "Treasury balance sync failed",
            status: "failed",
          }));
        }
      } finally {
        if (isMounted) {
          setIsRefreshing(false);
        }
      }
    }

    refreshSnapshot();

    return () => {
      isMounted = false;
    };
  }, [shouldRefresh]);

  useEffect(() => {
    if (!justUpdated) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setJustUpdated(false);
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [justUpdated]);

  const syncCopy = useMemo(
    () => getSyncCopy(snapshot, isRefreshing),
    [snapshot, isRefreshing],
  );
  const isPopulating = isRefreshing && !snapshot.syncedAt;

  return (
    <section className="container-custom py-8 md:py-12">
      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <section
          className={`rounded-lg border border-border bg-card p-6 shadow-sm transition-all duration-500 ${
            justUpdated ? "ring-2 ring-primary/30" : ""
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="type-label text-muted-foreground">
                Current Treasury Balance
              </p>
              <p
                className={`mt-4 text-4xl font-semibold tracking-normal transition-opacity duration-500 md:text-5xl ${
                  isPopulating ? "opacity-40" : "opacity-100"
                }`}
              >
                {formatCurrency(snapshot.totalUsd)}
              </p>
              <p className="mt-4 text-sm text-muted-foreground">{syncCopy}</p>
              {justUpdated ? (
                <p className="mt-2 text-sm font-medium text-primary">
                  Updated just now
                </p>
              ) : null}
            </div>
            <SyncStatusBadge
              isRefreshing={isRefreshing}
              status={snapshot.status}
            />
          </div>

          <dl className="mt-8 grid gap-5 sm:grid-cols-3">
            <div>
              <dt className="type-label-sm text-muted-foreground">Accounts</dt>
              <dd className="mt-2 text-xl font-semibold">
                {snapshot.accounts.length}
              </dd>
            </div>
            <div>
              <dt className="type-label-sm text-muted-foreground">Assets</dt>
              <dd className="mt-2 text-xl font-semibold">
                {snapshot.assets.length}
              </dd>
            </div>
            <div>
              <dt className="type-label-sm text-muted-foreground">Source</dt>
              <dd className="mt-2 text-sm font-medium">Gnosis accounts</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
              <WalletCards className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="type-label-sm text-muted-foreground">Account</p>
              <h2 className="text-lg font-semibold">Included accounts</h2>
            </div>
          </div>

          <div className="mt-6 divide-y divide-border border-t border-border">
            {snapshot.accounts.map((account) => (
              <div key={account.id} className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {account.name}
                    </p>
                    {account.address ? (
                      <code className="mt-2 block truncate text-xs font-medium text-muted-foreground">
                        {formatAddress(account.address)}
                      </code>
                    ) : (
                      <p className="mt-2 text-xs font-medium text-muted-foreground">
                        Address not configured
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <p
                      className={`text-right text-sm font-semibold transition-opacity duration-500 ${
                        isPopulating ? "opacity-40" : "opacity-100"
                      }`}
                    >
                      {formatCurrency(account.totalUsd)}
                    </p>
                    {account.address ? (
                      <CopyAddressButton address={account.address} />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
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
        <div
          className={`mt-6 overflow-hidden rounded-md border border-border transition-opacity duration-500 ${
            isRefreshing ? "opacity-75" : "opacity-100"
          }`}
        >
          <div className="grid grid-cols-[1fr_1fr] gap-3 border-b border-border bg-muted px-4 py-3 text-xs font-medium uppercase text-muted-foreground sm:grid-cols-[1fr_1fr_1fr]">
            <span>Asset</span>
            <span className="text-right sm:text-left">Balance</span>
            <span className="hidden text-right sm:block">USD Value</span>
          </div>
          {snapshot.assets.map((asset) => (
            <div
              key={asset.symbol}
              className="grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-border px-4 py-4 transition-colors duration-500 last:border-b-0 sm:grid-cols-[1fr_1fr_1fr]"
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
              <dt className="type-label-sm text-muted-foreground">Status</dt>
              <dd className="mt-2 text-sm font-medium">Draft</dd>
            </div>
            <div>
              <dt className="type-label-sm text-muted-foreground">Access</dt>
              <dd className="mt-2 text-sm font-medium">Member view</dd>
            </div>
            <div>
              <dt className="type-label-sm text-muted-foreground">Revenue</dt>
              <dd className="mt-2 text-sm font-medium">$0.00</dd>
            </div>
            <div>
              <dt className="type-label-sm text-muted-foreground">Expenses</dt>
              <dd className="mt-2 text-sm font-medium">$0.00</dd>
            </div>
          </dl>
        </section>
      </div>
    </section>
  );
}
