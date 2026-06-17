export type TreasuryAssetSymbol = "LPT" | "USDC" | "xDAI" | "wxDAI" | "wETH";

export type TreasurySnapshotStatus =
  | "pending_live_sync"
  | "synced"
  | "stale_syncing"
  | "partial"
  | "failed";

export type TreasuryAssetBalance = {
  symbol: TreasuryAssetSymbol;
  name: string;
  rawAmount: string;
  balance: string;
  usdValue: string;
  usdPrice: string;
  decimals: number;
};

export type TreasuryAccountBalance = {
  id: string;
  name: string;
  address: `0x${string}` | null;
  chainId: number;
  totalUsd: string;
  assets: TreasuryAssetBalance[];
};

export type TreasuryBalanceSnapshot = {
  asOf: string;
  syncedAt: string | null;
  isStale: boolean;
  status: TreasurySnapshotStatus;
  errorMessage: string | null;
  totalUsd: string;
  assets: TreasuryAssetBalance[];
  accounts: [TreasuryAccountBalance, ...TreasuryAccountBalance[]];
};
