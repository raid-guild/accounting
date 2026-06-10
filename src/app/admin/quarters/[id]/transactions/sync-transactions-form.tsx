"use client";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  finalizeQuarterSyncStep,
  startQuarterSync,
  syncQuarterMembershipStep,
  syncQuarterProposalsStep,
  syncQuarterTransactionsStep,
} from "@/app/admin/quarters/[id]/transactions/actions";
import { Button } from "@/components/ui/button";
import type {
  QuarterSyncStatus,
  QuarterSyncStep,
  QuarterSyncStepStatus,
} from "@/lib/quarter-sync";

const SYNC_STEPS: {
  key: QuarterSyncStep;
  label: string;
  statusKey:
    | "finalizeStatus"
    | "membershipStatus"
    | "proposalsStatus"
    | "transactionsStatus";
}[] = [
  {
    key: "transactions",
    label: "Transactions",
    statusKey: "transactionsStatus",
  },
  {
    key: "proposals",
    label: "Proposals",
    statusKey: "proposalsStatus",
  },
  {
    key: "membership",
    label: "Membership",
    statusKey: "membershipStatus",
  },
  {
    key: "finalize",
    label: "Finalize",
    statusKey: "finalizeStatus",
  },
];

function getStepStatus(
  status: QuarterSyncStatus | null,
  step: (typeof SYNC_STEPS)[number],
  activeStep: QuarterSyncStep | null,
): QuarterSyncStepStatus {
  if (activeStep === step.key) {
    return "running";
  }

  return status?.[step.statusKey] ?? "pending";
}

function getStepIcon(stepStatus: QuarterSyncStepStatus) {
  switch (stepStatus) {
    case "failed":
      return AlertTriangle;
    case "running":
      return Loader2;
    case "success":
      return CheckCircle2;
    case "pending":
      return RefreshCw;
  }
}

function getError(status: QuarterSyncStatus | null) {
  return (
    status?.transactionsError ??
    status?.proposalsError ??
    status?.membershipError ??
    status?.finalizeError ??
    null
  );
}

export function SyncTransactionsForm({
  initialSyncStatus,
  syncComplete,
  quarterId,
}: {
  initialSyncStatus: QuarterSyncStatus | null;
  syncComplete: boolean;
  quarterId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialSyncStatus);
  const [activeStep, setActiveStep] = useState<QuarterSyncStep | null>(null);
  const [error, setError] = useState<string | null>(getError(initialSyncStatus));
  const [isPending, startTransition] = useTransition();
  const isSyncing = isPending || activeStep !== null;
  const isComplete =
    !isSyncing && !error && syncComplete && status?.overallStatus === "success";
  const showStepDetails = isSyncing || Boolean(error);

  function runSync() {
    setError(null);
    startTransition(async () => {
      try {
        let nextStatus = await startQuarterSync(quarterId);
        setStatus(nextStatus);

        for (const step of SYNC_STEPS) {
          if (nextStatus[step.statusKey] === "success") {
            continue;
          }

          setActiveStep(step.key);
          if (step.key === "transactions") {
            nextStatus = await syncQuarterTransactionsStep({
              quarterId,
              runId: nextStatus.runId,
            });
          } else if (step.key === "proposals") {
            nextStatus = await syncQuarterProposalsStep({
              quarterId,
              runId: nextStatus.runId,
            });
          } else if (step.key === "membership") {
            nextStatus = await syncQuarterMembershipStep({
              quarterId,
              runId: nextStatus.runId,
            });
          } else {
            nextStatus = await finalizeQuarterSyncStep({
              quarterId,
              runId: nextStatus.runId,
              writeAudit: true,
            });
          }

          setStatus(nextStatus);
          router.refresh();

          const stepError = getError(nextStatus);
          if (nextStatus.overallStatus === "failed" && stepError) {
            setError(stepError);
            break;
          }
        }
      } catch (syncError) {
        setError(
          syncError instanceof Error ? syncError.message : "Sync failed",
        );
      } finally {
        setActiveStep(null);
        router.refresh();
      }
    });
  }

  if (isComplete) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-600/25 bg-emerald-600/10 px-3 py-2 text-sm font-medium text-emerald-800">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        <span>Sync complete</span>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <Button
        type="button"
        disabled={isSyncing}
        aria-busy={isSyncing}
        onClick={runSync}
        className="w-full justify-center"
      >
        <RefreshCw
          data-icon="inline-start"
          className={isSyncing ? "animate-spin" : ""}
          aria-hidden="true"
        />
        {isSyncing ? "Syncing Activity" : "Sync Activity"}
      </Button>
      {showStepDetails ? (
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SYNC_STEPS.map((step) => {
            const stepStatus = getStepStatus(status, step, activeStep);
            const Icon = getStepIcon(stepStatus);

            return (
              <li
                key={step.key}
                className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground"
              >
                <Icon
                  className={
                    stepStatus === "running" ? "size-3 animate-spin" : "size-3"
                  }
                  aria-hidden="true"
                />
                <span>{step.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {error ? (
        <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
