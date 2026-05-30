import "server-only";

import { desc, eq, and } from "drizzle-orm";
import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  type Address,
} from "viem";
import { gnosis } from "viem/chains";

import { getDb } from "@/db";
import {
  treasuryBalanceAssets,
  treasuryBalanceSnapshots,
} from "@/db/schema";
import type {
  TreasuryAssetBalance,
  TreasuryAssetSymbol,
  TreasuryBalanceSnapshot,
  TreasurySnapshotStatus,
} from "@/lib/treasury/types";

const SNAPSHOT_TTL_MS = 60 * 60 * 1000;

const inProgressSyncs = new Map<string, Promise<TreasuryBalanceSnapshot>>();

const TRACKED_TREASURY_ASSETS = [
  {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    tokenAddress: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83",
    stableUsd: true,
  },
  {
    symbol: "xDAI",
    name: "Gnosis xDAI",
    decimals: 18,
    tokenAddress: null,
    stableUsd: true,
  },
  {
    symbol: "wxDAI",
    name: "Wrapped xDAI",
    decimals: 18,
    tokenAddress: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
    stableUsd: true,
  },
  {
    symbol: "wETH",
    name: "Wrapped Ether",
    decimals: 18,
    tokenAddress: "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1",
    stableUsd: false,
  },
] as const satisfies ReadonlyArray<{
  symbol: TreasuryAssetSymbol;
  name: string;
  decimals: number;
  tokenAddress: Address | null;
  stableUsd: boolean;
}>;

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

function createEmptyAssetBalance(
  asset: (typeof TRACKED_TREASURY_ASSETS)[number],
): TreasuryAssetBalance {
  return {
    symbol: asset.symbol,
    name: asset.name,
    rawAmount: "0",
    balance: "0.00",
    usdValue: "0.00",
    usdPrice: asset.stableUsd ? "1.00" : "0.00",
    decimals: asset.decimals,
  };
}

function createSnapshot({
  address,
  assets,
  errorMessage = null,
  isStale,
  status,
  syncedAt,
  totalUsd,
}: {
  address: Address | null;
  assets: TreasuryAssetBalance[];
  errorMessage?: string | null;
  isStale: boolean;
  status: TreasurySnapshotStatus;
  syncedAt: string | null;
  totalUsd: string;
}): TreasuryBalanceSnapshot {
  const asOf = new Date().toISOString();

  return {
    accounts: [
      {
        id: "treasury",
        name: "Treasury",
        address,
        chainId: gnosis.id,
        totalUsd,
        assets,
      },
    ],
    asOf,
    syncedAt,
    isStale,
    errorMessage,
    status,
    totalUsd,
  };
}

function createPendingSnapshot(
  address: Address | null,
  errorMessage: string | null = null,
): TreasuryBalanceSnapshot {
  return createSnapshot({
    address,
    assets: TRACKED_TREASURY_ASSETS.map(createEmptyAssetBalance),
    errorMessage,
    isStale: true,
    status: errorMessage ? "failed" : "pending_live_sync",
    syncedAt: null,
    totalUsd: "0.00",
  });
}

export function createFailedTreasuryBalanceSnapshot(errorMessage: string) {
  return createPendingSnapshot(getMainSafeAddress(), errorMessage);
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

async function getLatestCachedSnapshot(address: Address) {
  const db = getDb();
  const [snapshot] = await db
    .select()
    .from(treasuryBalanceSnapshots)
    .where(
      and(
        eq(treasuryBalanceSnapshots.accountAddress, address),
        eq(treasuryBalanceSnapshots.chainId, gnosis.id),
      ),
    )
    .orderBy(desc(treasuryBalanceSnapshots.syncedAt))
    .limit(1);

  if (!snapshot) {
    return null;
  }

  const assets = await db
    .select()
    .from(treasuryBalanceAssets)
    .where(eq(treasuryBalanceAssets.snapshotId, snapshot.id));

  const assetMap = new Map(
    assets.map((asset) => [asset.symbol, mapCachedAsset(asset)]),
  );
  const orderedAssets = TRACKED_TREASURY_ASSETS.map(
    (asset) => assetMap.get(asset.symbol) ?? createEmptyAssetBalance(asset),
  );
  const isStale = isSyncedAtStale(snapshot.syncedAt);

  return createSnapshot({
    address,
    assets: sortAssetsByUsdValue(orderedAssets),
    errorMessage: snapshot.errorMessage,
    isStale,
    status: isStale ? "stale_syncing" : snapshot.status,
    syncedAt: snapshot.syncedAt.toISOString(),
    totalUsd: snapshot.totalUsd,
  });
}

async function getWethUsdPrice() {
  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", "weth");
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

  const body = (await response.json()) as { weth?: { usd?: number } };
  const price = body.weth?.usd;

  if (!price || !Number.isFinite(price) || price <= 0) {
    throw new Error("CoinGecko wETH price invalid or unavailable");
  }

  return price;
}

async function fetchLiveAssetBalances(address: Address) {
  const client = createPublicClient({
    chain: gnosis,
    transport: http(getGnosisRpcUrl()),
  });

  const wethPricePromise = getWethUsdPrice();
  const rawBalances = await Promise.all(
    TRACKED_TREASURY_ASSETS.map(async (asset) => {
      if (!asset.tokenAddress) {
        return client.getBalance({ address });
      }

      return client.readContract({
        abi: erc20Abi,
        address: asset.tokenAddress,
        functionName: "balanceOf",
        args: [address],
      });
    }),
  );

  let wethUsdPrice = 0;
  let priceError: Error | null = null;

  try {
    wethUsdPrice = await wethPricePromise;
  } catch (error) {
    priceError = error instanceof Error ? error : new Error("Price unavailable");
  }

  const assets = TRACKED_TREASURY_ASSETS.map((asset, index) => {
    const rawAmount = rawBalances[index];
    const balance = formatUnits(rawAmount, asset.decimals);
    const usdPrice = asset.stableUsd ? 1 : wethUsdPrice;
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

export async function getTreasuryBalanceSnapshot(): Promise<TreasuryBalanceSnapshot> {
  const address = getMainSafeAddress();

  if (!address) {
    return createPendingSnapshot(null);
  }

  const cachedSnapshot = await getLatestCachedSnapshot(address);

  return cachedSnapshot ?? createPendingSnapshot(address);
}

export async function syncTreasuryBalanceSnapshot(): Promise<TreasuryBalanceSnapshot> {
  const address = getMainSafeAddress();

  if (!address) {
    return createPendingSnapshot(null, "MAIN_SAFE_ADDRESS is not configured");
  }

  const syncKey = `${gnosis.id}:${address.toLowerCase()}`;
  const inProgressSync = inProgressSyncs.get(syncKey);

  if (inProgressSync) {
    return inProgressSync;
  }

  const syncPromise = syncTreasuryBalanceSnapshotForAddress(address);
  inProgressSyncs.set(syncKey, syncPromise);

  try {
    return await syncPromise;
  } finally {
    if (inProgressSyncs.get(syncKey) === syncPromise) {
      inProgressSyncs.delete(syncKey);
    }
  }
}

async function syncTreasuryBalanceSnapshotForAddress(
  address: Address,
): Promise<TreasuryBalanceSnapshot> {
  const { assets, priceError } = await fetchLiveAssetBalances(address);
  const totalUsd = formatUsd(
    assets.reduce((total, asset) => total + toNumber(asset.usdValue), 0),
  );
  const status: TreasurySnapshotStatus = priceError ? "partial" : "synced";
  const syncedAt = new Date();
  const db = getDb();

  await db.transaction(async (tx) => {
    const [snapshot] = await tx
      .insert(treasuryBalanceSnapshots)
      .values({
        accountAddress: address,
        chainId: gnosis.id,
        status,
        totalUsd,
        syncedAt,
        errorMessage: priceError?.message ?? null,
      })
      .returning();

    await tx.insert(treasuryBalanceAssets).values(
      assets.map((asset) => ({
        snapshotId: snapshot.id,
        symbol: asset.symbol,
        name: asset.name,
        decimals: asset.decimals,
        rawAmount: asset.rawAmount,
        balance: asset.balance,
        usdPrice: asset.usdPrice,
        usdValue: asset.usdValue,
      })),
    );
  });

  return createSnapshot({
    address,
    assets: sortAssetsByUsdValue(assets),
    errorMessage: priceError?.message ?? null,
    isStale: false,
    status,
    syncedAt: syncedAt.toISOString(),
    totalUsd,
  });
}
