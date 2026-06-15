"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";

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
import {
  buildBankCsvNote,
  parseBankCsvConfirmRows,
  parseBankCsvImport,
  type BankCsvImportRow,
  type BankCsvPreviewResult,
} from "@/lib/bank-csv";
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
import { assertRipIsAvailable } from "@/lib/rips";
import { syncTreasuryTransactions } from "@/lib/treasury/transactions";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getFile(formData: FormData, key: string) {
  const value = formData.get(key);

  return value instanceof File && value.size > 0 ? value : null;
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

function assertQuarterCanAcceptLedgerChanges(quarter: typeof quarters.$inferSelect) {
  if (quarter.status === "published") {
    throw new Error(
      "Published quarters must be reopened before changing ledger entries",
    );
  }
}

async function getExistingSourceExternalIds(sourceExternalIds: string[]) {
  if (sourceExternalIds.length === 0) {
    return new Set<string>();
  }

  const rows = await getDb()
    .select({ sourceExternalId: ledgerEntries.sourceExternalId })
    .from(ledgerEntries)
    .where(inArray(ledgerEntries.sourceExternalId, sourceExternalIds));

  return new Set(
    rows.flatMap((row) =>
      row.sourceExternalId ? [row.sourceExternalId] : [],
    ),
  );
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

export type BankCsvImportState = {
  error: string | null;
  importedCount: number;
  preview: BankCsvPreviewResult | null;
};

const BANK_CSV_INITIAL_ERROR = "Bank CSV import failed";

function getBankCsvErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message === "Bank import preview is invalid" ||
      error.message === "Bank import preview has a bad format" ||
      error.message === "Bank import preview is required" ||
      error.message.startsWith("Bank import preview row") ||
      error.message === "Choose a CSV file" ||
      error.message === "Quarter is required" ||
      error.message === "Quarter not found" ||
      error.message.startsWith("CSV is missing") ||
      error.message.startsWith("Published quarters")
    ) {
      return error.message;
    }
  }

  return BANK_CSV_INITIAL_ERROR;
}

export async function previewBankCsvImport(
  _previousState: BankCsvImportState,
  formData: FormData,
): Promise<BankCsvImportState> {
  try {
    await requireAdminSession();
    const quarterId = getString(formData, "quarterId");
    const csvFile = getFile(formData, "csvFile");

    if (!quarterId) {
      throw new Error("Quarter is required");
    }

    if (!csvFile) {
      throw new Error("Choose a CSV file");
    }

    const quarter = await getQuarterById(quarterId);
    assertQuarterCanAcceptLedgerChanges(quarter);
    const text = await csvFile.text();
    const previewWithoutDuplicates = parseBankCsvImport({
      existingSourceExternalIds: new Set(),
      quarter,
      text,
    });
    const existingSourceExternalIds = await getExistingSourceExternalIds(
      previewWithoutDuplicates.importedRows.map((row) => row.sourceExternalId),
    );
    const preview = parseBankCsvImport({
      existingSourceExternalIds,
      quarter,
      text,
    });

    return { error: null, importedCount: 0, preview };
  } catch (error) {
    return {
      error: getBankCsvErrorMessage(error),
      importedCount: 0,
      preview: null,
    };
  }
}

function getBankCsvSourceMetadata(row: BankCsvImportRow) {
  return {
    importKind: row.kind,
    transactionId: row.transactionId,
    type: row.type,
  };
}

export async function confirmBankCsvImport(
  _previousState: BankCsvImportState,
  formData: FormData,
): Promise<BankCsvImportState> {
  try {
    const session = await requireAdminSession();
    const quarterId = getString(formData, "quarterId");
    const rows = parseBankCsvConfirmRows(getString(formData, "previewRows"));

    if (!quarterId) {
      throw new Error("Quarter is required");
    }

    const quarter = await getQuarterById(quarterId);
    assertQuarterCanAcceptLedgerChanges(quarter);
    const { endsAtExclusive, startsAt } = getQuarterSyncPeriod(quarter);

    for (const [index, row] of rows.entries()) {
      const occurredAt = new Date(row.occurredAt);

      if (occurredAt < startsAt || occurredAt >= endsAtExclusive) {
        throw new Error(
          `Bank import preview row ${index + 1} is outside the quarter`,
        );
      }

      if (row.kind !== "bank_transaction") {
        if (row.category !== "provider_expense") {
          throw new Error(
            `Bank import preview row ${index + 1} has an invalid fee category`,
          );
        }

        if (row.assetSymbol.toUpperCase() !== "USD") {
          throw new Error(
            `Bank import preview row ${index + 1} has an unsupported fee currency`,
          );
        }
      }
    }

    const existingSourceExternalIds = await getExistingSourceExternalIds(
      rows.map((row) => row.sourceExternalId),
    );
    const insertRows = rows.filter(
      (row) => !existingSourceExternalIds.has(row.sourceExternalId),
    );

    if (insertRows.length === 0) {
      return {
        error: null,
        importedCount: 0,
        preview: {
          duplicateRows: rows.length,
          importedRows: [],
          invalidRows: 0,
          outsideQuarterRows: 0,
          skippedFeeRows: 0,
          skippedStatusRows: 0,
          totalRows: rows.length,
        },
      };
    }

    const insertedRows = await getDb()
      .insert(ledgerEntries)
      .values(
        insertRows.map((row) => {
          const note = buildBankCsvNote(row);

          return {
            assetAmount: row.assetAmount,
            assetSymbol: row.assetSymbol,
            category: row.category,
            notesEncrypted: note ? encryptField(note) : null,
            occurredAt: new Date(row.occurredAt),
            quarterId: quarter.id,
            source: "bank_csv",
            sourceExternalId: row.sourceExternalId,
            sourceMetadata: getBankCsvSourceMetadata(row),
            usdAmount: row.usdAmount,
            verificationStatus: "verified",
          } satisfies typeof ledgerEntries.$inferInsert;
        }),
      )
      .onConflictDoNothing({ target: ledgerEntries.sourceExternalId })
      .returning();

    await writeAuditEvent({
      action: "import",
      actorWalletAddress: session.address,
      metadata: {
        importedRows: insertedRows.length,
        quarterId: quarter.id,
        source: "bank_csv",
      },
      quarterId: quarter.id,
      subjectId: quarter.id,
      subjectTable: "ledger_entries",
      summary: "Imported bank CSV rows",
    });

    revalidatePath("/admin/quarters");
    revalidatePath(getTransactionsPath(quarter.id));

    return {
      error: null,
      importedCount: insertedRows.length,
      preview: null,
    };
  } catch (error) {
    return {
      error: getBankCsvErrorMessage(error),
      importedCount: 0,
      preview: null,
    };
  }
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
  let ripId = getOptionalString(formData, "ripId");
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
    ripId = null;
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
    ripId = null;
  }

  if (category === "rip_expense") {
    if (!ripId) {
      throw new Error("RIP is required for RIP expenses");
    }
  } else {
    ripId = null;
  }

  await assertClassificationEntityMatchesCategory({
    category,
    entityId: counterpartyEntityId,
  });
  await assertRaidIsAvailable(raidId);
  await assertRipIsAvailable(ripId);

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
    ripId,
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
      ripId,
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

export async function updateLedgerEntryClassification(formData: FormData) {
  const session = await requireAdminSession();
  const quarterId = getString(formData, "quarterId");
  const ledgerEntryId = getString(formData, "ledgerEntryId");
  const category = getCategory(getString(formData, "category"));
  let counterpartyEntityId = getOptionalString(
    formData,
    "counterpartyEntityId",
  );
  let raidId = getOptionalString(formData, "raidId");
  let ripId = getOptionalString(formData, "ripId");
  const notes = getString(formData, "notes");
  const usdAmount = getUsdAmount(getString(formData, "usdAmount"));

  if (!quarterId || !ledgerEntryId) {
    throw new Error("Quarter and ledger entry are required");
  }

  const quarter = await getQuarterById(quarterId);
  assertQuarterCanAcceptLedgerChanges(quarter);

  const [entry] = await getDb()
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.id, ledgerEntryId),
        eq(ledgerEntries.quarterId, quarterId),
        inArray(ledgerEntries.source, ["bank_csv", "manual"]),
      ),
    )
    .limit(1);

  if (!entry) {
    throw new Error("Ledger entry not found");
  }

  if (category === "treasury_transfer") {
    counterpartyEntityId = null;
    raidId = null;
    ripId = null;
  }

  if (category === "rip_expense") {
    if (!ripId) {
      throw new Error("RIP is required for RIP expenses");
    }
    raidId = null;
  } else {
    ripId = null;
  }

  if (category === "raid_spoils") {
    if (!raidId) {
      throw new Error("Raid is required for spoils");
    }
    counterpartyEntityId = null;
  }

  await assertClassificationEntityMatchesCategory({
    category,
    entityId: counterpartyEntityId,
  });
  await assertRaidIsAvailable(raidId);
  await assertRipIsAvailable(ripId);

  await getDb()
    .update(ledgerEntries)
    .set({
      category,
      counterpartyEntityId,
      notesEncrypted: notes ? encryptField(notes) : null,
      raidId,
      ripId,
      usdAmount,
    })
    .where(eq(ledgerEntries.id, entry.id));

  await writeAuditEvent({
    action: "classify",
    actorWalletAddress: session.address,
    metadata: {
      category,
      counterpartyEntityId,
      ledgerEntryId: entry.id,
      raidId,
      ripId,
      source: entry.source,
    },
    quarterId,
    subjectId: entry.id,
    subjectTable: "ledger_entries",
    summary: "Updated ledger entry classification",
  });

  revalidatePath("/admin/quarters");
  revalidatePath(getTransactionsPath(quarterId));

  const params = new URLSearchParams({
    classified: "1",
    classifiedId: crypto.randomUUID(),
  });

  redirect(`${getTransactionsPath(quarterId)}?${params.toString()}`);
}
