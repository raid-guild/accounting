"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { entities, ledgerEntries, quarters, raids } from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit";
import { getAuthSession } from "@/lib/auth/session";
import { encryptField } from "@/lib/encryption";
import {
  lookupManualTransaction,
  type ManualTransactionLookupResult,
  type ManualLookupTransfer,
} from "@/lib/manual-transaction-lookup";

export type TransactionLookupState = {
  error: string | null;
  result: ManualTransactionLookupResult | null;
  saved: boolean;
  savedEntry: SavedManualRevenue | null;
};

export type SavedManualRevenue = {
  canRemove: boolean;
  id: string;
  quarterId: string;
  quarterLabel: string;
};

export type RemoveManualRaidRevenueState = {
  error: string | null;
  removed: boolean;
};

const USER_FACING_ERRORS = new Set([
  "ALCHEMY_API_KEY is required to look up this transaction",
  "Choose a supported chain",
  "Choose a transaction transfer",
  "Enter a valid transaction hash",
  "Only admins can edit a quarter after it is marked ready",
  "Published quarters must be reopened before editing",
  "Quarter not found",
  "Raid accounting access required",
  "Raid is required",
  "Raid not found",
  "Revenue can only be removed while the quarter is draft",
  "Revenue entry not found",
  "That transaction transfer is already saved as revenue",
  "Transaction not found",
  "USD amount must be greater than zero",
  "USD amount must be a positive dollar amount",
  "Unsupported lookup chain",
]);
const RPC_CONFIG_ERROR_PATTERN =
  /^[A-Z][A-Z0-9_]* is required to look up this transaction$/;

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getChainId(value: string) {
  const chainId = Number(value);

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error("Choose a supported chain");
  }

  return chainId;
}

async function requireRaidAccountingAccess() {
  const session = await getAuthSession();

  if (!session.address || !session.permissions?.canWriteRaidAccounting) {
    throw new Error("Raid accounting access required");
  }

  return session;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      USER_FACING_ERRORS.has(error.message) ||
      RPC_CONFIG_ERROR_PATTERN.test(error.message)
    ) {
      return error.message;
    }
  }

  return "Transaction lookup failed. Check the selected chain and try again.";
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

function getTransferIndex(value: string) {
  const index = Number(value);

  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Choose a transaction transfer");
  }

  return index;
}

function getAccountingQuarter(date: Date) {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const startsOn = `${year}-${String((quarter - 1) * 3 + 1).padStart(
    2,
    "0",
  )}-01`;
  const endMonth = quarter * 3;
  const endsOn = new Date(Date.UTC(year, endMonth, 0))
    .toISOString()
    .slice(0, 10);

  return {
    endsOn,
    label: `Q${quarter} ${year}`,
    quarter,
    startsOn,
    year,
  };
}

async function getOrCreateQuarter(occurredAt: Date) {
  const definition = getAccountingQuarter(occurredAt);
  const db = getDb();
  const [insertedQuarter] = await db
    .insert(quarters)
    .values({ ...definition, status: "draft" })
    .onConflictDoNothing({ target: [quarters.year, quarters.quarter] })
    .returning();
  const [quarter] = insertedQuarter
    ? [insertedQuarter]
    : await db
        .select()
        .from(quarters)
        .where(
          and(
            eq(quarters.year, definition.year),
            eq(quarters.quarter, definition.quarter),
          ),
        )
        .limit(1);

  if (!quarter) {
    throw new Error("Quarter not found");
  }

  return quarter;
}

function assertQuarterCanAcceptManualRevenue({
  canAdmin,
  status,
}: {
  canAdmin: boolean;
  status: typeof quarters.$inferSelect.status;
}) {
  if (status === "published") {
    throw new Error("Published quarters must be reopened before editing");
  }

  if (!canAdmin && status !== "draft") {
    throw new Error("Only admins can edit a quarter after it is marked ready");
  }
}

async function getRaidForRevenue(raidId: string) {
  if (!raidId) {
    throw new Error("Raid is required");
  }

  const [row] = await getDb()
    .select({ client: entities, raid: raids })
    .from(raids)
    .innerJoin(entities, eq(raids.clientEntityId, entities.id))
    .where(eq(raids.id, raidId))
    .limit(1);

  if (!row) {
    throw new Error("Raid not found");
  }

  return row;
}

function getLedgerAssetAmount(transfer: ManualLookupTransfer) {
  const [whole = "0", rawFraction = ""] = transfer.amount.split(".");
  const fraction = rawFraction.slice(0, 18);

  return fraction ? `${whole}.${fraction}` : whole;
}

function getSourceExternalId({
  chainId,
  transferIndex,
  txHash,
}: {
  chainId: number;
  transferIndex: number;
  txHash: string;
}) {
  return `manual-onchain:${chainId}:${txHash.toLowerCase()}:${transferIndex}`;
}

export async function lookupRaidTransaction(
  _previousState: TransactionLookupState,
  formData: FormData,
): Promise<TransactionLookupState> {
  try {
    await requireRaidAccountingAccess();

    const chainId = getChainId(getString(formData, "chainId"));
    const txHash = getString(formData, "txHash");

    const result = await lookupManualTransaction({ chainId, txHash });

    return { error: null, result, saved: false, savedEntry: null };
  } catch (error) {
    return {
      error: getErrorMessage(error),
      result: null,
      saved: false,
      savedEntry: null,
    };
  }
}

export async function saveManualRaidRevenue(
  _previousState: TransactionLookupState,
  formData: FormData,
): Promise<TransactionLookupState> {
  try {
    const session = await requireRaidAccountingAccess();
    const chainId = getChainId(getString(formData, "chainId"));
    const txHash = getString(formData, "txHash");
    const transferIndex = getTransferIndex(getString(formData, "transferIndex"));
    const raidId = getString(formData, "raidId");
    const notes = getString(formData, "notes");
    const usdAmount = getUsdAmount(getString(formData, "usdAmount"));
    const result = await lookupManualTransaction({ chainId, txHash });
    const transfer = result.transfers[transferIndex];

    if (!transfer) {
      throw new Error("Choose a transaction transfer");
    }

    const sourceExternalId = getSourceExternalId({
      chainId,
      transferIndex,
      txHash: result.txHash,
    });
    const [existingEntry] = await getDb()
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceExternalId, sourceExternalId))
      .limit(1);

    if (existingEntry) {
      throw new Error("That transaction transfer is already saved as revenue");
    }

    const { client, raid } = await getRaidForRevenue(raidId);
    const occurredAt = new Date(result.executedAt);
    const quarter = await getOrCreateQuarter(occurredAt);
    assertQuarterCanAcceptManualRevenue({
      canAdmin: Boolean(session.permissions?.canAdmin),
      status: quarter.status,
    });
    const sourceMetadata = {
      blockExplorerUrl: result.blockExplorerUrl,
      blockNumber: result.blockNumber,
      chainName: result.chainName,
      fromAddress: transfer.fromAddress,
      lookupClassification: result.classification,
      nativeValue: result.nativeValue,
      rawAmount: transfer.rawAmount,
      receivingAddress: transfer.toAddress,
      selectedTransferIndex: transferIndex,
      senderAddress: result.fromAddress,
      status: result.status,
      toAddress: transfer.toAddress,
      tokenAddress: transfer.tokenAddress,
      transferType: transfer.transferType,
      txRecipientAddress: result.toAddress,
    };

    const [entry] = await getDb()
      .insert(ledgerEntries)
      .values({
        assetAmount: getLedgerAssetAmount(transfer),
        assetSymbol: transfer.assetSymbol,
        category: "raid_revenue",
        chainId,
        counterpartyEntityId: client.id,
        notesEncrypted: notes ? encryptField(notes) : null,
        occurredAt,
        quarterId: quarter.id,
        raidId: raid.id,
        source: "manual",
        sourceExternalId,
        sourceMetadata,
        txHash: result.txHash,
        usdAmount,
        verificationStatus: "verified",
      })
      .onConflictDoNothing({ target: ledgerEntries.sourceExternalId })
      .returning();

    if (!entry) {
      throw new Error("That transaction transfer is already saved as revenue");
    }

    await writeAuditEvent({
      action: "import",
      actorWalletAddress: session.address,
      metadata: {
        chainId,
        quarterId: quarter.id,
        raidId: raid.id,
        sourceExternalId,
        transferIndex,
        txHash: result.txHash,
      },
      quarterId: quarter.id,
      subjectId: entry?.id,
      subjectTable: "ledger_entries",
      summary: "Saved manual raid revenue",
    });

    revalidatePath("/raids");
    revalidatePath("/admin/quarters");
    revalidatePath(`/admin/quarters/${quarter.id}/transactions`);

    return {
      error: null,
      result: null,
      saved: true,
      savedEntry: {
        canRemove: quarter.status === "draft",
        id: entry.id,
        quarterId: quarter.id,
        quarterLabel: quarter.label,
      },
    };
  } catch (error) {
    return {
      error: getErrorMessage(error),
      result: null,
      saved: false,
      savedEntry: null,
    };
  }
}

export async function removeManualRaidRevenue(
  _previousState: RemoveManualRaidRevenueState,
  formData: FormData,
): Promise<RemoveManualRaidRevenueState> {
  try {
    const session = await requireRaidAccountingAccess();
    const id = getString(formData, "ledgerEntryId");

    if (!id) {
      throw new Error("Revenue entry not found");
    }

    const [row] = await getDb()
      .select({ entry: ledgerEntries, quarter: quarters })
      .from(ledgerEntries)
      .innerJoin(quarters, eq(ledgerEntries.quarterId, quarters.id))
      .where(
        and(
          eq(ledgerEntries.id, id),
          eq(ledgerEntries.source, "manual"),
          eq(ledgerEntries.category, "raid_revenue"),
        ),
      )
      .limit(1);

    if (!row) {
      throw new Error("Revenue entry not found");
    }

    if (row.quarter.status !== "draft") {
      throw new Error("Revenue can only be removed while the quarter is draft");
    }

    const [deletedEntry] = await getDb()
      .delete(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.id, row.entry.id),
          eq(ledgerEntries.source, "manual"),
          eq(ledgerEntries.category, "raid_revenue"),
        ),
      )
      .returning();

    if (!deletedEntry) {
      throw new Error("Revenue entry not found");
    }

    await writeAuditEvent({
      action: "delete",
      actorWalletAddress: session.address,
      metadata: {
        chainId: row.entry.chainId,
        raidId: row.entry.raidId,
        sourceExternalId: row.entry.sourceExternalId,
        txHash: row.entry.txHash,
      },
      quarterId: row.quarter.id,
      subjectId: row.entry.id,
      subjectTable: "ledger_entries",
      summary: "Removed manual raid revenue",
    });

    revalidatePath("/raids");
    revalidatePath("/admin/quarters");
    revalidatePath(`/admin/quarters/${row.quarter.id}/transactions`);

    return { error: null, removed: true };
  } catch (error) {
    return { error: getErrorMessage(error), removed: false };
  }
}

export async function removeManualRaidRevenueFromForm(formData: FormData) {
  const state = await removeManualRaidRevenue(
    { error: null, removed: false },
    formData,
  );

  if (state.error) {
    throw new Error(state.error);
  }
}
