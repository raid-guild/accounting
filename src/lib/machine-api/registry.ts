import "server-only";

import { createPublicClient, defineChain, getAddress, http, isAddress } from "viem";

const DELEGATION_REGISTRY_ABI = [
  {
    inputs: [{ internalType: "address", name: "agent", type: "address" }],
    name: "delegatorOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function getDelegationRegistryConfig() {
  const address = process.env.RG_DELEGATION_REGISTRY_ADDRESS;
  const rpcUrl = process.env.RG_DELEGATION_REGISTRY_RPC_URL;
  const chainIdValue = process.env.RG_DELEGATION_REGISTRY_CHAIN_ID ?? "84532";

  if (!address || !isAddress(address)) {
    throw new Error("RG_DELEGATION_REGISTRY_ADDRESS must be a valid EVM address");
  }

  if (!rpcUrl) {
    throw new Error("RG_DELEGATION_REGISTRY_RPC_URL is required");
  }

  const chainId = Number(chainIdValue);

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error("RG_DELEGATION_REGISTRY_CHAIN_ID must be a positive integer");
  }

  return {
    address: getAddress(address),
    chainId,
    rpcUrl,
  };
}

export async function getRegistryDelegator(agent: `0x${string}`) {
  const config = getDelegationRegistryConfig();
  const client = createPublicClient({
    chain: defineChain({
      id: config.chainId,
      name: `Chain ${config.chainId}`,
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    }),
    transport: http(config.rpcUrl),
  });
  const delegator = await client.readContract({
    abi: DELEGATION_REGISTRY_ABI,
    address: config.address,
    args: [agent],
    functionName: "delegatorOf",
  });

  return getAddress(delegator) === ZERO_ADDRESS ? null : getAddress(delegator);
}

export { DELEGATION_REGISTRY_ABI };
