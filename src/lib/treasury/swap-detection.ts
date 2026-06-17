import { gnosis } from "viem/chains";

type TransferLike = {
  accountAddress: string;
  assetSymbol: string;
  chainId: number;
  direction: "inflow" | "outflow" | "internal";
  fromAddress: string;
  toAddress: string;
  txHash: string;
};

export const KNOWN_SWAP_COUNTERPARTIES = new Set([
  `${gnosis.id}:0x9008d19f58aabd9ed0d60971565aa8510560ab41`,
]);

export function getChainAddressKey(chainId: number, address: string) {
  return `${chainId}:${address.toLowerCase()}`;
}

export function getTransferGroupKey(transfer: TransferLike) {
  return [
    transfer.chainId,
    transfer.accountAddress.toLowerCase(),
    transfer.txHash.toLowerCase(),
  ].join(":");
}

export function isKnownSwapCounterpartyTransfer(transfer: TransferLike) {
  const counterparty =
    transfer.direction === "inflow" ? transfer.fromAddress : transfer.toAddress;

  return KNOWN_SWAP_COUNTERPARTIES.has(
    getChainAddressKey(transfer.chainId, counterparty),
  );
}

export function getSwapTransactionKeys(transfers: TransferLike[]) {
  const groups = new Map<
    string,
    {
      hasKnownSwapCounterparty: boolean;
      directions: Set<TransferLike["direction"]>;
      symbols: Set<string>;
    }
  >();

  for (const transfer of transfers) {
    const key = getTransferGroupKey(transfer);
    const group =
      groups.get(key) ??
      ({
        directions: new Set<TransferLike["direction"]>(),
        hasKnownSwapCounterparty: false,
        symbols: new Set<string>(),
      });

    group.directions.add(transfer.direction);
    group.hasKnownSwapCounterparty ||= isKnownSwapCounterpartyTransfer(transfer);
    group.symbols.add(transfer.assetSymbol.toUpperCase());
    groups.set(key, group);
  }

  return new Set(
    [...groups.entries()]
      .filter(
        ([, group]) =>
          group.hasKnownSwapCounterparty ||
          (group.directions.has("inflow") &&
            group.directions.has("outflow") &&
            group.symbols.size > 1),
      )
      .map(([key]) => key),
  );
}
