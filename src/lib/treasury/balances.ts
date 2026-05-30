import "server-only";

import { getAddress, isAddress } from "viem";
import { gnosis } from "viem/chains";

import type {
  TreasuryAssetBalance,
  TreasuryBalanceSnapshot,
} from "@/lib/treasury/types";

const TRACKED_TREASURY_ASSETS: TreasuryAssetBalance[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    balance: "0.00",
    usdValue: "0.00",
    usdPrice: "1.00",
    decimals: 6,
  },
  {
    symbol: "xDAI",
    name: "Gnosis xDAI",
    balance: "0.00",
    usdValue: "0.00",
    usdPrice: "1.00",
    decimals: 18,
  },
  {
    symbol: "wxDAI",
    name: "Wrapped xDAI",
    balance: "0.00",
    usdValue: "0.00",
    usdPrice: "1.00",
    decimals: 18,
  },
  {
    symbol: "wETH",
    name: "Wrapped Ether",
    balance: "0.00",
    usdValue: "0.00",
    usdPrice: "0.00",
    decimals: 18,
  },
];

function getMainSafeAddress() {
  const address = process.env.MAIN_SAFE_ADDRESS;

  if (!address || !isAddress(address)) {
    return null;
  }

  return getAddress(address);
}

export async function getTreasuryBalanceSnapshot(): Promise<TreasuryBalanceSnapshot> {
  return {
    accounts: [
      {
        id: "treasury",
        name: "Treasury",
        address: getMainSafeAddress(),
        chainId: gnosis.id,
        totalUsd: "0.00",
        assets: TRACKED_TREASURY_ASSETS,
      },
    ],
    asOf: new Date().toISOString(),
    status: "pending_live_sync",
    totalUsd: "0.00",
  };
}
