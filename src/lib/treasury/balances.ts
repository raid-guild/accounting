import "server-only";

import { and, desc, eq } from "drizzle-orm";
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
import {
  treasuryBalanceAssets,
  treasuryBalanceSnapshots,
} from "@/db/schema";
import {
  listActiveBalanceAccounts,
  type TreasuryBalanceAccountSource,
} from "@/lib/treasury/accounts";
import {
  GNOSIS_TREASURY_ASSETS,
  OPERATOR_ERC20_ASSETS_BY_CHAIN,
  type TrackedTreasuryAsset,
} from "@/lib/treasury/assets";
import type {
  TreasuryAccountBalance,
  TreasuryAssetBalance,
  TreasuryAssetSymbol,
  TreasuryBalanceSnapshot,
  TreasurySnapshotStatus,
} from "@/lib/treasury/types";

const SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const MULTI_ACCOUNT_SYNC_KEY = "treasury-accounts";
const ALCHEMY_NETWORK_BY_CHAIN_ID = new Map<number, string>([
  [mainnet.id, "eth-mainnet"],
  [base.id, "base-mainnet"],
]);

const inProgressSyncs = new Map<string, Promise<TreasuryBalanceSnapshot>>();

const ALL_TRACKED_TREASURY_ASSETS = [
  ...new Map(
    [
      ...GNOSIS_TREASURY_ASSETS,
      ...Object.values(OPERATOR_ERC20_ASSETS_BY_CHAIN).flat(),
    ].map((asset) => [asset.symbol, asset]),
  ).values(),
];

type BalanceAccountSource = {
  id: string;
  name: string;
  address: Address | null;
  chainId: number;
};

type CachedAccountSnapshot = {
  account: TreasuryAccountBalance;
  errorMessage: string | null;
  isStale: boolean;
  status: TreasurySnapshotStatus;
  syncedAt: Date | null;
};

type SyncedAccountSnapshot = {
  account: TreasuryAccountBalance;
  errorMessage: string | null;
  status: TreasurySnapshotStatus;
  syncedAt: Date;
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
    throw new Error("GNOSIS_RPC_URL is required to sync treasury balances");
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

  throw new Error(`Unsupported balance chain ${chainId}`);
}

function getPublicClient(chainId: number) {
  return createPublicClient({
    chain: getChain(chainId),
    transport: http(getRpcUrl(chainId)),
  });
}

function getTreasuryAccountSource(): BalanceAccountSource {
  return {
    id: "treasury",
    name: "Treasury",
    address: getMainSafeAddress(),
    chainId: gnosis.id,
  };
}

async function getTrackedAccountSources(): Promise<
  [BalanceAccountSource, ...BalanceAccountSource[]]
> {
  const treasury = getTreasuryAccountSource();
  const extraAccounts = await listActiveBalanceAccounts();
  const seenAccounts = new Set<string>();

  if (treasury.address) {
    seenAccounts.add(`${treasury.chainId}:${treasury.address.toLowerCase()}`);
  }

  return [
    treasury,
    ...extraAccounts
      .filter((account) => {
        const accountKey = `${account.chainId}:${account.address.toLowerCase()}`;

        if (seenAccounts.has(accountKey)) {
          return false;
        }

        seenAccounts.add(accountKey);
        return true;
      })
      .map((account: TreasuryBalanceAccountSource) => ({
        id: account.id,
        name: account.name,
        address: account.address,
        chainId: account.chainId,
      })),
  ];
}

function createEmptyAssetBalance(
  asset: TrackedTreasuryAsset,
): TreasuryAssetBalance {
  return {
    symbol: asset.symbol,
    name: asset.name,
    rawAmount: "0",
    balance: "0.00",
    usdValue: "0.00",
    usdPrice: asset.stableUsd ? "1.00000000" : "0.00000000",
    decimals: asset.decimals,
  };
}

function getTrackedAssetsForAccount(account: Pick<BalanceAccountSource, "chainId">) {
  if (account.chainId === gnosis.id) {
    return [...GNOSIS_TREASURY_ASSETS];
  }

  return [...(OPERATOR_ERC20_ASSETS_BY_CHAIN[account.chainId] ?? [])];
}

function createEmptyAccountBalance(
  account: BalanceAccountSource,
): TreasuryAccountBalance {
  const trackedAssets = getTrackedAssetsForAccount(account);

  return {
    id: account.id,
    name: account.name,
    address: account.address,
    chainId: account.chainId,
    totalUsd: "0.00",
    assets: trackedAssets.map(createEmptyAssetBalance),
  };
}

function createSnapshot({
  accounts,
  errorMessage = null,
  isStale,
  status,
  syncedAt,
}: {
  accounts: [TreasuryAccountBalance, ...TreasuryAccountBalance[]];
  errorMessage?: string | null;
  isStale: boolean;
  status: TreasurySnapshotStatus;
  syncedAt: string | null;
}): TreasuryBalanceSnapshot {
  const sortedAccounts = [...accounts].sort((left, right) => {
    const totalDifference = toNumber(right.totalUsd) - toNumber(left.totalUsd);

    return totalDifference || left.name.localeCompare(right.name);
  }) as [TreasuryAccountBalance, ...TreasuryAccountBalance[]];
  const assets = aggregateAssets(sortedAccounts.map((account) => account.assets));
  const totalUsd = formatUsd(
    sortedAccounts.reduce(
      (total, account) => total + toNumber(account.totalUsd),
      0,
    ),
  );

  return {
    accounts: sortedAccounts,
    assets,
    asOf: new Date().toISOString(),
    syncedAt,
    isStale,
    errorMessage,
    status,
    totalUsd,
  };
}

function createPendingSnapshot(
  accountSource = getTreasuryAccountSource(),
  errorMessage: string | null = null,
): TreasuryBalanceSnapshot {
  return createSnapshot({
    accounts: [createEmptyAccountBalance(accountSource)],
    errorMessage,
    isStale: true,
    status: errorMessage ? "failed" : "pending_live_sync",
    syncedAt: null,
  });
}

export function createFailedTreasuryBalanceSnapshot(errorMessage: string) {
  return createPendingSnapshot(getTreasuryAccountSource(), errorMessage);
}

function isSyncedAtStale(syncedAt: Date) {
  return Date.now() - syncedAt.getTime() >= SNAPSHOT_TTL_MS;
}

function formatUsd(value: number) {
  return value.toFixed(2);
}

function formatPrice(value: number) {
  return value.toFixed(8);
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortAssetsByUsdValue(assets: TreasuryAssetBalance[]) {
  return [...assets].sort((assetA, assetB) => {
    const usdDifference = toNumber(assetB.usdValue) - toNumber(assetA.usdValue);

    if (usdDifference !== 0) {
      return usdDifference;
    }

    return assetA.symbol.localeCompare(assetB.symbol);
  });
}

function getOldestSyncedAt(syncedAts: Date[]) {
  if (syncedAts.length === 0) {
    return null;
  }

  return new Date(
    Math.min(...syncedAts.map((syncedAt) => syncedAt.getTime())),
  ).toISOString();
}

function getAggregateStatus(
  accountSnapshots: Array<CachedAccountSnapshot | SyncedAccountSnapshot>,
): TreasurySnapshotStatus {
  if (accountSnapshots.some((snapshot) => snapshot.status === "failed")) {
    return "failed";
  }

  if (accountSnapshots.some((snapshot) => snapshot.status === "partial")) {
    return "partial";
  }

  if (
    accountSnapshots.some(
      (snapshot) => "isStale" in snapshot && snapshot.isStale,
    )
  ) {
    return "stale_syncing";
  }

  return "synced";
}

function aggregateAssets(
  accountAssets: TreasuryAssetBalance[][],
): TreasuryAssetBalance[] {
  const aggregatedAssets = ALL_TRACKED_TREASURY_ASSETS.map((asset) => {
    const matchingAssets = accountAssets
      .flat()
      .filter((accountAsset) => accountAsset.symbol === asset.symbol);
    const rawTotal = matchingAssets.reduce(
      (total, matchingAsset) => total + BigInt(matchingAsset.rawAmount),
      BigInt(0),
    );
    const balance = formatUnits(rawTotal, asset.decimals);
    const usdValue = matchingAssets.reduce(
      (total, matchingAsset) => total + toNumber(matchingAsset.usdValue),
      0,
    );
    const usdPrice =
      asset.stableUsd || toNumber(balance) === 0
        ? matchingAssets.find((matchingAsset) => toNumber(matchingAsset.usdPrice))
            ?.usdPrice
        : formatPrice(usdValue / toNumber(balance));

    return {
      symbol: asset.symbol,
      name: asset.name,
      rawAmount: rawTotal.toString(),
      balance,
      usdValue: formatUsd(usdValue),
      usdPrice: usdPrice ?? (asset.stableUsd ? "1.00000000" : "0.00000000"),
      decimals: asset.decimals,
    } satisfies TreasuryAssetBalance;
  });

  return sortAssetsByUsdValue(aggregatedAssets);
}

function mapCachedAsset(asset: typeof treasuryBalanceAssets.$inferSelect) {
  return {
    symbol: asset.symbol as TreasuryAssetSymbol,
    name: asset.name,
    rawAmount: asset.rawAmount,
    balance: asset.balance,
    usdValue: asset.usdValue,
    usdPrice: asset.usdPrice,
    decimals: asset.decimals,
  } satisfies TreasuryAssetBalance;
}

async function getLatestCachedAccountSnapshot(
  account: BalanceAccountSource,
): Promise<CachedAccountSnapshot> {
  if (!account.address) {
    return {
      account: createEmptyAccountBalance(account),
      errorMessage: "MAIN_SAFE_ADDRESS is not configured",
      isStale: true,
      status: "failed",
      syncedAt: null,
    };
  }

  const db = getDb();
  const [snapshot] = await db
    .select()
    .from(treasuryBalanceSnapshots)
    .where(
      and(
        eq(treasuryBalanceSnapshots.accountAddress, account.address),
        eq(treasuryBalanceSnapshots.chainId, account.chainId),
      ),
    )
    .orderBy(desc(treasuryBalanceSnapshots.syncedAt))
    .limit(1);

  if (!snapshot) {
    return {
      account: createEmptyAccountBalance(account),
      errorMessage: null,
      isStale: true,
      status: "pending_live_sync",
      syncedAt: null,
    };
  }

  const assets = await db
    .select()
    .from(treasuryBalanceAssets)
    .where(eq(treasuryBalanceAssets.snapshotId, snapshot.id));
  const assetMap = new Map(
    assets.map((asset) => [asset.symbol, mapCachedAsset(asset)]),
  );
  const orderedAssets = getTrackedAssetsForAccount(account).map(
    (asset) => assetMap.get(asset.symbol) ?? createEmptyAssetBalance(asset),
  );
  const isFailed = snapshot.status === "failed";
  const isStale = isFailed || isSyncedAtStale(snapshot.syncedAt);

  return {
    account: {
      id: account.id,
      name: account.name,
      address: account.address,
      chainId: account.chainId,
      totalUsd: snapshot.totalUsd,
      assets: sortAssetsByUsdValue(orderedAssets),
    },
    errorMessage: snapshot.errorMessage,
    isStale,
    status: isFailed ? "failed" : isStale ? "stale_syncing" : snapshot.status,
    syncedAt: snapshot.syncedAt,
  };
}

async function getCoinGeckoUsdPrices(coinIds: string[]) {
  const uniqueCoinIds = [...new Set(coinIds)].filter(Boolean);

  if (uniqueCoinIds.length === 0) {
    return new Map<string, number>();
  }

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", uniqueCoinIds.join(","));
  url.searchParams.set("vs_currencies", "usd");

  const headers = new Headers();

  if (process.env.COINGECKO_API_KEY) {
    headers.set("x-cg-demo-api-key", process.env.COINGECKO_API_KEY);
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers,
  });

  if (!response.ok) {
    throw new Error("CoinGecko price request failed");
  }

  const body = (await response.json()) as Record<string, { usd?: number }>;
  const prices = new Map<string, number>();

  for (const coinId of uniqueCoinIds) {
    const price = body[coinId]?.usd;

    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      prices.set(coinId, price);
    }
  }

  if (prices.size === 0) {
    throw new Error("CoinGecko prices invalid or unavailable");
  }

  return prices;
}

async function fetchLiveAssetBalances({
  address,
  client,
  trackedAssets,
  pricePromise,
}: {
  address: Address;
  client: ReturnType<typeof createPublicClient>;
  trackedAssets: TrackedTreasuryAsset[];
  pricePromise: Promise<Map<string, number>>;
}) {
  const rawBalances = await Promise.all(
    trackedAssets.map(async (asset) => {
      if (!asset.tokenAddress) {
        return client.getBalance({ address });
      }

      return client.readContract({
        abi: erc20Abi,
        address: getAddress(asset.tokenAddress),
        functionName: "balanceOf",
        args: [address],
      });
    }),
  );

  let prices = new Map<string, number>();
  let priceError: Error | null = null;

  try {
    prices = await pricePromise;
  } catch (error) {
    priceError = error instanceof Error ? error : new Error("Price unavailable");
  }

  const missingPriceIds = trackedAssets.flatMap((asset) =>
    asset.stableUsd || !asset.coingeckoId || prices.has(asset.coingeckoId)
      ? []
      : [asset.coingeckoId],
  );

  if (!priceError && missingPriceIds.length > 0) {
    priceError = new Error(
      `Missing CoinGecko prices for ${[...new Set(missingPriceIds)].join(", ")}`,
    );
  }

  const assets = trackedAssets.map((asset, index) => {
    const rawAmount = rawBalances[index];
    const balance = formatUnits(rawAmount, asset.decimals);
    const usdPrice = asset.stableUsd
      ? 1
      : asset.coingeckoId
        ? (prices.get(asset.coingeckoId) ?? 0)
        : 0;
    const usdValue = toNumber(balance) * usdPrice;

    return {
      symbol: asset.symbol,
      name: asset.name,
      rawAmount: rawAmount.toString(),
      balance,
      usdValue: formatUsd(usdValue),
      usdPrice: formatPrice(usdPrice),
      decimals: asset.decimals,
    } satisfies TreasuryAssetBalance;
  });

  return { assets, priceError };
}

async function syncAccountBalanceSnapshot({
  account,
  client,
  syncedAt,
  pricePromise,
}: {
  account: BalanceAccountSource & { address: Address };
  client: ReturnType<typeof createPublicClient>;
  syncedAt: Date;
  pricePromise: Promise<Map<string, number>>;
}): Promise<SyncedAccountSnapshot> {
  try {
    const trackedAssets = getTrackedAssetsForAccount(account);
    const { assets, priceError } = await fetchLiveAssetBalances({
      address: account.address,
      client,
      trackedAssets,
      pricePromise,
    });
    const totalUsd = formatUsd(
      assets.reduce((total, asset) => total + toNumber(asset.usdValue), 0),
    );
    const status: TreasurySnapshotStatus = priceError ? "partial" : "synced";

    return {
      account: {
        id: account.id,
        name: account.name,
        address: account.address,
        chainId: account.chainId,
        totalUsd,
        assets: sortAssetsByUsdValue(assets),
      },
      errorMessage: priceError?.message ?? null,
      status,
      syncedAt,
    };
  } catch (error) {
    return {
      account: createEmptyAccountBalance(account),
      errorMessage:
        error instanceof Error ? error.message : "Balance sync failed",
      status: "failed",
      syncedAt,
    };
  }
}

async function insertSyncedAccountSnapshot(snapshot: SyncedAccountSnapshot) {
  if (!snapshot.account.address) {
    return;
  }

  const snapshotId = crypto.randomUUID();
  const snapshotValues = {
    id: snapshotId,
    accountAddress: snapshot.account.address,
    chainId: snapshot.account.chainId,
    status: snapshot.status,
    totalUsd: snapshot.account.totalUsd,
    syncedAt: snapshot.syncedAt,
    errorMessage: snapshot.errorMessage,
  };
  const assetValues = snapshot.account.assets.map((asset) => ({
    snapshotId,
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    rawAmount: asset.rawAmount,
    balance: asset.balance,
    usdPrice: asset.usdPrice,
    usdValue: asset.usdValue,
  }));

  const db = getDb();

  if ("batch" in db) {
    await db.batch([
      db.insert(treasuryBalanceSnapshots).values(snapshotValues),
      db.insert(treasuryBalanceAssets).values(assetValues),
    ]);
    return;
  }

  await db.transaction(async (tx) => {
    await tx.insert(treasuryBalanceSnapshots).values(snapshotValues);
    await tx.insert(treasuryBalanceAssets).values(assetValues);
  });
}

function createAggregateSnapshot(
  snapshots: Array<CachedAccountSnapshot | SyncedAccountSnapshot>,
): TreasuryBalanceSnapshot {
  const accounts = snapshots.map((snapshot) => snapshot.account) as [
    TreasuryAccountBalance,
    ...TreasuryAccountBalance[],
  ];
  const syncedAts = snapshots
    .map((snapshot) => snapshot.syncedAt)
    .filter((syncedAt): syncedAt is Date => syncedAt !== null);
  const hasMissingSnapshot = syncedAts.length < snapshots.length;
  const hasFailedSnapshot = snapshots.some(
    (snapshot) => snapshot.status === "failed",
  );
  const hasStaleSnapshot = snapshots.some(
    (snapshot) => "isStale" in snapshot && snapshot.isStale,
  );
  const status =
    syncedAts.length === 0 ? "pending_live_sync" : getAggregateStatus(snapshots);

  return createSnapshot({
    accounts,
    errorMessage:
      snapshots.find((snapshot) => snapshot.errorMessage)?.errorMessage ?? null,
    isStale: hasFailedSnapshot || hasMissingSnapshot || hasStaleSnapshot,
    status:
      status === "synced" && (hasMissingSnapshot || hasStaleSnapshot)
        ? "stale_syncing"
        : status,
    syncedAt: getOldestSyncedAt(syncedAts),
  });
}

export async function getTreasuryBalanceSnapshot(): Promise<TreasuryBalanceSnapshot> {
  const accountSources = await getTrackedAccountSources();
  const cachedSnapshots = await Promise.all(
    accountSources.map(getLatestCachedAccountSnapshot),
  );

  return createAggregateSnapshot(cachedSnapshots);
}

export async function syncTreasuryBalanceSnapshot(): Promise<TreasuryBalanceSnapshot> {
  const inProgressSync = inProgressSyncs.get(MULTI_ACCOUNT_SYNC_KEY);

  if (inProgressSync) {
    return inProgressSync;
  }

  const syncPromise = syncTreasuryAccountBalances();
  inProgressSyncs.set(MULTI_ACCOUNT_SYNC_KEY, syncPromise);

  try {
    return await syncPromise;
  } finally {
    if (inProgressSyncs.get(MULTI_ACCOUNT_SYNC_KEY) === syncPromise) {
      inProgressSyncs.delete(MULTI_ACCOUNT_SYNC_KEY);
    }
  }
}

async function syncTreasuryAccountBalances(): Promise<TreasuryBalanceSnapshot> {
  const accountSources = await getTrackedAccountSources();
  const syncableAccounts = accountSources.filter(
    (account): account is BalanceAccountSource & { address: Address } =>
      account.address !== null,
  );

  if (syncableAccounts.length === 0) {
    return createPendingSnapshot(
      getTreasuryAccountSource(),
      "MAIN_SAFE_ADDRESS is not configured",
    );
  }

  const syncedAt = new Date();
  const pricePromise = getCoinGeckoUsdPrices(
    ALL_TRACKED_TREASURY_ASSETS.flatMap((asset) =>
      asset.stableUsd || !asset.coingeckoId ? [] : [asset.coingeckoId],
    ),
  );
  const syncedSnapshots = await Promise.all(
    syncableAccounts.map((account) =>
      syncAccountBalanceSnapshot({
        account,
        client: getPublicClient(account.chainId),
        syncedAt,
        pricePromise,
      }),
    ),
  );

  await Promise.all(syncedSnapshots.map(insertSyncedAccountSnapshot));

  const missingAccountSnapshots = accountSources
    .filter((account) => account.address === null)
    .map(
      (account) =>
        ({
          account: createEmptyAccountBalance(account),
          errorMessage: "MAIN_SAFE_ADDRESS is not configured",
          isStale: true,
          status: "failed",
          syncedAt: null,
        }) satisfies CachedAccountSnapshot,
    );

  return createAggregateSnapshot([...missingAccountSnapshots, ...syncedSnapshots]);
}
