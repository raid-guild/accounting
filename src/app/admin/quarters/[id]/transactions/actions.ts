"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  ledgerCategoryEnum,
  ledgerEntries,
  entities,
  quarters,
  rips,
  treasuryAccounts,
  treasuryTransactionTransfers,
} from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit";
import { canUseAdminAccess, getAuthSession } from "@/lib/auth/session";
import {
  buildBankCsvNote,
  parseBankCsvConfirmRows,
  parseBankCsvImport,
  type BankCsvImportRow,
  type BankCsvPreviewResult,
} from "@/lib/bank-csv";
import { syncDaoProposalsForPeriod } from "@/lib/dao-proposals";
import { encryptField } from "@/lib/encryption";
import {
  CoreEntityValidationError,
  createEntityForAccess,
  createRaidForAccess,
} from "@/lib/core-entity-mutations";
import { syncMembershipActivitiesForPeriod } from "@/lib/membership-activity";
import { syncQuarterBalances } from "@/lib/quarter-balances";
import {
  acknowledgeQuarterBalanceValidation,
  deleteQuarterBalanceValidation,
  runQuarterBalanceValidation,
} from "@/lib/quarter-balance-validation";
import {
  assertClassificationEntityMatchesCategory,
  assertRaidIsAvailable,
  getCounterpartyAddressForTransfer,
  getTreasuryAccountLabel,
  getTreasuryAccountLabels,
  type LedgerCategory,
} from "@/lib/transaction-classification";
import { getSwapTransactionKeys } from "@/lib/treasury/swap-detection";
import {
  getQuarterSyncStatus,
  markQuarterSyncStepFailed,
  markQuarterSyncStepRunning,
  markQuarterSyncStepSuccess,
  startOrResumeQuarterSync,
  type QuarterSyncStatus,
} from "@/lib/quarter-sync";
import { getQuarterClassificationSummary } from "@/lib/quarters";
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

  if (!canUseAdminAccess(session)) {
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

export type InlineCreateState = {
  message: string;
  success: boolean;
};

export type ManualProviderExpenseState = {
  error: string | null;
  saved: boolean;
};

const INLINE_CREATE_INITIAL_ERROR = "Could not add this record";

function getAddressErrorMessage(error: unknown) {
  if (error instanceof CoreEntityValidationError) {
    if (error.code === "duplicate_address") {
      return "That address is already assigned to an entity.";
    }

    if (error.code === "invalid_address") {
      return "Enter a valid EVM address.";
    }

    if (error.code === "invalid_chain") {
      return "Chain ID must be a positive whole number.";
    }

    if (error.code === "missing_address") {
      return "Address is required.";
    }
  }

  return null;
}

function normalizeRipUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function revalidateInlineCreatePaths(formData: FormData) {
  const quarterId = getString(formData, "quarterId");

  if (quarterId) {
    revalidatePath(getTransactionsPath(quarterId));
  }
}

export async function createClassificationProvider(
  _previousState: InlineCreateState,
  formData: FormData,
): Promise<InlineCreateState> {
  try {
    await createEntityForAccess(formData, "provider");
    revalidateInlineCreatePaths(formData);
    return { message: "", success: true };
  } catch (error) {
    return {
      message: getAddressErrorMessage(error) ?? INLINE_CREATE_INITIAL_ERROR,
      success: false,
    };
  }
}

export async function createClassificationSubcontractor(
  _previousState: InlineCreateState,
  formData: FormData,
): Promise<InlineCreateState> {
  try {
    formData.set("type", "subcontractor");
    await createEntityForAccess(formData, "raid-related");
    revalidateInlineCreatePaths(formData);
    return { message: "", success: true };
  } catch (error) {
    return {
      message: getAddressErrorMessage(error) ?? INLINE_CREATE_INITIAL_ERROR,
      success: false,
    };
  }
}

export async function createClassificationRaid(
  _previousState: InlineCreateState,
  formData: FormData,
): Promise<InlineCreateState> {
  try {
    await createRaidForAccess(formData);
    revalidateInlineCreatePaths(formData);
    return { message: "", success: true };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : INLINE_CREATE_INITIAL_ERROR,
      success: false,
    };
  }
}

export async function createClassificationRip(
  _previousState: InlineCreateState,
  formData: FormData,
): Promise<InlineCreateState> {
  try {
    const session = await getAuthSession();
    const title = getString(formData, "title");
    const url = normalizeRipUrl(getString(formData, "url"));

    if (!session.address || !session.permissions?.canAccess) {
      throw new Error("Member access required");
    }

    if (!title || !url) {
      throw new Error("Add a title and a valid RIP URL.");
    }

    const [rip] = await getDb()
      .insert(rips)
      .values({
        createdByWalletAddress: session.address,
        titleEncrypted: encryptField(title),
        urlEncrypted: encryptField(url),
      })
      .returning();

    await writeAuditEvent({
      action: "create",
      actorWalletAddress: session.address,
      metadata: {},
      subjectId: rip.id,
      subjectTable: "rips",
      summary: "Created RIP",
    });

    revalidatePath("/rips");
    revalidateInlineCreatePaths(formData);
    return { message: "", success: true };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : INLINE_CREATE_INITIAL_ERROR,
      success: false,
    };
  }
}

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

function getManualProviderExpenseErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message === "Active provider is required" ||
      error.message === "Date must be within this quarter" ||
      error.message === "Expense date is required" ||
      error.message === "Provider is required" ||
      error.message === "Quarter not found" ||
      error.message === "USD amount must be greater than zero" ||
      error.message === "USD amount must be a positive dollar amount" ||
      error.message.startsWith("Published quarters")
    ) {
      return error.message;
    }
  }

  return "Provider expense could not be saved.";
}

function getExpenseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Expense date is required");
  }

  return new Date(`${value}T12:00:00.000Z`);
}

function getManualExpenseOccurredAt({
  defaultOccurredAt,
  occurredOn,
}: {
  defaultOccurredAt: string;
  occurredOn: string;
}) {
  if (defaultOccurredAt) {
    const parsedDefault = new Date(defaultOccurredAt);

    if (
      Number.isFinite(parsedDefault.getTime()) &&
      parsedDefault.toISOString().slice(0, 10) === occurredOn
    ) {
      return new Date(parsedDefault.getTime() + 5_000);
    }
  }

  return getExpenseDate(occurredOn);
}

function getOptionalPositiveInteger(value: string) {
  if (!value) {
    return null;
  }

  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : null;
}

function getQuarterSyncPeriod(quarter: typeof quarters.$inferSelect) {
  const startsAt = new Date(`${quarter.startsOn}T00:00:00.000Z`);
  const endsAtExclusive = new Date(`${quarter.endsOn}T00:00:00.000Z`);
  endsAtExclusive.setUTCDate(endsAtExclusive.getUTCDate() + 1);

  return { endsAtExclusive, startsAt };
}

function assertDateInQuarter({
  occurredAt,
  quarter,
}: {
  occurredAt: Date;
  quarter: typeof quarters.$inferSelect;
}) {
  const { endsAtExclusive, startsAt } = getQuarterSyncPeriod(quarter);

  if (occurredAt < startsAt || occurredAt >= endsAtExclusive) {
    throw new Error("Date must be within this quarter");
  }
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

    await invalidateQuarterValidation(quarter.id);
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

export async function createManualProviderExpense(
  _previousState: ManualProviderExpenseState,
  formData: FormData,
): Promise<ManualProviderExpenseState> {
  try {
    const session = await requireAdminSession();
    const quarterId = getString(formData, "quarterId");
    const providerId = getString(formData, "providerId");
    const notes = getString(formData, "notes");
    const assetSymbol = getString(formData, "assetSymbol") || "USD";
    const usdAmount = getUsdAmount(getString(formData, "usdAmount"));
    const occurredOn = getString(formData, "occurredOn");
    const occurredAt = getManualExpenseOccurredAt({
      defaultOccurredAt: getString(formData, "defaultOccurredAt"),
      occurredOn,
    });
    const sourceChainId = getOptionalPositiveInteger(
      getString(formData, "sourceChainId"),
    );
    const sourceTransferId = getOptionalString(formData, "sourceTransferId");
    const sourceTxHash = getOptionalString(formData, "sourceTxHash");

    if (!quarterId) {
      throw new Error("Quarter not found");
    }

    if (!providerId) {
      throw new Error("Provider is required");
    }

    const quarter = await getQuarterById(quarterId);
    assertQuarterCanAcceptLedgerChanges(quarter);
    assertDateInQuarter({ occurredAt, quarter });

    const [provider] = await getDb()
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.id, providerId),
          eq(entities.type, "provider"),
          isNull(entities.archivedAt),
        ),
      )
      .limit(1);

    if (!provider) {
      throw new Error("Active provider is required");
    }

    const [entry] = await getDb()
      .insert(ledgerEntries)
      .values({
        assetAmount: usdAmount,
        assetSymbol: assetSymbol.toUpperCase(),
        category: "provider_expense",
        chainId: sourceChainId,
        counterpartyEntityId: provider.id,
        notesEncrypted: notes ? encryptField(notes) : null,
        occurredAt,
        quarterId: quarter.id,
        source: "manual",
        sourceExternalId: `manual-provider-expense:${crypto.randomUUID()}`,
        sourceMetadata: {
          entryType: "manual_provider_expense",
          sourceTransferId,
          sourceTxHash,
        },
        txHash: sourceTxHash,
        usdAmount,
        verificationStatus: "verified",
      })
      .returning();

    await writeAuditEvent({
      action: "create",
      actorWalletAddress: session.address,
      metadata: {
        providerId: provider.id,
        quarterId: quarter.id,
      },
      quarterId: quarter.id,
      subjectId: entry.id,
      subjectTable: "ledger_entries",
      summary: "Created manual provider expense",
    });

    await invalidateQuarterValidation(quarter.id);
    revalidatePath("/admin/quarters");
    revalidatePath(getTransactionsPath(quarter.id));

    return { error: null, saved: true };
  } catch (error) {
    return {
      error: getManualProviderExpenseErrorMessage(error),
      saved: false,
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

async function isSwapLikeTransfer(
  transfer: typeof treasuryTransactionTransfers.$inferSelect,
) {
  if (!transfer.treasuryTransactionId) {
    return false;
  }

  const rows = await getDb()
    .select({
      accountAddress: treasuryTransactionTransfers.accountAddress,
      assetSymbol: treasuryTransactionTransfers.assetSymbol,
      chainId: treasuryTransactionTransfers.chainId,
      direction: treasuryTransactionTransfers.direction,
      fromAddress: treasuryTransactionTransfers.fromAddress,
      toAddress: treasuryTransactionTransfers.toAddress,
      txHash: treasuryTransactionTransfers.txHash,
    })
    .from(treasuryTransactionTransfers)
    .where(
      and(
        eq(
          treasuryTransactionTransfers.treasuryTransactionId,
          transfer.treasuryTransactionId,
        ),
        eq(treasuryTransactionTransfers.chainId, transfer.chainId),
        sql`lower(${treasuryTransactionTransfers.accountAddress}) = ${transfer.accountAddress.toLowerCase()}`,
      ),
    );
  return getSwapTransactionKeys(rows).size > 0;
}

function getTransactionsPath(quarterId: string) {
  return `/admin/quarters/${quarterId}/transactions`;
}

function getLedgerEntryAnchor(id: string) {
  return `ledger-entry-${id}`;
}

function getTransferAnchor(id: string) {
  return `transfer-${id}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Sync failed";
}

export async function syncQuarterTransactions(formData: FormData) {
  await requireAdminSession();
  const quarterId = getString(formData, "quarterId");

  if (!quarterId) {
    throw new Error("Quarter is required");
  }

  await invalidateQuarterValidation(quarterId);
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
  status = await syncQuarterBalancesStep({ quarterId, runId: status.runId });
  throwIfStepFailed(status, "balances");
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
  revalidatePath("/reports");
  revalidatePath(`/reports/quarters/${quarterId}`);
  revalidatePath("/proposals");
  revalidatePath("/membership");
}

async function invalidateQuarterValidation(quarterId: string) {
  await deleteQuarterBalanceValidation(quarterId);
  revalidatePath("/reports");
  revalidatePath(`/reports/quarters/${quarterId}`);
}

function throwIfStepFailed(status: QuarterSyncStatus, step: string) {
  const error =
    step === "transactions"
      ? status.transactionsError
      : step === "proposals"
        ? status.proposalsError
        : step === "membership"
          ? status.membershipError
          : step === "balances"
            ? status.balancesError
          : status.finalizeError;

  if (status.overallStatus === "failed" && error) {
    throw new Error(error);
  }
}

export async function runBalanceValidation(formData: FormData) {
  const session = await requireAdminSession();
  const quarterId = getString(formData, "quarterId");

  if (!quarterId) {
    throw new Error("Quarter is required");
  }

  const quarter = await getQuarterById(quarterId);
  const [classificationSummary, syncStatus] = await Promise.all([
    getQuarterClassificationSummary({
      endsOn: quarter.endsOn,
      startsOn: quarter.startsOn,
    }),
    getQuarterSyncStatus(quarterId),
  ]);
  const validation = await runQuarterBalanceValidation({
    classificationSummary,
    quarter,
    syncStatus,
  });

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    metadata: {
      excludedCount: validation.excludedCount,
      status: validation.status,
      varianceCount: validation.varianceCount,
    },
    quarterId,
    subjectId: validation.id,
    subjectTable: "quarter_balance_validations",
    summary: "Ran quarter balance validation",
  });

  revalidateQuarterSyncPaths(quarterId);
  redirect(`${getTransactionsPath(quarterId)}?validation=${validation.status}`);
}

export async function acknowledgeBalanceVariance(formData: FormData) {
  const session = await requireAdminSession();
  const walletAddress = session.address;
  const quarterId = getString(formData, "quarterId");
  const note = getString(formData, "note");

  if (!quarterId) {
    throw new Error("Quarter is required");
  }

  if (!walletAddress) {
    throw new Error("Admin wallet address is required");
  }

  const validation = await acknowledgeQuarterBalanceValidation({
    note,
    quarterId,
    walletAddress,
  });

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: walletAddress,
    metadata: {
      excludedCount: validation.excludedCount,
      varianceCount: validation.varianceCount,
    },
    quarterId,
    subjectId: validation.id,
    subjectTable: "quarter_balance_validations",
    summary: "Acknowledged quarter balance variance",
  });

  revalidateQuarterSyncPaths(quarterId);
  redirect(`${getTransactionsPath(quarterId)}?validation=acknowledged`);
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

export async function syncQuarterBalancesStep({
  quarterId,
  runId,
}: {
  quarterId: string;
  runId: string;
}) {
  await requireAdminSession();

  const priorStatus = await getQuarterSyncStatus(quarterId);
  if (priorStatus?.membershipStatus !== "success") {
    throw new Error("Sync membership activity before quarter balances");
  }

  const quarter = await getQuarterById(quarterId);

  await markQuarterSyncStepRunning({ quarterId, runId, step: "balances" });

  try {
    await syncQuarterBalances(quarter);
    const status = await markQuarterSyncStepSuccess({
      quarterId,
      runId,
      step: "balances",
    });

    revalidateQuarterSyncPaths(quarterId);
    return status;
  } catch (error) {
    return markQuarterSyncStepFailed({
      error: getErrorMessage(error),
      quarterId,
      runId,
      step: "balances",
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
    priorStatus.membershipStatus !== "success" ||
    priorStatus.balancesStatus !== "success"
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
  const isSwap = await isSwapLikeTransfer(transfer);

  if (treasuryCounterparty || isSwap) {
    category = "treasury_transfer";
  }

  if (category === "treasury_transfer") {
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
    counterpartyEntityId = null;
    raidId = null;
  } else if (category !== "subcontractor_payout") {
    ripId = null;
  }

  if (
    category === "subcontractor_payout" &&
    Boolean(raidId) === Boolean(ripId)
  ) {
    throw new Error(
      "Choose exactly one: a raid or RIP for subcontractor payouts",
    );
  }

  if (category === "provider_expense") {
    raidId = null;
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

  await invalidateQuarterValidation(quarterId);
  revalidatePath("/admin/quarters");
  revalidatePath(getTransactionsPath(quarterId));
  revalidatePath("/reports");
  revalidatePath(`/reports/quarters/${quarterId}`);

  const params = new URLSearchParams({
    classified: "1",
    classifiedId: crypto.randomUUID(),
  });

  redirect(
    `${getTransactionsPath(quarterId)}?${params.toString()}#${getTransferAnchor(
      transfer.id,
    )}`,
  );
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
    counterpartyEntityId = null;
    raidId = null;
  } else if (category !== "subcontractor_payout") {
    ripId = null;
  }

  if (
    category === "subcontractor_payout" &&
    Boolean(raidId) === Boolean(ripId)
  ) {
    throw new Error(
      "Choose exactly one: a raid or RIP for subcontractor payouts",
    );
  }

  if (category === "raid_spoils") {
    if (!raidId) {
      throw new Error("Raid is required for spoils");
    }
    counterpartyEntityId = null;
  }

  if (category === "provider_expense") {
    raidId = null;
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

  await invalidateQuarterValidation(quarterId);
  revalidatePath("/admin/quarters");
  revalidatePath(getTransactionsPath(quarterId));
  revalidatePath("/reports");
  revalidatePath(`/reports/quarters/${quarterId}`);

  const params = new URLSearchParams({
    classified: "1",
    classifiedId: crypto.randomUUID(),
  });

  redirect(
    `${getTransactionsPath(quarterId)}?${params.toString()}#${getLedgerEntryAnchor(
      entry.id,
    )}`,
  );
}
