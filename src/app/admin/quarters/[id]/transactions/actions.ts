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
import {
  assertClassificationEntityMatchesCategory,
  assertRaidIsAvailable,
  getCounterpartyAddressForTransfer,
  getTreasuryAccountLabel,
  getTreasuryAccountLabels,
  type LedgerCategory,
} from "@/lib/transaction-classification";
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
  return error instanceof Error ? error.message : "DAO proposal sync failed";
}

function getQuarterSyncPeriod(quarter: typeof quarters.$inferSelect) {
  const startsAt = new Date(`${quarter.startsOn}T00:00:00.000Z`);
  const endsAtExclusive = new Date(`${quarter.endsOn}T00:00:00.000Z`);
  endsAtExclusive.setUTCDate(endsAtExclusive.getUTCDate() + 1);

  return { endsAtExclusive, startsAt };
}

export async function syncQuarterTransactions(formData: FormData) {
  const session = await requireAdminSession();
  const quarterId = getString(formData, "quarterId");

  if (!quarterId) {
    throw new Error("Quarter is required");
  }

  const quarter = await getQuarterById(quarterId);
  const syncPeriod = getQuarterSyncPeriod(quarter);
  const result = await syncTreasuryTransactions(syncPeriod);
  let proposalError: string | null = null;
  let proposalResult = {
    linkedTransactions: 0,
    matchedProposals: 0,
    skipped: true,
    syncedAt: result.syncedAt,
  };

  try {
    proposalResult = await syncDaoProposalsForPeriod(syncPeriod);
  } catch (error) {
    proposalError = getErrorMessage(error);
    console.error("DAO proposal sync failed", error);
  }

  await writeAuditEvent({
    action: "import",
    actorWalletAddress: session.address,
    metadata: {
      accountCount: result.accounts.length,
      errors: result.errors.map((error) => ({
        accountAddress: error.accountAddress,
        error: error.error,
        source: error.source,
      })),
      errorCount: result.errors.length,
      importedTransactions: result.importedTransactions,
      importedTransfers: result.importedTransfers,
      proposalLinkedTransactions: proposalResult.linkedTransactions,
      proposalError,
      proposalMatches: proposalResult.matchedProposals,
      proposalsSkipped: proposalResult.skipped,
      scannedTransfers: result.scannedTransfers,
    },
    quarterId,
    subjectId: quarterId,
    subjectTable: "treasury_transaction_transfers",
    summary: "Synced quarter transactions",
  });

  revalidatePath("/admin/quarters");
  revalidatePath(getTransactionsPath(quarterId));
  revalidatePath("/proposals");

  const params = new URLSearchParams({
    imported: String(result.importedTransfers),
    proposals: String(proposalResult.linkedTransactions),
    syncId: result.syncedAt,
    synced: result.errors.length > 0 ? "partial" : "1",
  });

  if (result.errors.length > 0) {
    params.set("errors", String(result.errors.length));
  }

  redirect(`${getTransactionsPath(quarterId)}?${params.toString()}`);
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

  await assertClassificationEntityMatchesCategory({
    category,
    entityId: counterpartyEntityId,
  });
  await assertRaidIsAvailable(raidId);

  const source = await getLedgerSourceForTransfer(transfer);
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
