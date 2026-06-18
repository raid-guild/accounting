import "server-only";

import {
  and,
  asc,
  eq,
  isNotNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  type Address,
  type Chain,
} from "viem";
import { base, gnosis, mainnet } from "viem/chains";

import { getDb } from "@/db";
import { quarterBalanceSnapshots } from "@/db/schema";
import type { QuarterSummary } from "@/lib/quarters";
import { getQuarterEndsAtExclusive } from "@/lib/quarter-sync";
import { listActiveBalanceAccounts } from "@/lib/treasury/accounts";
import {
  GNOSIS_TREASURY_ASSETS,
  OPERATOR_ERC20_ASSETS_BY_CHAIN,
  type TrackedTreasuryAsset,
} from "@/lib/treasury/assets";
import { getHistoricalUsdPricing } from "@/lib/treasury/pricing";

type QuarterBalanceBoundary = "opening" | "closing";
const BALANCE_RPC_RETRY_DELAYS_MS = [500, 1500, 3500] as const;
const ALCHEMY_NETWORK_BY_CHAIN_ID = new Map<number, string>([
  [mainnet.id, "eth-mainnet"],
  [base.id, "base-mainnet"],
]);

type QuarterBalanceQuarter = Pick<QuarterSummary, "id"> & {
  endsOn: string | Date;
  startsOn: string | Date;
};

export type QuarterBalanceRow = {
  accountAddress: string;
  accountName: string;
  balance: string;
  blockNumber: number;
  blockTimestamp: string;
  boundary: QuarterBalanceBoundary;
  chainId: number;
  decimals: number;
  priceSource: string;
  rawAmount: string;
  symbol: string;
  tokenName: string;
  treasuryAccountId: string | null;
  usdPrice: string;
  usdValue: string;
};

export type QuarterAccountBalanceSummary = {
  accountAddress: string;
  accountName: string;
  chainId: number;
  closingUsd: number;
  netChangeUsd: number;
  openingUsd: number;
  treasuryAccountId: string | null;
};

type BalanceAccount = {
  address: Address;
  chainId: number;
  name: string;
  treasuryAccountId: string | null;
};

function getMainSafeAddress() {
  const address = process.env.MAIN_SAFE_ADDRESS;

  if (!address || !isAddress(address, { strict: false })) {
    return null;
  }

  return getAddress(address);
}

function getGnosisRpcUrl() {
  const rpcUrl = process.env.GNOSIS_RPC_URL;

  if (!rpcUrl) {
    throw new Error("GNOSIS_RPC_URL is required to sync quarter balances");
  }

  return rpcUrl;
}

function getRpcUrl(chainId: number) {
  if (chainId === gnosis.id) {
    return getGnosisRpcUrl();
  }

  const alchemyNetwork = ALCHEMY_NETWORK_BY_CHAIN_ID.get(chainId);

  if (alchemyNetwork) {
    const apiKey = process.env.ALCHEMY_API_KEY;

    if (!apiKey) {
      throw new Error(`ALCHEMY_API_KEY is required for chain ${chainId}`);
    }

    return `https://${alchemyNetwork}.g.alchemy.com/v2/${apiKey}`;
  }

  throw new Error(`RPC URL is required for chain ${chainId}`);
}

function getChain(chainId: number): Chain {
  if (chainId === gnosis.id) {
    return gnosis;
  }

  if (chainId === mainnet.id) {
    return mainnet;
  }

  if (chainId === base.id) {
    return base;
  }

  throw new Error(`Unsupported quarter balance chain ${chainId}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("429") ||
    message.toLowerCase().includes("too many requests")
  );
}

async function withRateLimitRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt <= BALANCE_RPC_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (
        !isRateLimitError(error) ||
        attempt === BALANCE_RPC_RETRY_DELAYS_MS.length
      ) {
        break;
      }

      await sleep(BALANCE_RPC_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError;
}

function getPublicClient(chainId: number) {
  return createPublicClient({
    chain: getChain(chainId),
    transport: http(getRpcUrl(chainId)),
  });
}

type BalanceClient = ReturnType<typeof getPublicClient>;

async function listQuarterBalanceAccounts(): Promise<BalanceAccount[]> {
  const treasuryAddress = getMainSafeAddress();

  if (!treasuryAddress) {
    throw new Error("MAIN_SAFE_ADDRESS is required to sync quarter balances");
  }

  const accounts: BalanceAccount[] = [
    {
      address: treasuryAddress,
      chainId: gnosis.id,
      name: "Treasury",
      treasuryAccountId: null,
    },
  ];
  const seen = new Set([`${gnosis.id}:${treasuryAddress.toLowerCase()}`]);

  for (const account of await listActiveBalanceAccounts()) {
    const key = `${account.chainId}:${account.address.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    accounts.push({
      address: account.address,
      chainId: account.chainId,
      name: account.name,
      treasuryAccountId: account.id,
    });
  }

  return accounts;
}

async function findBlockAtOrAfterTimestamp({
  client,
  timestamp,
}: {
  client: BalanceClient;
  timestamp: bigint;
}) {
  const latestBlock = await client.getBlock();

  if (timestamp > latestBlock.timestamp) {
    throw new Error("Quarter balance boundary is after the latest block");
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

function toDateOnly(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

async function getBoundaryBlocks({
  chainId,
  quarter,
}: {
  chainId: number;
  quarter: Pick<QuarterBalanceQuarter, "endsOn" | "startsOn">;
}) {
  const client = getPublicClient(chainId);
  const startsOn = toDateOnly(quarter.startsOn);
  const endsOn = toDateOnly(quarter.endsOn);
  const openingBlock = await findBlockAtOrAfterTimestamp({
    client,
    timestamp: BigInt(
      Math.floor(new Date(`${startsOn}T00:00:00.000Z`).getTime() / 1000),
    ),
  });
  const closingBoundaryBlock = await findBlockAtOrAfterTimestamp({
    client,
    timestamp: BigInt(
      Math.floor(getQuarterEndsAtExclusive({ endsOn }).getTime() / 1000),
    ),
  });
  const closingBlock =
    closingBoundaryBlock > BigInt(0)
      ? closingBoundaryBlock - BigInt(1)
      : BigInt(0);
  const opening = await client.getBlock({ blockNumber: openingBlock });
  const closing = await client.getBlock({ blockNumber: closingBlock });

  return {
    client,
    boundaries: [
      {
        blockNumber: openingBlock,
        blockTimestamp: new Date(Number(opening.timestamp) * 1000),
        boundary: "opening" as const,
      },
      {
        blockNumber: closingBlock,
        blockTimestamp: new Date(Number(closing.timestamp) * 1000),
        boundary: "closing" as const,
      },
    ],
  };
}

function getTrackedAssetsForAccount(account: Pick<BalanceAccount, "chainId">) {
  if (account.chainId === gnosis.id) {
    return [...GNOSIS_TREASURY_ASSETS];
  }

  return [...(OPERATOR_ERC20_ASSETS_BY_CHAIN[account.chainId] ?? [])];
}

function isContractUnavailableAtBlock(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes("contract does not exist") ||
    normalizedMessage.includes("no contract code") ||
    normalizedMessage.includes("returned no data") ||
    normalizedMessage.includes("could not decode result data")
  );
}

async function getRawBalance({
  account,
  asset,
  blockNumber,
  client,
}: {
  account: BalanceAccount;
  asset: TrackedTreasuryAsset;
  blockNumber: bigint;
  client: BalanceClient;
}) {
  if (!asset.tokenAddress) {
    return withRateLimitRetry(() =>
      client.getBalance({
        address: account.address,
        blockNumber,
      }),
    );
  }

  const tokenAddress = getAddress(asset.tokenAddress);

  try {
    return await withRateLimitRetry(() =>
      client.readContract({
        abi: erc20Abi,
        address: tokenAddress,
        args: [account.address],
        blockNumber,
        functionName: "balanceOf",
      }),
    );
  } catch (error) {
    if (isContractUnavailableAtBlock(error)) {
      return BigInt(0);
    }

    throw error;
  }
}

async function mapBalanceRow({
  account,
  asset,
  blockNumber,
  blockTimestamp,
  boundary,
  client,
  quarterId,
}: {
  account: BalanceAccount;
  asset: TrackedTreasuryAsset;
  blockNumber: bigint;
  blockTimestamp: Date;
  boundary: QuarterBalanceBoundary;
  client: BalanceClient;
  quarterId: string;
}): Promise<typeof quarterBalanceSnapshots.$inferInsert> {
  const rawAmount = await getRawBalance({
    account,
    asset,
    blockNumber,
    client,
  });
  const balance = formatUnits(rawAmount, asset.decimals);
  const pricing =
    rawAmount === BigInt(0)
      ? {
          priceSource: "zero_balance",
          priceUsd: "0.00000000",
          usdAmount: "0.00",
        }
      : await getHistoricalUsdPricing({
          amount: balance,
          assetSymbol: asset.symbol,
          executedAt: blockTimestamp,
        });

  return {
    accountAddress: account.address,
    balance,
    blockNumber: Number(blockNumber),
    blockTimestamp,
    boundary,
    chainId: account.chainId,
    decimals: asset.decimals,
    name: asset.name,
    priceSource: pricing.priceSource,
    quarterId,
    rawAmount: rawAmount.toString(),
    symbol: asset.symbol,
    treasuryAccountId: account.treasuryAccountId,
    usdPrice: pricing.priceUsd,
    usdValue: pricing.usdAmount,
  };
}

async function deleteStaleQuarterBalanceRows({
  accounts,
  quarterId,
}: {
  accounts: BalanceAccount[];
  quarterId: string;
}) {
  const accountIds = accounts.flatMap((account) =>
    account.treasuryAccountId ? [account.treasuryAccountId] : [],
  );
  const db = getDb();

  for (const account of accounts) {
    if (!account.treasuryAccountId) {
      continue;
    }

    const symbols = getTrackedAssetsForAccount(account).map(
      (asset) => asset.symbol,
    );

    await db
      .delete(quarterBalanceSnapshots)
      .where(
        and(
          eq(quarterBalanceSnapshots.quarterId, quarterId),
          eq(
            quarterBalanceSnapshots.treasuryAccountId,
            account.treasuryAccountId,
          ),
          or(
            ne(quarterBalanceSnapshots.chainId, account.chainId),
            ne(quarterBalanceSnapshots.accountAddress, account.address),
            symbols.length > 0
              ? notInArray(quarterBalanceSnapshots.symbol, symbols)
              : undefined,
          ),
        ),
      );
  }

  if (accountIds.length === 0) {
    return;
  }

  await db
    .delete(quarterBalanceSnapshots)
    .where(
      and(
        eq(quarterBalanceSnapshots.quarterId, quarterId),
        isNotNull(quarterBalanceSnapshots.treasuryAccountId),
        notInArray(quarterBalanceSnapshots.treasuryAccountId, accountIds),
      ),
    );
}

export async function syncQuarterBalances(quarter: QuarterBalanceQuarter) {
  const accounts = await listQuarterBalanceAccounts();
  const boundaryCache = new Map<
    number,
    Awaited<ReturnType<typeof getBoundaryBlocks>>
  >();
  const rows: (typeof quarterBalanceSnapshots.$inferInsert)[] = [];

  for (const account of accounts) {
    const chainBoundary =
      boundaryCache.get(account.chainId) ??
      (await getBoundaryBlocks({ chainId: account.chainId, quarter }));
    boundaryCache.set(account.chainId, chainBoundary);

    for (const boundary of chainBoundary.boundaries) {
      for (const asset of getTrackedAssetsForAccount(account)) {
        rows.push(
          await mapBalanceRow({
            account,
            asset,
            blockNumber: boundary.blockNumber,
            blockTimestamp: boundary.blockTimestamp,
            boundary: boundary.boundary,
            client: chainBoundary.client,
            quarterId: quarter.id,
          }),
        );
      }
    }
  }

  if (rows.length === 0) {
    return { syncedBalances: 0 };
  }

  await getDb()
    .insert(quarterBalanceSnapshots)
    .values(rows)
    .onConflictDoUpdate({
      set: {
        balance: sql`excluded.balance`,
        blockNumber: sql`excluded.block_number`,
        blockTimestamp: sql`excluded.block_timestamp`,
        decimals: sql`excluded.decimals`,
        name: sql`excluded.name`,
        priceSource: sql`excluded.price_source`,
        rawAmount: sql`excluded.raw_amount`,
        usdPrice: sql`excluded.usd_price`,
        usdValue: sql`excluded.usd_value`,
        updatedAt: sql`now()`,
      },
      target: [
        quarterBalanceSnapshots.quarterId,
        quarterBalanceSnapshots.boundary,
        quarterBalanceSnapshots.chainId,
        quarterBalanceSnapshots.accountAddress,
        quarterBalanceSnapshots.symbol,
      ],
    });

  await deleteStaleQuarterBalanceRows({ accounts, quarterId: quarter.id });

  return { syncedBalances: rows.length };
}

function toNumber(value: string) {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function mapAccountLabel(row: typeof quarterBalanceSnapshots.$inferSelect) {
  if (!row.treasuryAccountId) {
    return "Treasury";
  }

  return null;
}

export async function listQuarterBalanceRows(
  quarterId: string,
): Promise<QuarterBalanceRow[]> {
  const rows = await getDb()
    .select()
    .from(quarterBalanceSnapshots)
    .where(eq(quarterBalanceSnapshots.quarterId, quarterId))
    .orderBy(
      asc(quarterBalanceSnapshots.boundary),
      asc(quarterBalanceSnapshots.accountAddress),
      asc(quarterBalanceSnapshots.symbol),
    );
  const accounts = await listActiveBalanceAccounts();
  const namesById = new Map(accounts.map((account) => [account.id, account.name]));

  return rows.map((row) => ({
    accountAddress: row.accountAddress,
    accountName:
      mapAccountLabel(row) ?? namesById.get(row.treasuryAccountId ?? "") ?? "Account",
    balance: row.balance,
    blockNumber: row.blockNumber,
    blockTimestamp: row.blockTimestamp.toISOString(),
    boundary: row.boundary,
    chainId: row.chainId,
    decimals: row.decimals,
    priceSource: row.priceSource,
    rawAmount: row.rawAmount,
    symbol: row.symbol,
    tokenName: row.name,
    treasuryAccountId: row.treasuryAccountId,
    usdPrice: row.usdPrice,
    usdValue: row.usdValue,
  }));
}

export async function listQuarterAccountBalanceSummaries(
  quarterId: string,
): Promise<QuarterAccountBalanceSummary[]> {
  const rows = await listQuarterBalanceRows(quarterId);
  const summaries = new Map<string, QuarterAccountBalanceSummary>();

  for (const row of rows) {
    const key = `${row.chainId}:${row.accountAddress.toLowerCase()}`;
    const summary =
      summaries.get(key) ??
      ({
        accountAddress: row.accountAddress,
        accountName: row.accountName,
        chainId: row.chainId,
        closingUsd: 0,
        netChangeUsd: 0,
        openingUsd: 0,
        treasuryAccountId: row.treasuryAccountId,
      } satisfies QuarterAccountBalanceSummary);

    if (row.boundary === "opening") {
      summary.openingUsd += toNumber(row.usdValue);
    } else {
      summary.closingUsd += toNumber(row.usdValue);
    }

    summary.netChangeUsd = summary.closingUsd - summary.openingUsd;
    summaries.set(key, summary);
  }

  return Array.from(summaries.values()).sort((left, right) => {
    const balanceDifference = right.closingUsd - left.closingUsd;

    return balanceDifference || left.accountName.localeCompare(right.accountName);
  });
}
