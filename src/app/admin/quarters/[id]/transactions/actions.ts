"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  ledgerCategoryEnum,
  ledgerEntries,
  quarters,
  treasuryAccounts,
  treasuryTransactionTransfers,
} from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit";
import { getAuthSession } from "@/lib/auth/session";
import { syncDaoProposalsForPeriod } from "@/lib/dao-proposals";
import { encryptField } from "@/lib/encryption";
import { syncMembershipActivitiesForPeriod } from "@/lib/membership-activity";
import {
  assertClassificationEntityMatchesCategory,
  assertRaidIsAvailable,
  getCounterpartyAddressForTransfer,
  getTreasuryAccountLabel,
  getTreasuryAccountLabels,
  type LedgerCategory,
} from "@/lib/transaction-classification";
import {
  getQuarterSyncStatus,
  markQuarterSyncStepFailed,
  markQuarterSyncStepRunning,
  markQuarterSyncStepSuccess,
  startOrResumeQuarterSync,
  type QuarterSyncStatus,
} from "@/lib/quarter-sync";
import { syncTreasuryTransactions } from "@/lib/treasury/transactions";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getOptionalString(formData: FormData, key: string) {
  const value = getString(formData, key);

  return value || null;
}

function getCategory(value: string): LedgerCategory {
  if (value === "uncategorized") {
    throw new Error("Choose a report category");
  }

  if (
    ledgerCategoryEnum.enumValues.includes(
      value as (typeof ledgerCategoryEnum.enumValues)[number],
    )
  ) {
    return value as LedgerCategory;
  }

  throw new Error("Classification category is required");
}

function getUsdAmount(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);

  if (!match) {
    throw new Error("USD amount must be a positive dollar amount");
  }

  const whole = match[1].replace(/^0+(?=\d)/, "");
  const cents = (match[2] ?? "").padEnd(2, "0");

  if (whole === "0" && cents === "00") {
    throw new Error("USD amount must be greater than zero");
  }

  return `${whole}.${cents}`;
}

async function requireAdminSession() {
  const session = await getAuthSession();

  if (!session.address || !session.permissions?.canAdmin) {
    throw new Error("Admin access required");
  }

  return session;
}

async function getQuarterById(id: string) {
  const [quarter] = await getDb()
    .select()
    .from(quarters)
    .where(eq(quarters.id, id))
    .limit(1);

  if (!quarter) {
    throw new Error("Quarter not found");
  }

  return quarter;
}

async function getTransferInQuarter({
  quarter,
  transferId,
}: {
  quarter: typeof quarters.$inferSelect;
  transferId: string;
}) {
  const startsAt = new Date(`${quarter.startsOn}T00:00:00.000Z`);
  const endsAtExclusive = new Date(`${quarter.endsOn}T00:00:00.000Z`);
  endsAtExclusive.setUTCDate(endsAtExclusive.getUTCDate() + 1);
  const [transfer] = await getDb()
    .select()
    .from(treasuryTransactionTransfers)
    .where(
      and(
        eq(treasuryTransactionTransfers.id, transferId),
        sql`${treasuryTransactionTransfers.executedAt} >= ${startsAt}`,
        sql`${treasuryTransactionTransfers.executedAt} < ${endsAtExclusive}`,
      ),
    )
    .limit(1);

  if (!transfer) {
    throw new Error("Transfer not found in this quarter");
  }

  return transfer;
}

async function getLedgerSourceForTransfer(
  transfer: typeof treasuryTransactionTransfers.$inferSelect,
) {
  if (!transfer.treasuryAccountId) {
    return "main_safe";
  }

  const [account] = await getDb()
    .select({ type: treasuryAccounts.type })
    .from(treasuryAccounts)
    .where(eq(treasuryAccounts.id, transfer.treasuryAccountId))
    .limit(1);

  return account?.type === "operator" ? "operator" : "side_vault";
}

function getTransactionsPath(quarterId: string) {
  return `/admin/quarters/${quarterId}/transactions`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Sync failed";
}

function getQuarterSyncPeriod(quarter: typeof quarters.$inferSelect) {
  const startsAt = new Date(`${quarter.startsOn}T00:00:00.000Z`);
  const endsAtExclusive = new Date(`${quarter.endsOn}T00:00:00.000Z`);
  endsAtExclusive.setUTCDate(endsAtExclusive.getUTCDate() + 1);

  return { endsAtExclusive, startsAt };
}

export async function syncQuarterTransactions(formData: FormData) {
  await requireAdminSession();
  const quarterId = getString(formData, "quarterId");

  if (!quarterId) {
    throw new Error("Quarter is required");
  }

  let status = await startQuarterSync(quarterId);
  status = await syncQuarterTransactionsStep({
    quarterId,
    runId: status.runId,
  });
  throwIfStepFailed(status, "transactions");
  status = await syncQuarterProposalsStep({ quarterId, runId: status.runId });
  throwIfStepFailed(status, "proposals");
  status = await syncQuarterMembershipStep({ quarterId, runId: status.runId });
  throwIfStepFailed(status, "membership");
  status = await finalizeQuarterSyncStep({
    quarterId,
    runId: status.runId,
    writeAudit: true,
  });

  const syncStatus = status.overallStatus === "success" ? "1" : "partial";
  const params = new URLSearchParams({
    imported: String(status.importedTransfers),
    proposals: String(status.proposalLinkedTransactions),
    syncId: status.lastSyncedAt ?? new Date().toISOString(),
    synced: syncStatus,
  });

  if (status.syncErrorCount > 0) {
    params.set("errors", String(status.syncErrorCount));
  }

  revalidateQuarterSyncPaths(quarterId);
  redirect(`${getTransactionsPath(quarterId)}?${params.toString()}`);
}

function revalidateQuarterSyncPaths(quarterId: string) {
  revalidatePath("/admin/quarters");
  revalidatePath(getTransactionsPath(quarterId));
  revalidatePath("/proposals");
  revalidatePath("/membership");
}

function throwIfStepFailed(status: QuarterSyncStatus, step: string) {
  const error =
    step === "transactions"
      ? status.transactionsError
      : step === "proposals"
        ? status.proposalsError
        : step === "membership"
          ? status.membershipError
          : status.finalizeError;

  if (status.overallStatus === "failed" && error) {
    throw new Error(error);
  }
}

export async function startQuarterSync(quarterId: string) {
  await requireAdminSession();

  if (!quarterId) {
    throw new Error("Quarter is required");
  }

  await getQuarterById(quarterId);

  return startOrResumeQuarterSync(quarterId);
}

export async function syncQuarterTransactionsStep({
  quarterId,
  runId,
}: {
  quarterId: string;
  runId: string;
}) {
  await requireAdminSession();

  const quarter = await getQuarterById(quarterId);
  const syncPeriod = getQuarterSyncPeriod(quarter);

  await markQuarterSyncStepRunning({ quarterId, runId, step: "transactions" });

  try {
    const result = await syncTreasuryTransactions(syncPeriod);
    const counts = {
      importedTransactions: result.importedTransactions,
      importedTransfers: result.importedTransfers,
      scannedTransfers: result.scannedTransfers,
      syncErrorCount: result.errors.length,
    };

    if (result.errors.length > 0) {
      return markQuarterSyncStepFailed({
        counts,
        error: `${result.errors.length} account${
          result.errors.length === 1 ? "" : "s"
        } failed to sync.`,
        quarterId,
        runId,
        step: "transactions",
      });
    }

    const status = await markQuarterSyncStepSuccess({
      counts,
      quarterId,
      runId,
      step: "transactions",
    });

    revalidateQuarterSyncPaths(quarterId);
    return status;
  } catch (error) {
    return markQuarterSyncStepFailed({
      error: getErrorMessage(error),
      quarterId,
      runId,
      step: "transactions",
    });
  }
}

export async function syncQuarterProposalsStep({
  quarterId,
  runId,
}: {
  quarterId: string;
  runId: string;
}) {
  await requireAdminSession();

  const priorStatus = await getQuarterSyncStatus(quarterId);
  if (priorStatus?.transactionsStatus !== "success") {
    throw new Error("Sync transactions before matching proposals");
  }

  const quarter = await getQuarterById(quarterId);
  const syncPeriod = getQuarterSyncPeriod(quarter);

  await markQuarterSyncStepRunning({ quarterId, runId, step: "proposals" });

  try {
    const result = await syncDaoProposalsForPeriod(syncPeriod);
    const status = await markQuarterSyncStepSuccess({
      counts: {
        proposalLinkedTransactions: result.linkedTransactions,
        proposalMatches: result.matchedProposals,
      },
      quarterId,
      runId,
      step: "proposals",
    });

    revalidateQuarterSyncPaths(quarterId);
    return status;
  } catch (error) {
    return markQuarterSyncStepFailed({
      error: getErrorMessage(error),
      quarterId,
      runId,
      step: "proposals",
    });
  }
}

export async function syncQuarterMembershipStep({
  quarterId,
  runId,
}: {
  quarterId: string;
  runId: string;
}) {
  await requireAdminSession();

  const priorStatus = await getQuarterSyncStatus(quarterId);
  if (priorStatus?.proposalsStatus !== "success") {
    throw new Error("Sync proposals before membership activity");
  }

  const quarter = await getQuarterById(quarterId);
  const syncPeriod = getQuarterSyncPeriod(quarter);

  await markQuarterSyncStepRunning({ quarterId, runId, step: "membership" });

  try {
    const result = await syncMembershipActivitiesForPeriod({
      period: syncPeriod,
      quarterId,
    });
    const status = await markQuarterSyncStepSuccess({
      counts: {
        membershipActivities: result.syncedActivities,
      },
      quarterId,
      runId,
      step: "membership",
    });

    revalidateQuarterSyncPaths(quarterId);
    return status;
  } catch (error) {
    return markQuarterSyncStepFailed({
      error: getErrorMessage(error),
      quarterId,
      runId,
      step: "membership",
    });
  }
}

export async function finalizeQuarterSyncStep({
  quarterId,
  runId,
  writeAudit = false,
}: {
  quarterId: string;
  runId: string;
  writeAudit?: boolean;
}) {
  const session = await requireAdminSession();
  const priorStatus = await getQuarterSyncStatus(quarterId);

  if (
    priorStatus?.transactionsStatus !== "success" ||
    priorStatus.proposalsStatus !== "success" ||
    priorStatus.membershipStatus !== "success"
  ) {
    throw new Error("Finish each sync step before finalizing");
  }

  await markQuarterSyncStepRunning({ quarterId, runId, step: "finalize" });
  const status = await markQuarterSyncStepSuccess({
    quarterId,
    runId,
    step: "finalize",
  });

  if (writeAudit) {
    await writeAuditEvent({
      action: "import",
      actorWalletAddress: session.address,
      metadata: {
        importedTransactions: status.importedTransactions,
        importedTransfers: status.importedTransfers,
        membershipActivities: status.membershipActivities,
        proposalLinkedTransactions: status.proposalLinkedTransactions,
        proposalMatches: status.proposalMatches,
        runId: status.runId,
        scannedTransfers: status.scannedTransfers,
      },
      quarterId,
      subjectId: quarterId,
      subjectTable: "treasury_transaction_transfers",
      summary: "Synced quarter transactions",
    });
  }

  revalidateQuarterSyncPaths(quarterId);
  throwIfStepFailed(status, "finalize");

  return status;
}

export async function classifyQuarterTransfer(formData: FormData) {
  const session = await requireAdminSession();
  const quarterId = getString(formData, "quarterId");
  const transferId = getString(formData, "transferId");
  let category = getCategory(getString(formData, "category"));
  let counterpartyEntityId = getOptionalString(
    formData,
    "counterpartyEntityId",
  );
  let raidId = getOptionalString(formData, "raidId");
  const notes = getString(formData, "notes");
  const usdAmount = getUsdAmount(getString(formData, "usdAmount"));

  if (!quarterId || !transferId) {
    throw new Error("Quarter and transfer are required");
  }

  const quarter = await getQuarterById(quarterId);
  const transfer = await getTransferInQuarter({ quarter, transferId });
  const treasuryLabels = await getTreasuryAccountLabels();
  const treasuryCounterparty = getTreasuryAccountLabel({
    address: getCounterpartyAddressForTransfer(transfer),
    chainId: transfer.chainId,
    labels: treasuryLabels,
  });

  if (treasuryCounterparty) {
    category = "treasury_transfer";
    counterpartyEntityId = null;
    raidId = null;
  }

  const source = await getLedgerSourceForTransfer(transfer);

  if (category === "raid_spoils") {
    if (!raidId) {
      throw new Error("Raid is required for spoils");
    }

    if (transfer.direction !== "inflow") {
      throw new Error("Spoils must be received by a treasury account");
    }

    if (source !== "main_safe" && source !== "side_vault") {
      throw new Error("Spoils must be received by the treasury");
    }

    counterpartyEntityId = null;
  }

  await assertClassificationEntityMatchesCategory({
    category,
    entityId: counterpartyEntityId,
  });
  await assertRaidIsAvailable(raidId);

  const entryValues = {
    assetAmount: transfer.amount,
    assetSymbol: transfer.assetSymbol,
    category,
    chainId: transfer.chainId,
    counterpartyEntityId,
    notesEncrypted: notes ? encryptField(notes) : null,
    occurredAt: transfer.executedAt,
    quarterId,
    raidId,
    source,
    sourceMetadata: {
      direction: transfer.direction,
      fromAddress: transfer.fromAddress,
      importedUsdAmount: transfer.usdAmount,
      importedUsdPrice: transfer.usdPrice,
      treasuryCounterparty: treasuryCounterparty
        ? {
            address: treasuryCounterparty.address,
            chainId: treasuryCounterparty.chainId,
          }
        : null,
      toAddress: transfer.toAddress,
      transferId: transfer.transferId,
      transferRowId: transfer.id,
      transferType: transfer.transferType,
    },
    treasuryAccountId: transfer.treasuryAccountId,
    treasuryTransactionTransferId: transfer.id,
    txHash: transfer.txHash,
    usdAmount,
    verificationStatus: "verified",
  } satisfies typeof ledgerEntries.$inferInsert;

  await getDb()
    .insert(ledgerEntries)
    .values(entryValues)
    .onConflictDoUpdate({
      set: entryValues,
      target: ledgerEntries.treasuryTransactionTransferId,
    });

  await writeAuditEvent({
    action: "classify",
    actorWalletAddress: session.address,
    metadata: {
      category,
      counterpartyEntityId,
      raidId,
      treasuryCounterparty: treasuryCounterparty
        ? {
            address: treasuryCounterparty.address,
            chainId: treasuryCounterparty.chainId,
          }
        : null,
      transferId: transfer.id,
      txHash: transfer.txHash,
    },
    quarterId,
    subjectId: transfer.id,
    subjectTable: "treasury_transaction_transfers",
    summary: "Saved transaction classification",
  });

  revalidatePath("/admin/quarters");
  revalidatePath(getTransactionsPath(quarterId));

  const params = new URLSearchParams({
    classified: "1",
    classifiedId: crypto.randomUUID(),
  });

  redirect(`${getTransactionsPath(quarterId)}?${params.toString()}`);
}
