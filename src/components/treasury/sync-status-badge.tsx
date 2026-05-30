"use client";

import { CheckCircle2, RefreshCw, WifiOff } from "lucide-react";

import type { TreasurySnapshotStatus } from "@/lib/treasury/types";

const STATUS_COPY: Record<
  TreasurySnapshotStatus,
  { label: string; tone: string }
> = {
  pending_live_sync: {
    label: "Pending live sync",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-800",
  },
  synced: {
    label: "Synced",
    tone: "border-emerald-600/25 bg-emerald-600/10 text-emerald-800",
  },
  stale_syncing: {
    label: "Refreshing",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-800",
  },
  partial: {
    label: "Partially synced",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-800",
  },
  failed: {
    label: "Sync unavailable",
    tone: "border-destructive/25 bg-destructive/10 text-destructive",
  },
};

export function SyncStatusBadge({
  isRefreshing,
  status,
}: {
  isRefreshing: boolean;
  status: TreasurySnapshotStatus;
}) {
  const copy = STATUS_COPY[isRefreshing ? "stale_syncing" : status];
  const isSpinning =
    isRefreshing || status === "pending_live_sync" || status === "stale_syncing";
  const Icon =
    status === "failed" && !isRefreshing
      ? WifiOff
      : status === "synced" && !isRefreshing
        ? CheckCircle2
        : RefreshCw;

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${copy.tone}`}
    >
      <Icon
        className={`size-3.5 ${isSpinning ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      {copy.label}
    </div>
  );
}
