export type TreasuryAssetSymbol = "USDC" | "xDAI" | "wxDAI" | "wETH";

export type TreasurySnapshotStatus = "pending_live_sync";

export type TreasuryAssetBalance = {
  symbol: TreasuryAssetSymbol;
  name: string;
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
  status: TreasurySnapshotStatus;
  totalUsd: string;
  accounts: [TreasuryAccountBalance, ...TreasuryAccountBalance[]];
};
