import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import {
  quarterSyncOverallStatusEnum,
  quarterSyncStatuses,
  quarterSyncStepEnum,
  quarterSyncStepStatusEnum,
  quarters,
} from "@/db/schema";

export type QuarterSyncStep = (typeof quarterSyncStepEnum.enumValues)[number];
export type QuarterSyncStepStatus =
  (typeof quarterSyncStepStatusEnum.enumValues)[number];
export type QuarterSyncOverallStatus =
  (typeof quarterSyncOverallStatusEnum.enumValues)[number];

export type QuarterSyncStatus = {
  id: string;
  quarterId: string;
  runId: string;
  overallStatus: QuarterSyncOverallStatus;
  currentStep: QuarterSyncStep | null;
  transactionsStatus: QuarterSyncStepStatus;
  proposalsStatus: QuarterSyncStepStatus;
  membershipStatus: QuarterSyncStepStatus;
  finalizeStatus: QuarterSyncStepStatus;
  transactionsError: string | null;
  proposalsError: string | null;
  membershipError: string | null;
  finalizeError: string | null;
  importedTransactions: number;
  importedTransfers: number;
  scannedTransfers: number;
  syncErrorCount: number;
  proposalLinkedTransactions: number;
  proposalMatches: number;
  membershipActivities: number;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuarterWorkflowStep = {
  key: "sync" | "classify" | "ready" | "publish";
  label: string;
  status: "complete" | "current" | "blocked" | "pending" | "failed";
  detail: string;
};

type QuarterLike = Pick<
  typeof quarters.$inferSelect,
  "endsOn" | "startsOn" | "status"
> | {
  endsOn: string;
  startsOn: string;
  status: string;
};

const FRESH_BUFFER_MS = 60 * 1000;

function asNumber(value: number | null) {
  return value ?? 0;
}

function asIso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export function getQuarterEndsAtExclusive(quarter: Pick<QuarterLike, "endsOn">) {
  const endsAtExclusive = new Date(`${quarter.endsOn}T00:00:00.000Z`);
  endsAtExclusive.setUTCDate(endsAtExclusive.getUTCDate() + 1);

  return endsAtExclusive;
}

export function mapQuarterSyncStatus(
  status: typeof quarterSyncStatuses.$inferSelect,
): QuarterSyncStatus {
  return {
    id: status.id,
    quarterId: status.quarterId,
    runId: status.runId,
    overallStatus: status.overallStatus,
    currentStep: status.currentStep,
    transactionsStatus: status.transactionsStatus,
    proposalsStatus: status.proposalsStatus,
    membershipStatus: status.membershipStatus,
    finalizeStatus: status.finalizeStatus,
    transactionsError: status.transactionsError,
    proposalsError: status.proposalsError,
    membershipError: status.membershipError,
    finalizeError: status.finalizeError,
    importedTransactions: asNumber(status.importedTransactions),
    importedTransfers: asNumber(status.importedTransfers),
    scannedTransfers: asNumber(status.scannedTransfers),
    syncErrorCount: asNumber(status.syncErrorCount),
    proposalLinkedTransactions: asNumber(status.proposalLinkedTransactions),
    proposalMatches: asNumber(status.proposalMatches),
    membershipActivities: asNumber(status.membershipActivities),
    lastSyncedAt: asIso(status.lastSyncedAt),
    createdAt: status.createdAt.toISOString(),
    updatedAt: status.updatedAt.toISOString(),
  };
}

export async function getQuarterSyncStatus(quarterId: string) {
  const [status] = await getDb()
    .select()
    .from(quarterSyncStatuses)
    .where(eq(quarterSyncStatuses.quarterId, quarterId))
    .limit(1);

  return status ? mapQuarterSyncStatus(status) : null;
}

export async function getQuarterSyncStatusMap(quarterIds: string[]) {
  if (quarterIds.length === 0) {
    return new Map<string, QuarterSyncStatus>();
  }

  const rows = await getDb()
    .select()
    .from(quarterSyncStatuses)
    .where(inArray(quarterSyncStatuses.quarterId, quarterIds));

  return new Map(
    rows.map((status) => [status.quarterId, mapQuarterSyncStatus(status)]),
  );
}

export function isQuarterSyncFresh({
  quarter,
  syncStatus,
}: {
  quarter: Pick<QuarterLike, "endsOn">;
  syncStatus: QuarterSyncStatus | null;
}) {
  if (syncStatus?.overallStatus !== "success" || !syncStatus.lastSyncedAt) {
    return false;
  }

  const lastSyncedAt = new Date(syncStatus.lastSyncedAt).getTime();
  const endsAtExclusive = getQuarterEndsAtExclusive(quarter).getTime();

  return lastSyncedAt + FRESH_BUFFER_MS >= endsAtExclusive;
}

export function buildQuarterWorkflowSteps({
  classificationSummary,
  quarter,
  syncStatus,
}: {
  classificationSummary: {
    classifiedTransfers: number;
    totalTransfers: number;
    unclassifiedTransfers: number;
  };
  quarter: QuarterLike;
  syncStatus: QuarterSyncStatus | null;
}): QuarterWorkflowStep[] {
  const syncFresh = isQuarterSyncFresh({ quarter, syncStatus });
  const syncFailed =
    syncStatus?.overallStatus === "failed" ||
    syncStatus?.overallStatus === "partial";
  const syncRunning = syncStatus?.overallStatus === "running";
  const lastSyncedAt = syncStatus?.lastSyncedAt ?? null;
  const syncStep: QuarterWorkflowStep =
    syncFresh
      ? {
          detail: lastSyncedAt
            ? `Synced ${new Date(lastSyncedAt).toLocaleString()}`
            : "Synced",
          key: "sync",
          label: "Sync activity",
          status: "complete",
        }
      : syncRunning
        ? {
            detail: "Sync in progress",
            key: "sync",
            label: "Sync activity",
            status: "current",
          }
        : syncFailed
          ? {
              detail: "Resolve the sync error, then resume",
              key: "sync",
              label: "Sync activity",
              status: "failed",
            }
          : syncStatus?.overallStatus === "success"
            ? {
                detail: "Sync again after the quarter has ended",
                key: "sync",
                label: "Sync activity",
                status: "blocked",
              }
            : {
                detail: "Import treasury activity first",
                key: "sync",
                label: "Sync activity",
                status: "current",
              };

  const classificationComplete =
    syncFresh && classificationSummary.unclassifiedTransfers === 0;
  const classifyStep: QuarterWorkflowStep = classificationComplete
    ? {
        detail: `${classificationSummary.classifiedTransfers} / ${classificationSummary.totalTransfers} classified`,
        key: "classify",
        label: "Classify transactions",
        status: "complete",
      }
    : {
        detail: syncFresh
          ? `${classificationSummary.unclassifiedTransfers} remaining`
          : "Available after sync",
        key: "classify",
        label: "Classify transactions",
        status: syncFresh ? "current" : "blocked",
      };

  const readyComplete =
    quarter.status === "ready_for_review" || quarter.status === "published";
  const readyStep: QuarterWorkflowStep = readyComplete
    ? {
        detail: "Ready for publishing",
        key: "ready",
        label: "Mark ready",
        status: "complete",
      }
    : {
        detail: classificationComplete ? "Ready to mark" : "Finish review first",
        key: "ready",
        label: "Mark ready",
        status: classificationComplete ? "current" : "blocked",
      };

  const publishStep: QuarterWorkflowStep =
    quarter.status === "published"
      ? {
          detail: "Members can view this quarter",
          key: "publish",
          label: "Publish",
          status: "complete",
        }
      : quarter.status === "ready_for_review" && classificationComplete
        ? {
            detail: "Ready to publish",
            key: "publish",
            label: "Publish",
            status: "current",
          }
        : {
            detail:
              quarter.status === "ready_for_review"
                ? "Finish review first"
                : "Mark ready first",
            key: "publish",
            label: "Publish",
            status: "blocked",
          };

  return [syncStep, classifyStep, readyStep, publishStep];
}

export async function startOrResumeQuarterSync(quarterId: string) {
  const existing = await getQuarterSyncStatus(quarterId);
  const shouldResume =
    existing &&
    (existing.overallStatus === "running" ||
      existing.overallStatus === "failed" ||
      existing.overallStatus === "partial");

  if (shouldResume) {
    return existing;
  }

  const runId = crypto.randomUUID();
  const [status] = await getDb()
    .insert(quarterSyncStatuses)
    .values({
      currentStep: "transactions",
      finalizeCompletedAt: null,
      finalizeError: null,
      finalizeStartedAt: null,
      finalizeStatus: "pending",
      importedTransactions: 0,
      importedTransfers: 0,
      lastSyncedAt: null,
      membershipActivities: 0,
      membershipCompletedAt: null,
      membershipError: null,
      membershipStartedAt: null,
      membershipStatus: "pending",
      overallStatus: "running",
      proposalLinkedTransactions: 0,
      proposalMatches: 0,
      proposalsCompletedAt: null,
      proposalsError: null,
      proposalsStartedAt: null,
      proposalsStatus: "pending",
      quarterId,
      runId,
      scannedTransfers: 0,
      syncErrorCount: 0,
      transactionsCompletedAt: null,
      transactionsError: null,
      transactionsStartedAt: null,
      transactionsStatus: "pending",
    })
    .onConflictDoUpdate({
      set: {
        currentStep: "transactions",
        finalizeCompletedAt: null,
        finalizeError: null,
        finalizeStartedAt: null,
        finalizeStatus: "pending",
        importedTransactions: 0,
        importedTransfers: 0,
        lastSyncedAt: null,
        membershipActivities: 0,
        membershipCompletedAt: null,
        membershipError: null,
        membershipStartedAt: null,
        membershipStatus: "pending",
        overallStatus: "running",
        proposalLinkedTransactions: 0,
        proposalMatches: 0,
        proposalsCompletedAt: null,
        proposalsError: null,
        proposalsStartedAt: null,
        proposalsStatus: "pending",
        runId,
        scannedTransfers: 0,
        syncErrorCount: 0,
        transactionsCompletedAt: null,
        transactionsError: null,
        transactionsStartedAt: null,
        transactionsStatus: "pending",
      },
      target: quarterSyncStatuses.quarterId,
    })
    .returning();

  return mapQuarterSyncStatus(status);
}

export async function markQuarterSyncStepRunning({
  quarterId,
  runId,
  step,
}: {
  quarterId: string;
  runId: string;
  step: QuarterSyncStep;
}) {
  const now = new Date();
  const updateByStep = {
    finalize: {
      currentStep: "finalize" as const,
      finalizeCompletedAt: null,
      finalizeError: null,
      finalizeStartedAt: now,
      finalizeStatus: "running" as const,
    },
    membership: {
      currentStep: "membership" as const,
      membershipCompletedAt: null,
      membershipError: null,
      membershipStartedAt: now,
      membershipStatus: "running" as const,
    },
    proposals: {
      currentStep: "proposals" as const,
      proposalsCompletedAt: null,
      proposalsError: null,
      proposalsStartedAt: now,
      proposalsStatus: "running" as const,
    },
    transactions: {
      currentStep: "transactions" as const,
      transactionsCompletedAt: null,
      transactionsError: null,
      transactionsStartedAt: now,
      transactionsStatus: "running" as const,
    },
  };

  const [status] = await getDb()
    .update(quarterSyncStatuses)
    .set({
      overallStatus: "running",
      ...updateByStep[step],
    })
    .where(
      and(
        eq(quarterSyncStatuses.quarterId, quarterId),
        eq(quarterSyncStatuses.runId, runId),
      ),
    )
    .returning();

  if (!status) {
    throw new Error("Sync run changed. Refresh and try again.");
  }

  return mapQuarterSyncStatus(status);
}

export async function markQuarterSyncStepFailed({
  counts,
  error,
  quarterId,
  runId,
  step,
}: {
  counts?: Partial<
    Pick<
      QuarterSyncStatus,
      | "importedTransactions"
      | "importedTransfers"
      | "membershipActivities"
      | "proposalLinkedTransactions"
      | "proposalMatches"
      | "scannedTransfers"
      | "syncErrorCount"
    >
  >;
  error: string;
  quarterId: string;
  runId: string;
  step: QuarterSyncStep;
}) {
  const now = new Date();
  const updateByStep = {
    finalize: {
      finalizeCompletedAt: now,
      finalizeError: error,
      finalizeStatus: "failed" as const,
    },
    membership: {
      membershipCompletedAt: now,
      membershipError: error,
      membershipStatus: "failed" as const,
    },
    proposals: {
      proposalsCompletedAt: now,
      proposalsError: error,
      proposalsStatus: "failed" as const,
    },
    transactions: {
      transactionsCompletedAt: now,
      transactionsError: error,
      transactionsStatus: "failed" as const,
    },
  };

  const [status] = await getDb()
    .update(quarterSyncStatuses)
    .set({
      currentStep: step,
      overallStatus: "failed",
      ...updateByStep[step],
      ...counts,
    })
    .where(
      and(
        eq(quarterSyncStatuses.quarterId, quarterId),
        eq(quarterSyncStatuses.runId, runId),
      ),
    )
    .returning();

  if (!status) {
    throw new Error("Sync run changed. Refresh and try again.");
  }

  return mapQuarterSyncStatus(status);
}

export async function markQuarterSyncStepSuccess({
  counts,
  quarterId,
  runId,
  step,
}: {
  counts?: Partial<
    Pick<
      QuarterSyncStatus,
      | "importedTransactions"
      | "importedTransfers"
      | "membershipActivities"
      | "proposalLinkedTransactions"
      | "proposalMatches"
      | "scannedTransfers"
      | "syncErrorCount"
    >
  >;
  quarterId: string;
  runId: string;
  step: QuarterSyncStep;
}) {
  const now = new Date();
  const updateByStep = {
    finalize: {
      finalizeCompletedAt: now,
      finalizeError: null,
      finalizeStatus: "success" as const,
      lastSyncedAt: now,
      overallStatus: "success" as const,
    },
    membership: {
      currentStep: "finalize" as const,
      membershipCompletedAt: now,
      membershipError: null,
      membershipStatus: "success" as const,
    },
    proposals: {
      currentStep: "membership" as const,
      proposalsCompletedAt: now,
      proposalsError: null,
      proposalsStatus: "success" as const,
    },
    transactions: {
      currentStep: "proposals" as const,
      transactionsCompletedAt: now,
      transactionsError: null,
      transactionsStatus: "success" as const,
    },
  };

  const [status] = await getDb()
    .update(quarterSyncStatuses)
    .set({
      ...updateByStep[step],
      ...counts,
    })
    .where(
      and(
        eq(quarterSyncStatuses.quarterId, quarterId),
        eq(quarterSyncStatuses.runId, runId),
      ),
    )
    .returning();

  if (!status) {
    throw new Error("Sync run changed. Refresh and try again.");
  }

  return mapQuarterSyncStatus(status);
}
