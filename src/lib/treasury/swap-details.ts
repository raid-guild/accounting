import "server-only";

import {
  createPublicClient,
  decodeEventLog,
  formatUnits,
  getAddress,
  http,
  isAddressEqual,
  parseAbiItem,
  type Address,
} from "viem";
import { gnosis } from "viem/chains";

import { OPERATOR_ERC20_ASSETS_BY_CHAIN } from "@/lib/treasury/assets";
import {
  getChainAddressKey,
  getTransferGroupKey,
  KNOWN_SWAP_COUNTERPARTIES,
} from "@/lib/treasury/swap-detection";

type SwapTransferLike = {
  accountAddress: string;
  assetAmount: string;
  assetSymbol: string;
  chainId: number;
  direction: "inflow" | "outflow" | "internal";
  fromAddress: string;
  toAddress: string;
  txHash: string;
};

export type SwapAssetAmount = {
  amount: string;
  symbol: string;
};

export type SwapDetail = {
  received: SwapAssetAmount | null;
  sold: SwapAssetAmount | null;
};

const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

function getRpcUrl(chainId: number) {
  if (chainId === gnosis.id) {
    return process.env.GNOSIS_RPC_URL ?? null;
  }

  return null;
}

function getClient(chainId: number) {
  const rpcUrl = getRpcUrl(chainId);

  if (!rpcUrl || chainId !== gnosis.id) {
    return null;
  }

  return createPublicClient({
    chain: gnosis,
    transport: http(rpcUrl),
  });
}

function addAmount(
  totals: Map<string, number>,
  { amount, symbol }: SwapAssetAmount,
) {
  totals.set(symbol, (totals.get(symbol) ?? 0) + Number(amount));
}

function getLargestAmount(totals: Map<string, number>): SwapAssetAmount | null {
  const [entry] = [...totals.entries()]
    .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
    .sort(([, left], [, right]) => right - left);

  if (!entry) {
    return null;
  }

  return {
    amount: String(entry[1]),
    symbol: entry[0],
  };
}

function getStoredSwapDetail(transfers: SwapTransferLike[]): SwapDetail {
  const soldTotals = new Map<string, number>();
  const receivedTotals = new Map<string, number>();

  for (const transfer of transfers) {
    const amount = {
      amount: transfer.assetAmount,
      symbol: transfer.assetSymbol,
    };

    if (transfer.direction === "outflow") {
      addAmount(soldTotals, amount);
    }

    if (transfer.direction === "inflow") {
      addAmount(receivedTotals, amount);
    }
  }

  return {
    received: getLargestAmount(receivedTotals),
    sold: getLargestAmount(soldTotals),
  };
}

function getKnownCounterpartyTransfer(transfers: SwapTransferLike[]) {
  return transfers.find((transfer) => {
    const counterparty =
      transfer.direction === "inflow"
        ? transfer.fromAddress
        : transfer.toAddress;

    return KNOWN_SWAP_COUNTERPARTIES.has(
      getChainAddressKey(transfer.chainId, counterparty),
    );
  });
}

async function getReceiptSwapDetail(
  transfer: SwapTransferLike,
): Promise<SwapDetail | null> {
  const client = getClient(transfer.chainId);
  const trackedAssets = OPERATOR_ERC20_ASSETS_BY_CHAIN[transfer.chainId] ?? [];
  const knownCounterparty =
    transfer.direction === "inflow" ? transfer.fromAddress : transfer.toAddress;

  if (!client || trackedAssets.length === 0) {
    return null;
  }

  const receipt = await client.getTransactionReceipt({
    hash: transfer.txHash as `0x${string}`,
  });
  const receivedTotals = new Map<string, number>();

  for (const log of receipt.logs) {
    const asset = trackedAssets.find(
      (candidate) =>
        candidate.tokenAddress &&
        isAddressEqual(candidate.tokenAddress, log.address),
    );

    if (!asset?.tokenAddress) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: [ERC20_TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "Transfer") {
        continue;
      }

      const from = getAddress(decoded.args.from as Address);
      const to = getAddress(decoded.args.to as Address);
      const value = decoded.args.value;

      if (
        asset.symbol !== transfer.assetSymbol &&
        isAddressEqual(from, getAddress(knownCounterparty)) &&
        isAddressEqual(to, getAddress(transfer.accountAddress))
      ) {
        addAmount(receivedTotals, {
          amount: formatUnits(value, asset.decimals),
          symbol: asset.symbol,
        });
      }
    } catch {
      continue;
    }
  }

  return {
    received: getLargestAmount(receivedTotals),
    sold: {
      amount: transfer.assetAmount,
      symbol: transfer.assetSymbol,
    },
  };
}

export async function getSwapDetailsByGroupKey(transfers: SwapTransferLike[]) {
  const groups = new Map<string, SwapTransferLike[]>();

  for (const transfer of transfers) {
    const key = getTransferGroupKey(transfer);
    groups.set(key, [...(groups.get(key) ?? []), transfer]);
  }

  const details = new Map<string, SwapDetail>();

  await Promise.all(
    [...groups.entries()].map(async ([key, group]) => {
      const storedDetail = getStoredSwapDetail(group);

      if (storedDetail.sold && storedDetail.received) {
        details.set(key, storedDetail);
        return;
      }

      const knownCounterpartyTransfer = getKnownCounterpartyTransfer(group);

      if (!knownCounterpartyTransfer) {
        details.set(key, storedDetail);
        return;
      }

      try {
        const receiptDetail = await getReceiptSwapDetail(
          knownCounterpartyTransfer,
        );
        details.set(key, receiptDetail ?? storedDetail);
      } catch {
        details.set(key, storedDetail);
      }
    }),
  );

  return details;
}
