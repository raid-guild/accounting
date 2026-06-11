import "server-only";

import { and, eq, sql } from "drizzle-orm";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  type Address,
  type Chain,
} from "viem";
import { base, gnosis, mainnet } from "viem/chains";

import { getDb } from "@/db";
import {
  treasuryTransactionTransfers,
  treasuryTransactions,
} from "@/db/schema";
import {
  listActiveGnosisSideVaultAccounts,
  listActiveOperatorAccounts,
} from "@/lib/treasury/accounts";
import {
  OPERATOR_ERC20_ASSETS_BY_CHAIN,
  type TrackedTreasuryAsset,
} from "@/lib/treasury/assets";

const DEFAULT_SAFE_TRANSACTION_SERVICE_URL =
  "https://safe-transaction-gnosis-chain.safe.global/api/v1";
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_OPERATOR_LOG_BLOCK_CHUNK_SIZE = BigInt(50000);
const ALCHEMY_NETWORK_BY_CHAIN_ID = new Map<number, string>([
  [mainnet.id, "eth-mainnet"],
  [base.id, "base-mainnet"],
]);
const STABLE_ASSET_SYMBOLS = new Set(["USDC", "XDAI", "WXDAI"]);
const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

type TreasuryTransactionSource = {
  id: string;
  name: string;
  address: Address;
  chainId: number;
  source: "main_safe" | "side_vault" | "operator";
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

type SyncPeriod = {
  endsAtExclusive: Date;
  startsAt: Date;
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
  rawMetadata: Record<string, unknown>;
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
  source: "main_safe" | "side_vault" | "operator";
};

export type TreasuryTransactionAccountSyncError = {
  accountAddress: Address;
  accountName: string;
  error: string;
  source: "main_safe" | "side_vault" | "operator";
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
    process.env.SAFE_TRANSACTION_SERVICE_URL?.trim() ||
    DEFAULT_SAFE_TRANSACTION_SERVICE_URL
  ).replace(/\/$/, "");
}

function getRpcUrl(chainId: number) {
  if (chainId === gnosis.id) {
    return process.env.GNOSIS_RPC_URL;
  }

  const alchemyNetwork = ALCHEMY_NETWORK_BY_CHAIN_ID.get(chainId);

  if (alchemyNetwork && process.env.ALCHEMY_API_KEY) {
    return `https://${alchemyNetwork}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  }

  return null;
}

function getChain(chainId: number): Chain | null {
  if (chainId === gnosis.id) {
    return gnosis;
  }

  if (chainId === mainnet.id) {
    return mainnet;
  }

  if (chainId === base.id) {
    return base;
  }

  return null;
}

function getPublicClient(chainId: number) {
  const chain = getChain(chainId);
  const rpcUrl = getRpcUrl(chainId);

  if (!chain || !rpcUrl) {
    throw new Error(`RPC URL is required for operator chain ${chainId}`);
  }

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

function getPositiveInteger(value: number | undefined, fallback: number) {
  if (!value || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function getPositiveBigInt(value: string | undefined, fallback: bigint) {
  if (!value || !/^\d+$/.test(value)) {
    return fallback;
  }

  const parsed = BigInt(value);

  return parsed > BigInt(0) ? parsed : fallback;
}

function isWithinPeriod(transfer: NormalizedTransfer, period?: SyncPeriod) {
  if (!period) {
    return true;
  }

  return (
    transfer.executedAt >= period.startsAt &&
    transfer.executedAt < period.endsAtExclusive
  );
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

function isStableAssetSymbol(symbol: string | null | undefined) {
  return Boolean(symbol && STABLE_ASSET_SYMBOLS.has(symbol.toUpperCase()));
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
    usdPrice: isStableAssetSymbol(tokenInfo?.symbol) ? "1.00000000" : null,
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
  period,
}: {
  account: TreasuryTransactionSource;
  limit: number;
  offset: number;
  period?: SyncPeriod;
}) {
  const url = new URL(
    `${getSafeTransactionServiceUrl()}/safes/${account.address}/transfers/`,
  );
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (period) {
    url.searchParams.set("execution_date__gte", period.startsAt.toISOString());
    url.searchParams.set(
      "execution_date__lt",
      period.endsAtExclusive.toISOString(),
    );
  }

  return url;
}

async function fetchSafeTransfersPage({
  account,
  limit,
  offset,
  period,
}: {
  account: TreasuryTransactionSource;
  limit: number;
  offset: number;
  period?: SyncPeriod;
}) {
  const response = await fetch(
    getTransfersUrl({ account, limit, offset, period }),
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Safe Transaction Service failed: ${response.status}`);
  }

  return (await response.json()) as SafeTransfersResponse;
}

async function listTransactionSources(): Promise<TreasuryTransactionSource[]> {
  const mainSafeAddress = getMainSafeAddress();
  const [sideVaults, operators] = await Promise.all([
    listActiveGnosisSideVaultAccounts(),
    listActiveOperatorAccounts(),
  ]);
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

  for (const operator of operators) {
    const key = `${operator.chainId}:${operator.address.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    sources.push({
      id: operator.id,
      name: operator.name,
      address: operator.address,
      chainId: operator.chainId,
      source: "operator",
      treasuryAccountId: operator.id,
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
      transactionType:
        account.source === "operator"
          ? "operator_erc20_transfer"
          : "safe_transfer",
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

async function findBlockAtOrAfterTimestamp({
  client,
  timestamp,
}: {
  client: ReturnType<typeof getPublicClient>;
  timestamp: bigint;
}) {
  const latestBlock = await client.getBlock();

  if (latestBlock.timestamp === undefined) {
    throw new Error(
      `Latest block timestamp is unavailable for chain ${client.chain.id}`,
    );
  }

  if (timestamp > latestBlock.timestamp) {
    throw new Error(
      `Target timestamp ${timestamp} is after the latest block timestamp ${latestBlock.timestamp}`,
    );
  }

  let low = BigInt(0);
  let high = latestBlock.number ?? BigInt(0);

  while (low < high) {
    const mid = (low + high) / BigInt(2);
    const block = await client.getBlock({ blockNumber: mid });

    if (block.timestamp < timestamp) {
      low = mid + BigInt(1);
    } else {
      high = mid;
    }
  }

  return low;
}

async function getOperatorBlockRange({
  account,
  period,
}: {
  account: TreasuryTransactionSource;
  period?: SyncPeriod;
}) {
  const client = getPublicClient(account.chainId);

  if (period) {
    const fromBlock = await findBlockAtOrAfterTimestamp({
      client,
      timestamp: BigInt(Math.floor(period.startsAt.getTime() / 1000)),
    });
    const endBlock = await findBlockAtOrAfterTimestamp({
      client,
      timestamp: BigInt(Math.floor(period.endsAtExclusive.getTime() / 1000)),
    });

    return {
      client,
      fromBlock,
      toBlock: endBlock > BigInt(0) ? endBlock - BigInt(1) : BigInt(0),
    };
  }

  const latestBlock = await client.getBlock();
  const lookback = getPositiveBigInt(
    process.env.OPERATOR_TRANSFER_LOG_BLOCK_LOOKBACK,
    BigInt(50000),
  );
  const latestBlockNumber = latestBlock.number ?? BigInt(0);

  return {
    client,
    fromBlock:
      latestBlockNumber > lookback ? latestBlockNumber - lookback : BigInt(0),
    toBlock: latestBlockNumber,
  };
}

function getOperatorAssets(chainId: number): TrackedTreasuryAsset[] {
  return [...(OPERATOR_ERC20_ASSETS_BY_CHAIN[chainId] ?? [])];
}

function getOperatorUsdPrice(asset: TrackedTreasuryAsset) {
  return asset.stableUsd ? "1.00000000" : null;
}

async function getBlockTimestamp({
  blockNumber,
  cache,
  client,
}: {
  blockNumber: bigint;
  cache: Map<bigint, Date>;
  client: ReturnType<typeof getPublicClient>;
}) {
  const cached = cache.get(blockNumber);

  if (cached) {
    return cached;
  }

  const block = await client.getBlock({ blockNumber });
  const executedAt = new Date(Number(block.timestamp) * 1000);
  cache.set(blockNumber, executedAt);

  return executedAt;
}

async function fetchOperatorTokenLogs({
  account,
  asset,
  fromBlock,
  toBlock,
}: {
  account: TreasuryTransactionSource;
  asset: TrackedTreasuryAsset;
  fromBlock: bigint;
  toBlock: bigint;
}) {
  if (!asset.tokenAddress) {
    return [];
  }

  const client = getPublicClient(account.chainId);
  const chunkSize = getPositiveBigInt(
    process.env.OPERATOR_TRANSFER_LOG_BLOCK_CHUNK_SIZE,
    DEFAULT_OPERATOR_LOG_BLOCK_CHUNK_SIZE,
  );
  const logs = [];

  for (let chunkStart = fromBlock; chunkStart <= toBlock; chunkStart += chunkSize) {
    const chunkEnd =
      chunkStart + chunkSize - BigInt(1) > toBlock
        ? toBlock
        : chunkStart + chunkSize - BigInt(1);
    const [incoming, outgoing] = await Promise.all([
      client.getLogs({
        address: asset.tokenAddress,
        args: { to: account.address },
        event: ERC20_TRANSFER_EVENT,
        fromBlock: chunkStart,
        toBlock: chunkEnd,
      }),
      client.getLogs({
        address: asset.tokenAddress,
        args: { from: account.address },
        event: ERC20_TRANSFER_EVENT,
        fromBlock: chunkStart,
        toBlock: chunkEnd,
      }),
    ]);

    logs.push(...incoming, ...outgoing);
  }

  return logs;
}

async function syncOperatorTransfers({
  account,
  period,
}: {
  account: TreasuryTransactionSource;
  period?: SyncPeriod;
}): Promise<TreasuryTransactionAccountSyncResult> {
  const assets = getOperatorAssets(account.chainId);

  if (assets.length === 0) {
    throw new Error(`No tracked operator assets configured for chain ${account.chainId}`);
  }

  const { client, fromBlock, toBlock } = await getOperatorBlockRange({
    account,
    period,
  });

  if (toBlock < fromBlock) {
    return {
      accountAddress: account.address,
      accountName: account.name,
      importedTransfers: 0,
      importedTransactions: 0,
      scannedTransfers: 0,
      source: account.source,
    };
  }

  const blockTimestampCache = new Map<bigint, Date>();
  const seenLogs = new Set<string>();
  let importedTransfers = 0;
  let importedTransactions = 0;
  let scannedTransfers = 0;

  for (const asset of assets) {
    const logs = await fetchOperatorTokenLogs({
      account,
      asset,
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      const txHash = normalizeHash(log.transactionHash);
      const fromAddress = normalizeAddress(log.args.from);
      const toAddress = normalizeAddress(log.args.to);
      const blockNumber = log.blockNumber;
      const logIndex = log.logIndex;
      const value = log.args.value;

      if (
        !txHash ||
        !fromAddress ||
        !toAddress ||
        blockNumber === null ||
        logIndex === null ||
        value === undefined
      ) {
        continue;
      }

      const logKey = `${account.chainId}:${txHash}:${logIndex}:${asset.tokenAddress}`;

      if (seenLogs.has(logKey)) {
        continue;
      }

      seenLogs.add(logKey);

      const rawAmount = value.toString();
      const amount = formatUnits(value, asset.decimals);
      const usdPrice = getOperatorUsdPrice(asset);
      const transfer: NormalizedTransfer = {
        amount,
        assetName: asset.name,
        assetSymbol: asset.symbol,
        blockNumber: Number(blockNumber),
        decimals: asset.decimals,
        direction: getDirection({
          accountAddress: account.address,
          fromAddress,
          toAddress,
        }),
        executedAt: await getBlockTimestamp({
          blockNumber,
          cache: blockTimestampCache,
          client,
        }),
        fromAddress,
        rawAmount,
        rawMetadata: {
          blockHash: log.blockHash,
          blockNumber: blockNumber.toString(),
          logIndex,
          source: "operator_rpc",
        },
        safeTransactionHash: null,
        toAddress,
        tokenAddress: asset.tokenAddress,
        transferId: `rpc:${account.chainId}:${txHash}:${logIndex}:${asset.tokenAddress}`,
        transferType: "ERC20_TRANSFER",
        txHash,
        usdAmount: getUsdAmount({ amount, usdPrice }),
        usdPrice,
      };

      if (!isWithinPeriod(transfer, period)) {
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

async function syncAccountTransfers({
  account,
  limit,
  maxPages,
  period,
}: {
  account: TreasuryTransactionSource;
  limit: number;
  maxPages: number;
  period?: SyncPeriod;
}): Promise<TreasuryTransactionAccountSyncResult> {
  if (account.source === "operator") {
    return syncOperatorTransfers({ account, period });
  }

  let importedTransfers = 0;
  let importedTransactions = 0;
  let scannedTransfers = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * limit;
    const body = await fetchSafeTransfersPage({
      account,
      limit,
      offset,
      period,
    });
    const transfers = body.results ?? [];

    if (transfers.length === 0) {
      break;
    }

    for (const rawTransfer of transfers) {
      const transfer = normalizeTransfer({ account, transfer: rawTransfer });

      if (!transfer) {
        continue;
      }

      if (!isWithinPeriod(transfer, period)) {
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
  endsAtExclusive,
  limit,
  maxPages,
  startsAt,
}: {
  endsAtExclusive?: Date;
  limit?: number;
  maxPages?: number;
  startsAt?: Date;
} = {}): Promise<TreasuryTransactionSyncResult> {
  const sources = await listTransactionSources();
  const pageLimit = getPositiveInteger(limit, DEFAULT_PAGE_LIMIT);
  const pageCount = getPositiveInteger(maxPages, DEFAULT_MAX_PAGES);
  const period =
    startsAt && endsAtExclusive
      ? {
          endsAtExclusive,
          startsAt,
        }
      : undefined;

  if (sources.length === 0) {
    throw new Error(
      "At least one treasury, active Gnosis side-vault, or operator account is required to sync treasury transactions",
    );
  }

  const results = await Promise.allSettled(
    sources.map((account) =>
      syncAccountTransfers({
        account,
        limit: pageLimit,
        maxPages: pageCount,
        period,
      }),
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
