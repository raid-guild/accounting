"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { entities, ledgerEntries, quarters, raids } from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit";
import {
  canUseAdminAccess,
  canUseRaidAccountingAccess,
  getAuthSession,
} from "@/lib/auth/session";
import { encryptField } from "@/lib/encryption";
import { deleteQuarterBalanceValidation } from "@/lib/quarter-balance-validation";
import {
  lookupManualTransaction,
  type ManualTransactionLookupResult,
  type ManualLookupTransfer,
} from "@/lib/manual-transaction-lookup";
import { getHistoricalUsdPricing } from "@/lib/treasury/pricing";

export type TransactionLookupState = {
  error: string | null;
  existingEntries?: ExistingManualTransferEntry[];
  result: ManualTransactionLookupResult | null;
  saved: boolean;
  savedEntry: SavedManualRaidLedgerEntry | null;
};

export type ExistingManualTransferEntry = {
  category: typeof ledgerEntries.$inferSelect.category;
  id: string;
  quarterId: string | null;
  quarterLabel: string | null;
  sourceExternalId: string;
  transferIndex: number;
};

export type SavedManualRaidLedgerEntry = {
  canRemove: boolean;
  id: string;
  kind: ManualRaidLedgerKind;
  quarterId: string;
  quarterLabel: string;
};

export type ManualRaidLedgerKind = "payout" | "revenue";

export type RemoveManualRaidLedgerEntryState = {
  error: string | null;
  removed: boolean;
};

export type UpdateManualRaidLedgerEntryState = {
  error: string | null;
  updated: boolean;
};

export type ManualTransferPriceState = {
  error: string | null;
  priceSource: string | null;
  priceUsd: string | null;
  usdAmount: string | null;
};

const USER_FACING_ERRORS = new Set([
  "ALCHEMY_API_KEY is required to look up this transaction",
  "Choose a supported chain",
  "Choose a transaction transfer",
  "Enter a valid transaction hash",
  "Ledger entry type is required",
  "Only admins can edit a quarter after it is marked ready",
  "Payout can only be removed while the quarter is draft",
  "Payout entry not found",
  "Published quarters must be reopened before editing",
  "Quarter not found",
  "Raid accounting access required",
  "Raid is required",
  "Raid not found",
  "Revenue can only be edited while the quarter is draft",
  "Revenue can only be removed while the quarter is draft",
  "Revenue entry not found",
  "Subcontractor is required",
  "Subcontractor not found",
  "Payout can only be edited while the quarter is draft",
  "That transaction transfer is already saved",
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

  if (!canUseRaidAccountingAccess(session)) {
    throw new Error("Raid accounting access required");
  }

  return session;
}

function getUserFacingErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      USER_FACING_ERRORS.has(error.message) ||
      RPC_CONFIG_ERROR_PATTERN.test(error.message)
    ) {
      return error.message;
    }
  }

  return null;
}

function getErrorMessage(error: unknown) {
  return (
    getUserFacingErrorMessage(error) ??
    "Transaction lookup failed. Check the selected chain and try again."
  );
}

function getManualLedgerUpdateErrorMessage(error: unknown) {
  return (
    getUserFacingErrorMessage(error) ??
    "Manual ledger entry update failed. Check the entry and try again."
  );
}

function getPricingErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message === "Asset amount is invalid" ||
      error.message === "Choose a transaction transfer" ||
      error.message === "CoinGecko historical price request failed" ||
      error.message === "CoinGecko historical price unavailable" ||
      error.message === "Raid accounting access required" ||
      error.message.startsWith("Historical pricing is not configured for ")
    ) {
      return error.message;
    }
  }

  return "Historical price lookup failed. Try again or enter the USD amount manually.";
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

function getManualRaidLedgerKind(value: string): ManualRaidLedgerKind {
  if (value === "payout" || value === "revenue") {
    return value;
  }

  throw new Error("Ledger entry type is required");
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

function assertQuarterCanAcceptManualEntry({
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

async function getRaidForManualLedgerEntry(raidId: string) {
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

async function getSubcontractorForPayout(subcontractorId: string) {
  if (!subcontractorId) {
    throw new Error("Subcontractor is required");
  }

  const [subcontractor] = await getDb()
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.id, subcontractorId),
        eq(entities.type, "subcontractor"),
      ),
    )
    .limit(1);

  if (!subcontractor) {
    throw new Error("Subcontractor not found");
  }

  return subcontractor;
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

function getTransferIndexFromSourceExternalId(sourceExternalId: string) {
  const transferIndex = Number(sourceExternalId.split(":").at(-1));

  return Number.isInteger(transferIndex) && transferIndex >= 0
    ? transferIndex
    : null;
}

async function getExistingManualTransferEntries({
  chainId,
  transferCount,
  txHash,
}: {
  chainId: number;
  transferCount: number;
  txHash: string;
}): Promise<ExistingManualTransferEntry[]> {
  const sourceExternalIds = Array.from({ length: transferCount }, (_, index) =>
    getSourceExternalId({ chainId, transferIndex: index, txHash }),
  );

  if (sourceExternalIds.length === 0) {
    return [];
  }

  const rows = await getDb()
    .select({
      category: ledgerEntries.category,
      id: ledgerEntries.id,
      quarterId: ledgerEntries.quarterId,
      quarterLabel: quarters.label,
      sourceExternalId: ledgerEntries.sourceExternalId,
    })
    .from(ledgerEntries)
    .leftJoin(quarters, eq(ledgerEntries.quarterId, quarters.id))
    .where(inArray(ledgerEntries.sourceExternalId, sourceExternalIds));

  return rows.flatMap((row) => {
    if (!row.sourceExternalId) {
      return [];
    }

    const transferIndex = getTransferIndexFromSourceExternalId(
      row.sourceExternalId,
    );

    if (transferIndex === null) {
      return [];
    }

    return {
      category: row.category,
      id: row.id,
      quarterId: row.quarterId,
      quarterLabel: row.quarterLabel,
      sourceExternalId: row.sourceExternalId,
      transferIndex,
    };
  });
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
    const existingEntries = await getExistingManualTransferEntries({
      chainId,
      transferCount: result.transfers.length,
      txHash: result.txHash,
    });

    return {
      error: null,
      existingEntries,
      result,
      saved: false,
      savedEntry: null,
    };
  } catch (error) {
    return {
      error: getErrorMessage(error),
      existingEntries: [],
      result: null,
      saved: false,
      savedEntry: null,
    };
  }
}

export async function fetchManualTransferUsdPrice({
  chainId,
  transferIndex,
  txHash,
}: {
  chainId: number;
  transferIndex: string;
  txHash: string;
}): Promise<ManualTransferPriceState> {
  try {
    await requireRaidAccountingAccess();

    const parsedChainId = getChainId(String(chainId));
    const parsedTransferIndex = getTransferIndex(transferIndex);
    const result = await lookupManualTransaction({
      chainId: parsedChainId,
      txHash,
    });
    const transfer = result.transfers[parsedTransferIndex];

    if (!transfer) {
      throw new Error("Choose a transaction transfer");
    }

    const pricing = await getHistoricalUsdPricing({
      amount: getLedgerAssetAmount(transfer),
      assetSymbol: transfer.assetSymbol,
      executedAt: new Date(result.executedAt),
    });

    return {
      error: null,
      priceSource: pricing.priceSource,
      priceUsd: pricing.priceUsd,
      usdAmount: pricing.usdAmount,
    };
  } catch (error) {
    return {
      error: getPricingErrorMessage(error),
      priceSource: null,
      priceUsd: null,
      usdAmount: null,
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
      throw new Error("That transaction transfer is already saved");
    }

    const { client, raid } = await getRaidForManualLedgerEntry(raidId);
    const occurredAt = new Date(result.executedAt);
    const quarter = await getOrCreateQuarter(occurredAt);
    assertQuarterCanAcceptManualEntry({
      canAdmin: canUseAdminAccess(session),
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
      throw new Error("That transaction transfer is already saved");
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

    await deleteQuarterBalanceValidation(quarter.id);
    revalidatePath("/raids");
    revalidatePath("/admin/quarters");
    revalidatePath(`/admin/quarters/${quarter.id}/transactions`);
    revalidatePath("/reports");
    revalidatePath(`/reports/quarters/${quarter.id}`);

    return {
      error: null,
      result: null,
      saved: true,
      savedEntry: {
        canRemove: quarter.status === "draft",
        id: entry.id,
        kind: "revenue",
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

export async function saveManualRaidPayout(
  _previousState: TransactionLookupState,
  formData: FormData,
): Promise<TransactionLookupState> {
  try {
    const session = await requireRaidAccountingAccess();
    const chainId = getChainId(getString(formData, "chainId"));
    const txHash = getString(formData, "txHash");
    const transferIndex = getTransferIndex(getString(formData, "transferIndex"));
    const raidId = getString(formData, "raidId");
    const subcontractorId = getString(formData, "subcontractorId");
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
      throw new Error("That transaction transfer is already saved");
    }

    const { raid } = await getRaidForManualLedgerEntry(raidId);
    const subcontractor = await getSubcontractorForPayout(subcontractorId);
    const occurredAt = new Date(result.executedAt);
    const quarter = await getOrCreateQuarter(occurredAt);
    assertQuarterCanAcceptManualEntry({
      canAdmin: canUseAdminAccess(session),
      status: quarter.status,
    });
    const sourceMetadata = {
      blockExplorerUrl: result.blockExplorerUrl,
      blockNumber: result.blockNumber,
      chainName: result.chainName,
      fromAddress: transfer.fromAddress,
      lookupClassification: result.classification,
      nativeValue: result.nativeValue,
      paidAddress: transfer.toAddress,
      rawAmount: transfer.rawAmount,
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
        category: "subcontractor_payout",
        chainId,
        counterpartyEntityId: subcontractor.id,
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
      throw new Error("That transaction transfer is already saved");
    }

    await writeAuditEvent({
      action: "import",
      actorWalletAddress: session.address,
      metadata: {
        chainId,
        quarterId: quarter.id,
        raidId: raid.id,
        sourceExternalId,
        subcontractorId: subcontractor.id,
        transferIndex,
        txHash: result.txHash,
      },
      quarterId: quarter.id,
      subjectId: entry?.id,
      subjectTable: "ledger_entries",
      summary: "Saved manual raid payout",
    });

    await deleteQuarterBalanceValidation(quarter.id);
    revalidatePath("/raids");
    revalidatePath("/admin/quarters");
    revalidatePath(`/admin/quarters/${quarter.id}/transactions`);
    revalidatePath("/reports");
    revalidatePath(`/reports/quarters/${quarter.id}`);

    return {
      error: null,
      result: null,
      saved: true,
      savedEntry: {
        canRemove: quarter.status === "draft",
        id: entry.id,
        kind: "payout",
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

export async function removeManualRaidLedgerEntry(
  _previousState: RemoveManualRaidLedgerEntryState,
  formData: FormData,
): Promise<RemoveManualRaidLedgerEntryState> {
  try {
    const session = await requireRaidAccountingAccess();
    const id = getString(formData, "ledgerEntryId");
    const kind = getManualRaidLedgerKind(getString(formData, "kind"));
    const category =
      kind === "payout" ? "subcontractor_payout" : "raid_revenue";
    const label = kind === "payout" ? "Payout" : "Revenue";

    if (!id) {
      throw new Error(`${label} entry not found`);
    }

    const [row] = await getDb()
      .select({ entry: ledgerEntries, quarter: quarters })
      .from(ledgerEntries)
      .innerJoin(quarters, eq(ledgerEntries.quarterId, quarters.id))
      .where(
        and(
          eq(ledgerEntries.id, id),
          eq(ledgerEntries.source, "manual"),
          eq(ledgerEntries.category, category),
        ),
      )
      .limit(1);

    if (!row) {
      throw new Error(`${label} entry not found`);
    }

    if (row.quarter.status !== "draft") {
      throw new Error(
        `${label} can only be removed while the quarter is draft`,
      );
    }

    const [deletedEntry] = await getDb()
      .delete(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.id, row.entry.id),
          eq(ledgerEntries.source, "manual"),
          eq(ledgerEntries.category, category),
        ),
      )
      .returning();

    if (!deletedEntry) {
      throw new Error(`${label} entry not found`);
    }

    await writeAuditEvent({
      action: "delete",
      actorWalletAddress: session.address,
      metadata: {
        chainId: row.entry.chainId,
        category,
        raidId: row.entry.raidId,
        sourceExternalId: row.entry.sourceExternalId,
        txHash: row.entry.txHash,
      },
      quarterId: row.quarter.id,
      subjectId: row.entry.id,
      subjectTable: "ledger_entries",
      summary: `Removed manual raid ${kind}`,
    });

    await deleteQuarterBalanceValidation(row.quarter.id);
    revalidatePath("/raids");
    revalidatePath("/admin/quarters");
    revalidatePath(`/admin/quarters/${row.quarter.id}/transactions`);
    revalidatePath("/reports");
    revalidatePath(`/reports/quarters/${row.quarter.id}`);

    return { error: null, removed: true };
  } catch (error) {
    return { error: getErrorMessage(error), removed: false };
  }
}

export async function updateManualRaidLedgerEntry(
  _previousState: UpdateManualRaidLedgerEntryState,
  formData: FormData,
): Promise<UpdateManualRaidLedgerEntryState> {
  try {
    const session = await requireRaidAccountingAccess();
    const id = getString(formData, "ledgerEntryId");
    const kind = getManualRaidLedgerKind(getString(formData, "kind"));
    const category =
      kind === "payout" ? "subcontractor_payout" : "raid_revenue";
    const label = kind === "payout" ? "Payout" : "Revenue";
    const raidId = getString(formData, "raidId");
    const notes = getString(formData, "notes");
    const usdAmount = getUsdAmount(getString(formData, "usdAmount"));

    if (!id) {
      throw new Error(`${label} entry not found`);
    }

    const [row] = await getDb()
      .select({ entry: ledgerEntries, quarter: quarters })
      .from(ledgerEntries)
      .innerJoin(quarters, eq(ledgerEntries.quarterId, quarters.id))
      .where(
        and(
          eq(ledgerEntries.id, id),
          eq(ledgerEntries.source, "manual"),
          eq(ledgerEntries.category, category),
        ),
      )
      .limit(1);

    if (!row) {
      throw new Error(`${label} entry not found`);
    }

    if (row.quarter.status !== "draft") {
      throw new Error(`${label} can only be edited while the quarter is draft`);
    }

    const { client, raid } = await getRaidForManualLedgerEntry(raidId);
    const counterpartyEntityId =
      kind === "payout"
        ? (await getSubcontractorForPayout(getString(formData, "subcontractorId")))
            .id
        : client.id;

    const [updatedEntry] = await getDb()
      .update(ledgerEntries)
      .set({
        counterpartyEntityId,
        notesEncrypted: notes ? encryptField(notes) : null,
        raidId: raid.id,
        usdAmount,
      })
      .where(
        and(
          eq(ledgerEntries.id, row.entry.id),
          eq(ledgerEntries.source, "manual"),
          eq(ledgerEntries.category, category),
        ),
      )
      .returning();

    if (!updatedEntry) {
      throw new Error(`${label} entry not found`);
    }

    await writeAuditEvent({
      action: "update",
      actorWalletAddress: session.address,
      metadata: {
        category,
        previousRaidId: row.entry.raidId,
        raidId: raid.id,
        sourceExternalId: row.entry.sourceExternalId,
        txHash: row.entry.txHash,
      },
      quarterId: row.quarter.id,
      subjectId: row.entry.id,
      subjectTable: "ledger_entries",
      summary: `Updated manual raid ${kind}`,
    });

    await deleteQuarterBalanceValidation(row.quarter.id);
    revalidatePath("/raids");
    revalidatePath("/admin/quarters");
    revalidatePath(`/admin/quarters/${row.quarter.id}/transactions`);
    revalidatePath("/reports");
    revalidatePath(`/reports/quarters/${row.quarter.id}`);

    return { error: null, updated: true };
  } catch (error) {
    return { error: getManualLedgerUpdateErrorMessage(error), updated: false };
  }
}
