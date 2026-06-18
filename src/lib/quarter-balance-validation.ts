import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  ledgerEntries,
  quarterBalanceSnapshots,
  quarterBalanceValidations,
  treasuryAccounts,
  treasuryTransactionTransfers,
} from "@/db/schema";
import {
  decryptField,
  encryptField,
  type EncryptedField,
} from "@/lib/encryption";
import type { QuarterClassificationSummary, QuarterSummary } from "@/lib/quarters";
import { isQuarterSyncFresh, type QuarterSyncStatus } from "@/lib/quarter-sync";

export type QuarterBalanceValidationStatus =
  | "not_ready"
  | "needs_review"
  | "validated"
  | "acknowledged";

export type QuarterBalanceValidationVariance = {
  accountAddress: string;
  accountName: string;
  actualClosing: string;
  assetSymbol: string;
  chainId: number;
  difference: string;
  expectedClosing: string;
  movement: string;
  opening: string;
  usdPrice: string;
  varianceUsd: string;
};

export type QuarterBalanceValidationExcludedRow = {
  assetAmount: string;
  assetSymbol: string;
  category: string;
  id: string;
  reason: string;
  source: string;
};

export type QuarterBalanceValidationDetails = {
  excludedRows: QuarterBalanceValidationExcludedRow[];
  variances: QuarterBalanceValidationVariance[];
};

export type QuarterBalanceValidation = {
  acknowledgedAt: string | null;
  acknowledgedByWalletAddress: string | null;
  acknowledgementNote: string | null;
  checkedCount: number;
  details: QuarterBalanceValidationDetails;
  excludedCount: number;
  id: string;
  quarterId: string;
  sourceSyncRunId: string | null;
  status: QuarterBalanceValidationStatus;
  totalVarianceUsd: string;
  updatedAt: string;
  varianceCount: number;
};

export type QuarterBalanceValidationReadiness = {
  reason: string | null;
  ready: boolean;
};

type QuarterValidationInput = Pick<
  QuarterSummary,
  "endsOn" | "id" | "startsOn"
>;

type BalanceRow = typeof quarterBalanceSnapshots.$inferSelect;
type ManualLedgerEntry = typeof ledgerEntries.$inferSelect;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const NEGATIVE_ONE = BigInt(-1);
const DECIMAL_SCALE = BigInt(10) ** BigInt(18);
const TOKEN_TOLERANCE = BigInt(10) ** BigInt(12); // 0.000001 at 18-decimal precision.

function parseFixedDecimal(value: string | null | undefined) {
  if (!value?.trim()) {
    return ZERO;
  }

  const trimmed = value.trim();
  const sign = trimmed.startsWith("-") ? NEGATIVE_ONE : ONE;
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");

  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) {
    return ZERO;
  }

  const wholeValue = BigInt(whole || "0") * DECIMAL_SCALE;
  const fractionValue = BigInt(
    fraction.padEnd(18, "0").slice(0, 18) || "0",
  );

  return sign * (wholeValue + fractionValue);
}

function absFixed(value: bigint) {
  return value < ZERO ? -value : value;
}

function formatFixedDecimal(value: bigint, fractionDigits = 18) {
  const sign = value < ZERO ? "-" : "";
  const absolute = absFixed(value);
  const whole = absolute / DECIMAL_SCALE;
  const fraction = absolute % DECIMAL_SCALE;
  const fractionText = fraction
    .toString()
    .padStart(18, "0")
    .slice(0, fractionDigits)
    .replace(/0+$/, "");

  return `${sign}${whole.toString()}${fractionText ? `.${fractionText}` : ""}`;
}

function multiplyFixed(left: bigint, right: bigint) {
  return (left * right) / DECIMAL_SCALE;
}

function formatUsd(value: bigint) {
  const sign = value < ZERO ? "-" : "";
  const cents =
    (absFixed(value) * BigInt(100) + DECIMAL_SCALE / BigInt(2)) /
    DECIMAL_SCALE;
  const dollars = cents / BigInt(100);
  const pennies = cents % BigInt(100);

  return `${sign}${dollars.toString()}.${pennies.toString().padStart(2, "0")}`;
}

function getKey({
  accountAddress,
  assetSymbol,
  chainId,
}: {
  accountAddress: string;
  assetSymbol: string;
  chainId: number;
}) {
  return `${chainId}:${accountAddress.toLowerCase()}:${assetSymbol.toUpperCase()}`;
}

function getMetadataObject(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function getMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];

  return typeof value === "string" && value ? value : null;
}

function mapValidation(
  validation: typeof quarterBalanceValidations.$inferSelect,
): QuarterBalanceValidation {
  return {
    acknowledgedAt: validation.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByWalletAddress: validation.acknowledgedByWalletAddress,
    acknowledgementNote: validation.acknowledgementNoteEncrypted
      ? decryptField(validation.acknowledgementNoteEncrypted as EncryptedField)
      : null,
    checkedCount: validation.checkedCount,
    details: validation.details as QuarterBalanceValidationDetails,
    excludedCount: validation.excludedCount,
    id: validation.id,
    quarterId: validation.quarterId,
    sourceSyncRunId: validation.sourceSyncRunId,
    status: validation.status,
    totalVarianceUsd: validation.totalVarianceUsd,
    updatedAt: validation.updatedAt.toISOString(),
    varianceCount: validation.varianceCount,
  };
}

export async function getQuarterBalanceValidation(quarterId: string) {
  const [validation] = await getDb()
    .select()
    .from(quarterBalanceValidations)
    .where(eq(quarterBalanceValidations.quarterId, quarterId))
    .limit(1);

  return validation ? mapValidation(validation) : null;
}

export async function getQuarterBalanceValidationMap(quarterIds: string[]) {
  if (quarterIds.length === 0) {
    return new Map<string, QuarterBalanceValidation>();
  }

  const rows = await getDb()
    .select()
    .from(quarterBalanceValidations)
    .where(inArray(quarterBalanceValidations.quarterId, quarterIds));

  return new Map(rows.map((row) => [row.quarterId, mapValidation(row)]));
}

export function isQuarterBalanceValidationSatisfied(
  validation: QuarterBalanceValidation | null,
) {
  return (
    validation?.status === "validated" || validation?.status === "acknowledged"
  );
}

export function getQuarterValidationReadiness({
  classificationSummary,
  quarter,
  syncStatus,
}: {
  classificationSummary: QuarterClassificationSummary;
  quarter: Pick<QuarterSummary, "endsOn">;
  syncStatus: QuarterSyncStatus | null;
}): QuarterBalanceValidationReadiness {
  if (!isQuarterSyncFresh({ quarter, syncStatus })) {
    return {
      ready: false,
      reason: "Sync quarter activity and balances before validating",
    };
  }

  if (syncStatus?.balancesStatus !== "success") {
    return {
      ready: false,
      reason: "Quarter balances must sync successfully before validating",
    };
  }

  if (classificationSummary.unclassifiedTransfers > 0) {
    return {
      ready: false,
      reason: "Classify every transaction before validating balances",
    };
  }

  return { ready: true, reason: null };
}

export async function deleteQuarterBalanceValidation(quarterId: string) {
  await getDb()
    .delete(quarterBalanceValidations)
    .where(eq(quarterBalanceValidations.quarterId, quarterId));
}

function getManualMovementAccountAddress({
  entry,
  trackedAccounts,
}: {
  entry: ManualLedgerEntry;
  trackedAccounts: Set<string>;
}) {
  if (!entry.chainId) {
    return null;
  }

  const metadata = getMetadataObject(entry.sourceMetadata);
  const candidates =
    entry.category === "raid_revenue" || entry.category === "raid_spoils"
      ? [
          getMetadataString(metadata, "receivingAddress"),
          getMetadataString(metadata, "toAddress"),
        ]
      : [
          getMetadataString(metadata, "paidAddress"),
          getMetadataString(metadata, "fromAddress"),
          getMetadataString(metadata, "senderAddress"),
      ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (trackedAccounts.has(`${entry.chainId}:${candidate.toLowerCase()}`)) {
      return candidate;
    }
  }

  return null;
}

function getManualMovementSign(category: string) {
  if (category === "raid_revenue" || category === "raid_spoils") {
    return 1;
  }

  if (
    category === "provider_expense" ||
    category === "ragequit" ||
    category === "rip_expense" ||
    category === "subcontractor_payout"
  ) {
    return -1;
  }

  return null;
}

function getTransferMovementSign({
  accountAddress,
  fromAddress,
  toAddress,
}: {
  accountAddress: string;
  fromAddress: string;
  toAddress: string;
}) {
  const account = accountAddress.toLowerCase();
  const from = fromAddress.toLowerCase();
  const to = toAddress.toLowerCase();

  if (from === account && to === account) {
    return 0;
  }

  if (to === account) {
    return 1;
  }

  if (from === account) {
    return -1;
  }

  return null;
}

export async function runQuarterBalanceValidation({
  classificationSummary,
  quarter,
  syncStatus,
}: {
  classificationSummary: QuarterClassificationSummary;
  quarter: QuarterValidationInput;
  syncStatus: QuarterSyncStatus | null;
}) {
  const readiness = getQuarterValidationReadiness({
    classificationSummary,
    quarter,
    syncStatus,
  });

  if (!readiness.ready) {
    throw new Error(readiness.reason ?? "Quarter is not ready for validation");
  }

  const db = getDb();
  const [balanceRows, transferRows, manualRows] = await Promise.all([
    db
      .select()
      .from(quarterBalanceSnapshots)
      .where(eq(quarterBalanceSnapshots.quarterId, quarter.id)),
    db
      .select({
        ledgerEntry: ledgerEntries,
        transfer: treasuryTransactionTransfers,
      })
      .from(treasuryTransactionTransfers)
      .innerJoin(
        ledgerEntries,
        eq(
          ledgerEntries.treasuryTransactionTransferId,
          treasuryTransactionTransfers.id,
        ),
      )
      .where(eq(ledgerEntries.quarterId, quarter.id)),
    db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.quarterId, quarter.id),
          sql`${ledgerEntries.treasuryTransactionTransferId} is null`,
        ),
      ),
  ]);
  const openingByKey = new Map<string, BalanceRow>();
  const closingByKey = new Map<string, BalanceRow>();
  const movements = new Map<string, bigint>();
  const trackedAccounts = new Set<string>();
  const accountNames = new Map<string, string>();
  const treasuryAccountIds = [
    ...new Set(
      balanceRows
        .map((row) => row.treasuryAccountId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const treasuryAccountNameRows =
    treasuryAccountIds.length > 0
      ? await db
          .select({
            id: treasuryAccounts.id,
            nameEncrypted: treasuryAccounts.nameEncrypted,
          })
          .from(treasuryAccounts)
          .where(inArray(treasuryAccounts.id, treasuryAccountIds))
      : [];
  const treasuryAccountNames = new Map(
    treasuryAccountNameRows.map((account) => [
      account.id,
      decryptField(account.nameEncrypted as EncryptedField),
    ]),
  );
  const excludedRows: QuarterBalanceValidationExcludedRow[] = [];

  for (const row of balanceRows) {
    const accountKey = `${row.chainId}:${row.accountAddress.toLowerCase()}`;
    const key = getKey({
      accountAddress: row.accountAddress,
      assetSymbol: row.symbol,
      chainId: row.chainId,
    });

    trackedAccounts.add(accountKey);
    accountNames.set(
      accountKey,
      row.treasuryAccountId
        ? (treasuryAccountNames.get(row.treasuryAccountId) ?? "Tracked Account")
        : "Treasury",
    );

    if (row.boundary === "opening") {
      openingByKey.set(key, row);
    } else {
      closingByKey.set(key, row);
    }
  }

  const balanceKeys = new Set([...openingByKey.keys(), ...closingByKey.keys()]);

  if (balanceKeys.size === 0) {
    throw new Error("Quarter balances must sync before validation can run");
  }

  for (const { ledgerEntry, transfer } of transferRows) {
    if (ledgerEntry.category === "uncategorized") {
      excludedRows.push({
        assetAmount: transfer.amount,
        assetSymbol: transfer.assetSymbol,
        category: ledgerEntry.category,
        id: ledgerEntry.id,
        reason: "Transaction is not classified",
        source: ledgerEntry.source,
      });
      continue;
    }

    const sign = getTransferMovementSign({
      accountAddress: transfer.accountAddress,
      fromAddress: transfer.fromAddress,
      toAddress: transfer.toAddress,
    });

    if (sign === null) {
      excludedRows.push({
        assetAmount: transfer.amount,
        assetSymbol: transfer.assetSymbol,
        category: ledgerEntry.category,
        id: ledgerEntry.id,
        reason: "Transfer does not match the tracked account side",
        source: ledgerEntry.source,
      });
      continue;
    }

    const key = getKey({
      accountAddress: transfer.accountAddress,
      assetSymbol: transfer.assetSymbol,
      chainId: transfer.chainId,
    });

    movements.set(
      key,
      (movements.get(key) ?? ZERO) +
        BigInt(sign) * parseFixedDecimal(transfer.amount),
    );
    balanceKeys.add(key);
  }

  for (const entry of manualRows) {
    if (entry.category === "uncategorized") {
      excludedRows.push({
        assetAmount: entry.assetAmount,
        assetSymbol: entry.assetSymbol,
        category: entry.category,
        id: entry.id,
        reason: "Ledger entry is not classified",
        source: entry.source,
      });
      continue;
    }

    const sign = getManualMovementSign(entry.category);

    if (sign === null || !entry.chainId) {
      excludedRows.push({
        assetAmount: entry.assetAmount,
        assetSymbol: entry.assetSymbol,
        category: entry.category,
        id: entry.id,
        reason: "Ledger entry does not have enough account data",
        source: entry.source,
      });
      continue;
    }

    const accountAddress = getManualMovementAccountAddress({
      entry,
      trackedAccounts,
    });

    if (!accountAddress) {
      excludedRows.push({
        assetAmount: entry.assetAmount,
        assetSymbol: entry.assetSymbol,
        category: entry.category,
        id: entry.id,
        reason: "Ledger entry account is not included in quarter balances",
        source: entry.source,
      });
      continue;
    }

    const key = getKey({
      accountAddress,
      assetSymbol: entry.assetSymbol,
      chainId: entry.chainId,
    });

    movements.set(
      key,
      (movements.get(key) ?? ZERO) +
        BigInt(sign) * parseFixedDecimal(entry.assetAmount),
    );
    balanceKeys.add(key);
  }

  const variances: QuarterBalanceValidationVariance[] = [];

  for (const key of balanceKeys) {
    const [chainIdText, accountAddress, assetSymbol] = key.split(":");
    const opening = openingByKey.get(key);
    const closing = closingByKey.get(key);
    const openingAmount = parseFixedDecimal(opening?.balance);
    const actualClosing = parseFixedDecimal(closing?.balance);
    const movement = movements.get(key) ?? ZERO;
    const expectedClosing = openingAmount + movement;
    const difference = actualClosing - expectedClosing;

    if (absFixed(difference) <= TOKEN_TOLERANCE) {
      continue;
    }

    const chainId = Number(chainIdText);
    const usdPrice = parseFixedDecimal(closing?.usdPrice ?? opening?.usdPrice);
    const varianceUsd = multiplyFixed(absFixed(difference), usdPrice);
    const accountKey = `${chainId}:${accountAddress.toLowerCase()}`;

    variances.push({
      accountAddress,
      accountName: accountNames.get(accountKey) ?? "Unknown Account",
      actualClosing: formatFixedDecimal(actualClosing),
      assetSymbol,
      chainId,
      difference: formatFixedDecimal(difference),
      expectedClosing: formatFixedDecimal(expectedClosing),
      movement: formatFixedDecimal(movement),
      opening: formatFixedDecimal(openingAmount),
      usdPrice: formatUsd(usdPrice),
      varianceUsd: formatUsd(varianceUsd),
    });
  }

  variances.sort(
    (left, right) => {
      const difference =
        parseFixedDecimal(right.varianceUsd) -
        parseFixedDecimal(left.varianceUsd);

      if (difference > ZERO) {
        return 1;
      }

      if (difference < ZERO) {
        return -1;
      }

      return 0;
    },
  );

  const status: QuarterBalanceValidationStatus =
    variances.length === 0 && excludedRows.length === 0
      ? "validated"
      : "needs_review";
  const totalVarianceUsd = variances.reduce(
    (total, variance) => total + parseFixedDecimal(variance.varianceUsd),
    ZERO,
  );

  const [validation] = await db
    .insert(quarterBalanceValidations)
    .values({
      checkedCount: balanceKeys.size,
      details: {
        excludedRows,
        variances,
      } satisfies QuarterBalanceValidationDetails,
      excludedCount: excludedRows.length,
      quarterId: quarter.id,
      sourceSyncRunId: syncStatus?.runId ?? null,
      status,
      totalVarianceUsd: formatUsd(totalVarianceUsd),
      varianceCount: variances.length,
    })
    .onConflictDoUpdate({
      set: {
        acknowledgedAt: null,
        acknowledgedByWalletAddress: null,
        acknowledgementNoteEncrypted: null,
        checkedCount: balanceKeys.size,
        details: {
          excludedRows,
          variances,
        } satisfies QuarterBalanceValidationDetails,
        excludedCount: excludedRows.length,
        sourceSyncRunId: syncStatus?.runId ?? null,
        status,
        totalVarianceUsd: formatUsd(totalVarianceUsd),
        updatedAt: sql`now()`,
        varianceCount: variances.length,
      },
      target: quarterBalanceValidations.quarterId,
    })
    .returning();

  return mapValidation(validation);
}

export async function acknowledgeQuarterBalanceValidation({
  note,
  quarterId,
  walletAddress,
}: {
  note: string;
  quarterId: string;
  walletAddress: string;
}) {
  const existing = await getQuarterBalanceValidation(quarterId);

  if (!existing) {
    throw new Error("Run balance validation before acknowledging variance");
  }

  if (existing.status === "validated") {
    throw new Error("This quarter has no variance to acknowledge");
  }

  if (existing.status !== "needs_review") {
    throw new Error("Re-run validation before acknowledging variance");
  }

  if (!note.trim()) {
    throw new Error("Variance note is required");
  }

  const [validation] = await getDb()
    .update(quarterBalanceValidations)
    .set({
      acknowledgedAt: new Date(),
      acknowledgedByWalletAddress: walletAddress,
      acknowledgementNoteEncrypted: encryptField(note.trim()),
      status: "acknowledged",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(quarterBalanceValidations.quarterId, quarterId),
        eq(quarterBalanceValidations.status, "needs_review"),
      ),
    )
    .returning();

  if (!validation) {
    throw new Error("Validation status changed. Re-run validation and try again.");
  }

  return mapValidation(validation);
}
