import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { gnosis } from "viem/chains";

import { getDb } from "@/db";
import {
  treasuryTransactionTransfers,
  treasuryTransactions,
} from "@/db/schema";
import { listActiveGnosisSideVaultAccounts } from "@/lib/treasury/accounts";

const DEFAULT_SAFE_TRANSACTION_SERVICE_URL =
  "https://api.safe.global/tx-service/gnosis/api/v1";
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 3;

type TreasuryTransactionSource = {
  id: string;
  name: string;
  address: Address;
  chainId: typeof gnosis.id;
  source: "main_safe" | "side_vault";
  treasuryAccountId: string | null;
};

type SafeTransferTokenInfo = {
  decimals?: number | null;
  name?: string | null;
  symbol?: string | null;
};

type SafeTransfer = {
  blockNumber?: number | null;
  executionDate?: string | null;
  from?: string | null;
  logIndex?: number | null;
  safeTxHash?: string | null;
  to?: string | null;
  tokenAddress?: string | null;
  tokenInfo?: SafeTransferTokenInfo | null;
  transactionHash?: string | null;
  transferId?: string | null;
  type?: string | null;
  value?: string | null;
};

type SafeTransfersResponse = {
  next?: string | null;
  results?: SafeTransfer[];
};

type NormalizedTransfer = {
  amount: string;
  assetName: string;
  assetSymbol: string;
  blockNumber: number | null;
  decimals: number;
  direction: "inflow" | "outflow" | "internal";
  executedAt: Date;
  fromAddress: Address;
  rawAmount: string;
  rawMetadata: SafeTransfer;
  safeTransactionHash: string | null;
  toAddress: Address;
  tokenAddress: Address | null;
  transferId: string;
  transferType: string;
  txHash: `0x${string}`;
  usdAmount: string | null;
  usdPrice: string | null;
};

export type TreasuryTransactionAccountSyncResult = {
  accountAddress: Address;
  accountName: string;
  importedTransfers: number;
  importedTransactions: number;
  scannedTransfers: number;
  source: "main_safe" | "side_vault";
};

export type TreasuryTransactionAccountSyncError = {
  accountAddress: Address;
  accountName: string;
  error: string;
  source: "main_safe" | "side_vault";
};

export type TreasuryTransactionSyncResult = {
  accounts: TreasuryTransactionAccountSyncResult[];
  errors: TreasuryTransactionAccountSyncError[];
  importedTransfers: number;
  importedTransactions: number;
  scannedTransfers: number;
  syncedAt: string;
};

function getMainSafeAddress() {
  const address = process.env.MAIN_SAFE_ADDRESS;

  if (!address || !isAddress(address, { strict: false })) {
    return null;
  }

  return getAddress(address);
}

function getSafeTransactionServiceUrl() {
  return (
    process.env.SAFE_TRANSACTION_SERVICE_URL ??
    DEFAULT_SAFE_TRANSACTION_SERVICE_URL
  ).replace(/\/$/, "");
}

function getPositiveInteger(value: number | undefined, fallback: number) {
  if (!value || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function normalizeHash(value: string | null | undefined) {
  if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    return null;
  }

  return value.toLowerCase() as `0x${string}`;
}

function lower(value: string) {
  return value.toLowerCase();
}

function normalizeAddress(value: string | null | undefined) {
  if (!value || !isAddress(value, { strict: false })) {
    return null;
  }

  return getAddress(value);
}

function getDirection({
  accountAddress,
  fromAddress,
  toAddress,
}: {
  accountAddress: Address;
  fromAddress: Address;
  toAddress: Address;
}): "inflow" | "outflow" | "internal" {
  const account = accountAddress.toLowerCase();
  const from = fromAddress.toLowerCase();
  const to = toAddress.toLowerCase();

  if (from === account && to === account) {
    return "internal";
  }

  return to === account ? "inflow" : "outflow";
}

function getAssetMetadata(transfer: SafeTransfer) {
  if (transfer.type === "ETHER_TRANSFER") {
    return {
      assetName: "Gnosis xDAI",
      assetSymbol: "xDAI",
      decimals: 18,
      tokenAddress: null,
      usdPrice: "1.00000000",
    };
  }

  const tokenInfo = transfer.tokenInfo;
  const decimals = tokenInfo?.decimals;
  const normalizedDecimals =
    typeof decimals === "number" && Number.isInteger(decimals) ? decimals : 18;

  return {
    assetName: tokenInfo?.name || tokenInfo?.symbol || "Token",
    assetSymbol: tokenInfo?.symbol || "TOKEN",
    decimals: normalizedDecimals,
    tokenAddress: normalizeAddress(transfer.tokenAddress),
    usdPrice:
      tokenInfo?.symbol === "USDC" || tokenInfo?.symbol === "wxDAI"
        ? "1.00000000"
        : null,
  };
}

function getUsdAmount({
  amount,
  usdPrice,
}: {
  amount: string;
  usdPrice: string | null;
}) {
  if (!usdPrice) {
    return null;
  }

  const usdAmount = Number(amount) * Number(usdPrice);

  return Number.isFinite(usdAmount) ? usdAmount.toFixed(2) : null;
}

function getFallbackTransferId({
  transfer,
  txHash,
}: {
  transfer: SafeTransfer;
  txHash: `0x${string}`;
}) {
  return [
    "safe",
    txHash,
    transfer.type ?? "transfer",
    transfer.logIndex ?? "no-log",
    transfer.from ?? "unknown-from",
    transfer.to ?? "unknown-to",
    transfer.value ?? "0",
    transfer.tokenAddress ?? "native",
  ].join(":");
}

function normalizeTransfer({
  account,
  transfer,
}: {
  account: TreasuryTransactionSource;
  transfer: SafeTransfer;
}): NormalizedTransfer | null {
  const txHash = normalizeHash(transfer.transactionHash);
  const fromAddress = normalizeAddress(transfer.from);
  const toAddress = normalizeAddress(transfer.to);
  const rawAmount = transfer.value ?? "0";
  const executedAt = transfer.executionDate
    ? new Date(transfer.executionDate)
    : null;

  if (
    !txHash ||
    !fromAddress ||
    !toAddress ||
    !executedAt ||
    Number.isNaN(executedAt.getTime()) ||
    !/^\d+$/.test(rawAmount)
  ) {
    return null;
  }

  const asset = getAssetMetadata(transfer);
  const amount = formatUnits(BigInt(rawAmount), asset.decimals);
  const usdAmount = getUsdAmount({ amount, usdPrice: asset.usdPrice });

  return {
    amount,
    assetName: asset.assetName,
    assetSymbol: asset.assetSymbol,
    blockNumber:
      Number.isInteger(transfer.blockNumber) && transfer.blockNumber
        ? transfer.blockNumber
        : null,
    decimals: asset.decimals,
    direction: getDirection({
      accountAddress: account.address,
      fromAddress,
      toAddress,
    }),
    executedAt,
    fromAddress,
    rawAmount,
    rawMetadata: transfer,
    safeTransactionHash: normalizeHash(transfer.safeTxHash),
    toAddress,
    tokenAddress: asset.tokenAddress,
    transferId: transfer.transferId ?? getFallbackTransferId({ transfer, txHash }),
    transferType: transfer.type ?? "TRANSFER",
    txHash,
    usdAmount,
    usdPrice: asset.usdPrice,
  };
}

function getTransfersUrl({
  account,
  limit,
  offset,
}: {
  account: TreasuryTransactionSource;
  limit: number;
  offset: number;
}) {
  const url = new URL(
    `${getSafeTransactionServiceUrl()}/safes/${account.address}/transfers/`,
  );
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  return url;
}

async function fetchSafeTransfersPage({
  account,
  limit,
  offset,
}: {
  account: TreasuryTransactionSource;
  limit: number;
  offset: number;
}) {
  const response = await fetch(getTransfersUrl({ account, limit, offset }), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Safe Transaction Service failed for ${account.name}: ${response.status}`,
    );
  }

  return (await response.json()) as SafeTransfersResponse;
}

async function listTransactionSources(): Promise<TreasuryTransactionSource[]> {
  const mainSafeAddress = getMainSafeAddress();
  const sideVaults = await listActiveGnosisSideVaultAccounts();
  const sources: TreasuryTransactionSource[] = [];
  const seen = new Set<string>();

  if (mainSafeAddress) {
    sources.push({
      id: "treasury",
      name: "Treasury",
      address: mainSafeAddress,
      chainId: gnosis.id,
      source: "main_safe",
      treasuryAccountId: null,
    });
    seen.add(`${gnosis.id}:${mainSafeAddress.toLowerCase()}`);
  }

  for (const sideVault of sideVaults) {
    const key = `${sideVault.chainId}:${sideVault.address.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    sources.push({
      id: sideVault.id,
      name: sideVault.name,
      address: sideVault.address,
      chainId: gnosis.id,
      source: "side_vault",
      treasuryAccountId: sideVault.id,
    });
    seen.add(key);
  }

  return sources;
}

async function getOrCreateTransaction({
  account,
  transfer,
}: {
  account: TreasuryTransactionSource;
  transfer: NormalizedTransfer;
}) {
  const db = getDb();
  const [existingTransaction] = await db
    .select({ id: treasuryTransactions.id })
    .from(treasuryTransactions)
    .where(
      and(
        eq(treasuryTransactions.chainId, account.chainId),
        sql`lower(${treasuryTransactions.accountAddress}) = ${lower(
          account.address,
        )}`,
        sql`lower(${treasuryTransactions.txHash}) = ${lower(transfer.txHash)}`,
      ),
    )
    .limit(1);

  if (existingTransaction) {
    return { id: existingTransaction.id, inserted: false };
  }

  const [createdTransaction] = await db
    .insert(treasuryTransactions)
    .values({
      accountAddress: account.address,
      blockNumber: transfer.blockNumber,
      chainId: account.chainId,
      executedAt: transfer.executedAt,
      rawMetadata: {
        sourceAccountId: account.id,
      },
      safeTransactionHash: transfer.safeTransactionHash,
      source: account.source,
      transactionType: "safe_transfer",
      treasuryAccountId: account.treasuryAccountId,
      txHash: transfer.txHash,
    })
    .onConflictDoNothing()
    .returning();

  if (createdTransaction) {
    return { id: createdTransaction.id, inserted: true };
  }

  const [transaction] = await db
    .select({ id: treasuryTransactions.id })
    .from(treasuryTransactions)
    .where(
      and(
        eq(treasuryTransactions.chainId, account.chainId),
        sql`lower(${treasuryTransactions.accountAddress}) = ${lower(
          account.address,
        )}`,
        sql`lower(${treasuryTransactions.txHash}) = ${lower(transfer.txHash)}`,
      ),
    )
    .limit(1);

  if (!transaction) {
    throw new Error("Treasury transaction insert failed");
  }

  return { id: transaction.id, inserted: false };
}

async function insertTransfer({
  account,
  transfer,
  transactionId,
}: {
  account: TreasuryTransactionSource;
  transfer: NormalizedTransfer;
  transactionId: string;
}) {
  const [createdTransfer] = await getDb()
    .insert(treasuryTransactionTransfers)
    .values({
      accountAddress: account.address,
      amount: transfer.amount,
      assetName: transfer.assetName,
      assetSymbol: transfer.assetSymbol,
      chainId: account.chainId,
      decimals: transfer.decimals,
      direction: transfer.direction,
      executedAt: transfer.executedAt,
      fromAddress: transfer.fromAddress,
      rawAmount: transfer.rawAmount,
      rawMetadata: transfer.rawMetadata,
      tokenAddress: transfer.tokenAddress,
      toAddress: transfer.toAddress,
      transferId: transfer.transferId,
      transferType: transfer.transferType,
      treasuryAccountId: account.treasuryAccountId,
      treasuryTransactionId: transactionId,
      txHash: transfer.txHash,
      usdAmount: transfer.usdAmount,
      usdPrice: transfer.usdPrice,
    })
    .onConflictDoNothing()
    .returning();

  return Boolean(createdTransfer);
}

async function syncAccountTransfers({
  account,
  limit,
  maxPages,
}: {
  account: TreasuryTransactionSource;
  limit: number;
  maxPages: number;
}): Promise<TreasuryTransactionAccountSyncResult> {
  let importedTransfers = 0;
  let importedTransactions = 0;
  let scannedTransfers = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * limit;
    const body = await fetchSafeTransfersPage({ account, limit, offset });
    const transfers = body.results ?? [];

    if (transfers.length === 0) {
      break;
    }

    for (const rawTransfer of transfers) {
      const transfer = normalizeTransfer({ account, transfer: rawTransfer });

      if (!transfer) {
        continue;
      }

      scannedTransfers += 1;

      const transaction = await getOrCreateTransaction({ account, transfer });
      const didInsertTransfer = await insertTransfer({
        account,
        transactionId: transaction.id,
        transfer,
      });

      if (transaction.inserted) {
        importedTransactions += 1;
      }

      if (didInsertTransfer) {
        importedTransfers += 1;
      }
    }

    if (!body.next) {
      break;
    }
  }

  return {
    accountAddress: account.address,
    accountName: account.name,
    importedTransfers,
    importedTransactions,
    scannedTransfers,
    source: account.source,
  };
}

export async function syncTreasuryTransactions({
  limit,
  maxPages,
}: {
  limit?: number;
  maxPages?: number;
} = {}): Promise<TreasuryTransactionSyncResult> {
  const sources = await listTransactionSources();
  const pageLimit = getPositiveInteger(limit, DEFAULT_PAGE_LIMIT);
  const pageCount = getPositiveInteger(maxPages, DEFAULT_MAX_PAGES);

  if (sources.length === 0) {
    throw new Error(
      "At least one treasury or active Gnosis side-vault account is required to sync treasury transactions",
    );
  }

  const results = await Promise.allSettled(
    sources.map((account) =>
      syncAccountTransfers({ account, limit: pageLimit, maxPages: pageCount }),
    ),
  );
  const accounts: TreasuryTransactionAccountSyncResult[] = [];
  const errors: TreasuryTransactionAccountSyncError[] = [];

  results.forEach((result, index) => {
    const source = sources[index];

    if (result.status === "fulfilled") {
      accounts.push(result.value);
      return;
    }

    errors.push({
      accountAddress: source.address,
      accountName: source.name,
      error:
        result.reason instanceof Error
          ? result.reason.message
          : "Treasury account sync failed",
      source: source.source,
    });
  });

  return {
    accounts,
    errors,
    importedTransfers: accounts.reduce(
      (total, account) => total + account.importedTransfers,
      0,
    ),
    importedTransactions: accounts.reduce(
      (total, account) => total + account.importedTransactions,
      0,
    ),
    scannedTransfers: accounts.reduce(
      (total, account) => total + account.scannedTransfers,
      0,
    ),
    syncedAt: new Date().toISOString(),
  };
}

export async function getRecentTreasuryTransactionTransfers(limit = 25) {
  return getDb()
    .select()
    .from(treasuryTransactionTransfers)
    .orderBy(sql`${treasuryTransactionTransfers.executedAt} desc`)
    .limit(limit);
}
