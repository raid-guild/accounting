import "server-only";

import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { arbitrum, base, gnosis, mainnet, optimism } from "viem/chains";

const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

type ManualLookupChainConfig = {
  alchemyNetwork?: string;
  chain: Chain;
  explorerUrl: string;
  nativeAsset: {
    name: string;
    symbol: string;
  };
  rpcEnv?: string;
};

const MANUAL_LOOKUP_CHAINS = [
  {
    chain: gnosis,
    explorerUrl: "https://gnosisscan.io",
    nativeAsset: { name: "Gnosis xDAI", symbol: "xDAI" },
    rpcEnv: "GNOSIS_RPC_URL",
  },
  {
    alchemyNetwork: "eth-mainnet",
    chain: mainnet,
    explorerUrl: "https://etherscan.io",
    nativeAsset: { name: "Ether", symbol: "ETH" },
  },
  {
    alchemyNetwork: "base-mainnet",
    chain: base,
    explorerUrl: "https://basescan.org",
    nativeAsset: { name: "Ether", symbol: "ETH" },
  },
  {
    alchemyNetwork: "arb-mainnet",
    chain: arbitrum,
    explorerUrl: "https://arbiscan.io",
    nativeAsset: { name: "Ether", symbol: "ETH" },
  },
  {
    alchemyNetwork: "opt-mainnet",
    chain: optimism,
    explorerUrl: "https://optimistic.etherscan.io",
    nativeAsset: { name: "Ether", symbol: "ETH" },
  },
] as const satisfies readonly ManualLookupChainConfig[];

const STABLE_SYMBOLS = new Set(["DAI", "USDC", "USDT", "WXDAI", "XDAI"]);

export type ManualLookupChain = {
  id: number;
  name: string;
};

export type ManualLookupTransfer = {
  amount: string;
  assetName: string;
  assetSymbol: string;
  fromAddress: string;
  rawAmount: string;
  tokenAddress: string | null;
  toAddress: string;
  transferType: "erc20" | "native";
  usdAmount: string | null;
};

export type ManualLookupClassification =
  | "ambiguous"
  | "possible_raid_payout"
  | "possible_raid_revenue";

export type ManualTransactionLookupResult = {
  blockExplorerUrl: string;
  blockNumber: string;
  chainId: number;
  chainName: string;
  classification: ManualLookupClassification;
  executedAt: string;
  fromAddress: string;
  nativeValue: string;
  status: "reverted" | "success";
  toAddress: string | null;
  transfers: ManualLookupTransfer[];
  txHash: string;
};

type TokenMetadata = {
  decimals: number;
  name: string;
  symbol: string;
};

type ParsedTransferLog = {
  fromAddress: Address;
  rawAmount: bigint;
  toAddress: Address;
  tokenAddress: Address;
};

export function listManualLookupChains(): ManualLookupChain[] {
  return MANUAL_LOOKUP_CHAINS.map(({ chain }) => ({
    id: chain.id,
    name: chain.name,
  }));
}

function getChainConfig(chainId: number): ManualLookupChainConfig {
  const config = MANUAL_LOOKUP_CHAINS.find((item) => item.chain.id === chainId);

  if (!config) {
    throw new Error("Unsupported lookup chain");
  }

  return config;
}

function getRpcUrl(config: ManualLookupChainConfig) {
  if (config.alchemyNetwork) {
    const apiKey = process.env.ALCHEMY_API_KEY;

    if (!apiKey) {
      throw new Error(
        "ALCHEMY_API_KEY is required to look up this transaction",
      );
    }

    return `https://${config.alchemyNetwork}.g.alchemy.com/v2/${apiKey}`;
  }

  const rpcUrl = config.rpcEnv ? process.env[config.rpcEnv] : undefined;

  if (!rpcUrl) {
    throw new Error(
      `${config.rpcEnv || "RPC_URL"} is required to look up this transaction`,
    );
  }

  return rpcUrl;
}

function getPublicClient(config: ManualLookupChainConfig) {
  return createPublicClient({
    chain: config.chain as Chain,
    transport: http(getRpcUrl(config)),
  });
}

function normalizeHash(txHash: string) {
  const value = txHash.trim();

  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("Enter a valid transaction hash");
  }

  return value.toLowerCase() as Hex;
}

function formatDecimal(value: string) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  }).format(number);
}

function getStableUsdAmount({
  amount,
  symbol,
}: {
  amount: string;
  symbol: string;
}) {
  if (!STABLE_SYMBOLS.has(symbol.toUpperCase())) {
    return null;
  }

  const number = Number(amount);

  return Number.isFinite(number) ? number.toFixed(2) : null;
}

async function getTokenMetadata({
  address,
  client,
}: {
  address: Address;
  client: PublicClient;
}): Promise<TokenMetadata> {
  const [symbol, name, decimals] = await Promise.all([
    client
      .readContract({ abi: erc20Abi, address, functionName: "symbol" })
      .catch(() => "Unknown"),
    client
      .readContract({ abi: erc20Abi, address, functionName: "name" })
      .catch(() => "Unknown Token"),
    client
      .readContract({ abi: erc20Abi, address, functionName: "decimals" })
      .catch(() => 18),
  ]);

  return {
    decimals: Number(decimals),
    name: String(name),
    symbol: String(symbol),
  };
}

async function getTransactionData({
  client,
  txHash,
}: {
  client: PublicClient;
  txHash: Hex;
}) {
  try {
    return await Promise.all([
      client.getTransaction({ hash: txHash }),
      client.getTransactionReceipt({ hash: txHash }),
    ]);
  } catch (error) {
    if (
      error instanceof TransactionNotFoundError ||
      error instanceof TransactionReceiptNotFoundError
    ) {
      throw new Error("Transaction not found");
    }

    throw error;
  }
}

function classifyTransfers(
  transfers: ManualLookupTransfer[],
): ManualLookupClassification {
  if (transfers.length === 0) {
    return "ambiguous";
  }

  const fromAddresses = new Set(
    transfers.map((transfer) => transfer.fromAddress.toLowerCase()),
  );
  const toAddresses = new Set(
    transfers.map((transfer) => transfer.toAddress.toLowerCase()),
  );

  if (transfers.length > 1 && fromAddresses.size === 1) {
    return "possible_raid_payout";
  }

  if (toAddresses.size === 1) {
    return "possible_raid_revenue";
  }

  return "ambiguous";
}

export async function lookupManualTransaction({
  chainId,
  txHash,
}: {
  chainId: number;
  txHash: string;
}): Promise<ManualTransactionLookupResult> {
  const config = getChainConfig(chainId);
  const normalizedTxHash = normalizeHash(txHash);
  const client = getPublicClient(config);
  const [transaction, receipt] = await getTransactionData({
    client,
    txHash: normalizedTxHash,
  });

  if (!transaction || !receipt) {
    throw new Error("Transaction not found");
  }

  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const parsedLogs = receipt.logs.map((log) => {
    try {
      const parsed = decodeEventLog({
        abi: [ERC20_TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
      });

      return parsed.eventName === "Transfer" ? { log, parsed } : null;
    } catch {
      return null;
    }
  });
  const parsedTransferLogs: ParsedTransferLog[] = [];
  const transfers: ManualLookupTransfer[] = [];

  if (transaction.value > BigInt(0) && transaction.to) {
    const amount = formatEther(transaction.value);

    transfers.push({
      amount,
      assetName: config.nativeAsset.name,
      assetSymbol: config.nativeAsset.symbol,
      fromAddress: getAddress(transaction.from),
      rawAmount: transaction.value.toString(),
      tokenAddress: null,
      toAddress: getAddress(transaction.to),
      transferType: "native",
      usdAmount: getStableUsdAmount({
        amount,
        symbol: config.nativeAsset.symbol,
      }),
    });
  }

  for (const parsedLog of parsedLogs) {
    if (!parsedLog) {
      continue;
    }

    const args = parsedLog.parsed.args as {
      from?: Address;
      to?: Address;
      value?: bigint;
    };
    const from =
      args.from && isAddress(args.from) ? getAddress(args.from) : null;
    const to = args.to && isAddress(args.to) ? getAddress(args.to) : null;
    const value = args.value;

    if (!from || !to || typeof value !== "bigint") {
      continue;
    }

    parsedTransferLogs.push({
      fromAddress: from,
      rawAmount: value,
      toAddress: to,
      tokenAddress: getAddress(parsedLog.log.address),
    });
  }

  const tokenMetadataEntries = await Promise.all(
    [...new Set(parsedTransferLogs.map((log) => log.tokenAddress))].map(
      async (tokenAddress) =>
        [
          tokenAddress,
          await getTokenMetadata({ address: tokenAddress, client }),
        ] as const,
    ),
  );
  const metadataByTokenAddress = new Map(tokenMetadataEntries);

  for (const parsedTransferLog of parsedTransferLogs) {
    const metadata = metadataByTokenAddress.get(parsedTransferLog.tokenAddress);

    if (!metadata) {
      continue;
    }

    const amount = formatUnits(parsedTransferLog.rawAmount, metadata.decimals);

    transfers.push({
      amount,
      assetName: metadata.name,
      assetSymbol: metadata.symbol,
      fromAddress: parsedTransferLog.fromAddress,
      rawAmount: parsedTransferLog.rawAmount.toString(),
      tokenAddress: parsedTransferLog.tokenAddress,
      toAddress: parsedTransferLog.toAddress,
      transferType: "erc20",
      usdAmount: getStableUsdAmount({ amount, symbol: metadata.symbol }),
    });
  }

  return {
    blockExplorerUrl: `${config.explorerUrl}/tx/${normalizedTxHash}`,
    blockNumber: receipt.blockNumber.toString(),
    chainId: config.chain.id,
    chainName: config.chain.name,
    classification: classifyTransfers(transfers),
    executedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    fromAddress: getAddress(transaction.from),
    nativeValue: formatDecimal(formatEther(transaction.value)),
    status: receipt.status,
    toAddress: transaction.to ? getAddress(transaction.to) : null,
    transfers,
    txHash: normalizedTxHash,
  };
}
