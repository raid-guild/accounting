import { base, gnosis, mainnet } from "viem/chains";
import type { Address } from "viem";

import type { TreasuryAssetSymbol } from "@/lib/treasury/types";

export type TrackedTreasuryAsset = {
  symbol: TreasuryAssetSymbol;
  name: string;
  decimals: number;
  tokenAddress: Address | null;
  stableUsd: boolean;
};

export const GNOSIS_TREASURY_ASSETS = [
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
] as const satisfies readonly TrackedTreasuryAsset[];

export const OPERATOR_ERC20_ASSETS_BY_CHAIN: Record<
  number,
  readonly TrackedTreasuryAsset[]
> = {
  [gnosis.id]: GNOSIS_TREASURY_ASSETS.filter((asset) => asset.tokenAddress),
  [mainnet.id]: [
    {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      stableUsd: true,
    },
    {
      symbol: "wETH",
      name: "Wrapped Ether",
      decimals: 18,
      tokenAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      stableUsd: false,
    },
  ],
  [base.id]: [
    {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71B54bdA02913",
      stableUsd: true,
    },
    {
      symbol: "wETH",
      name: "Wrapped Ether",
      decimals: 18,
      tokenAddress: "0x4200000000000000000000000000000000000006",
      stableUsd: false,
    },
  ],
} as const satisfies Record<number, readonly TrackedTreasuryAsset[]>;
