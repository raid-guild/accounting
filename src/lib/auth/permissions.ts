import "server-only";

import { and, isNull, sql } from "drizzle-orm";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseUnits,
} from "viem";
import { gnosis } from "viem/chains";

import { getDb } from "@/db";
import { clericRoles } from "@/db/schema";
import type { AuthPermissions, AuthRole } from "@/lib/auth/types";

const ERC20_MEMBERSHIP_ABI = [
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const HATS_ABI = [
  {
    inputs: [
      { internalType: "address", name: "_wearer", type: "address" },
      { internalType: "uint256", name: "_hatId", type: "uint256" },
    ],
    name: "isWearerOfHat",
    outputs: [{ internalType: "bool", name: "wearing", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function getEvmReadClient({
  chainId,
  rpcUrl,
}: {
  chainId: number;
  rpcUrl: string;
}) {
  return createPublicClient({
    chain: defineChain({
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: {
        default: {
          http: [rpcUrl],
        },
      },
    }),
    transport: http(rpcUrl),
  });
}

function getGnosisClient() {
  const rpcUrl = process.env.DAO_SHARE_RPC_URL ?? process.env.GNOSIS_RPC_URL;

  if (!rpcUrl) {
    throw new Error(
      "DAO_SHARE_RPC_URL or GNOSIS_RPC_URL is required for permission checks",
    );
  }

  const configuredChainId = process.env.DAO_SHARE_CHAIN_ID;

  if (!configuredChainId) {
    return createPublicClient({
      chain: gnosis,
      transport: http(rpcUrl),
    });
  }

  const chainId = Number(configuredChainId);

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error("DAO_SHARE_CHAIN_ID must be a positive integer");
  }

  return getEvmReadClient({ chainId, rpcUrl });
}

export async function hasDaoShares(address: `0x${string}`) {
  const shareTokenAddress = process.env.DAO_SHARE_TOKEN_ADDRESS;

  if (!shareTokenAddress || !isAddress(shareTokenAddress)) {
    throw new Error(
      "DAO_SHARE_TOKEN_ADDRESS is required for member access checks",
    );
  }

  const client = getGnosisClient();
  const tokenAddress = getAddress(shareTokenAddress);
  const [balance, decimals] = await Promise.all([
    client.readContract({
      abi: ERC20_MEMBERSHIP_ABI,
      address: tokenAddress,
      args: [address],
      functionName: "balanceOf",
    }),
    client.readContract({
      abi: ERC20_MEMBERSHIP_ABI,
      address: tokenAddress,
      functionName: "decimals",
    }),
  ]);
  const thresholdValue = process.env.DAO_SHARE_THRESHOLD;

  if (!thresholdValue) {
    throw new Error("DAO_SHARE_THRESHOLD is required for member access checks");
  }

  const threshold = parseUnits(thresholdValue, decimals);

  return balance >= threshold;
}

async function hasAngryDwarfHat(address: `0x${string}`) {
  const hatsAddress = process.env.HATS_CONTRACT_ADDRESS;
  const hatId = process.env.ANGRY_DWARF_HAT_ID;

  if (!hatsAddress || !hatId) {
    return false;
  }

  if (!isAddress(hatsAddress)) {
    throw new Error("HATS_CONTRACT_ADDRESS must be a valid EVM address");
  }

  return getGnosisClient().readContract({
    abi: HATS_ABI,
    address: getAddress(hatsAddress),
    args: [address, BigInt(hatId)],
    functionName: "isWearerOfHat",
  });
}

async function hasClericRole(address: `0x${string}`) {
  const normalizedAddress = address.toLowerCase();
  const db = getDb();
  const role = await db
    .select({ id: clericRoles.id })
    .from(clericRoles)
    .where(
      and(
        sql`lower(${clericRoles.walletAddress}) = ${normalizedAddress}`,
        isNull(clericRoles.revokedAt),
      ),
    )
    .limit(1);

  return role.length > 0;
}

export async function getWalletPermissions(
  walletAddress: string,
): Promise<AuthPermissions> {
  if (!isAddress(walletAddress)) {
    throw new Error("Invalid wallet address");
  }

  const address = getAddress(walletAddress);
  const [isMember, isAdmin, isCleric] = await Promise.all([
    hasDaoShares(address),
    hasAngryDwarfHat(address),
    hasClericRole(address),
  ]);

  const roles: AuthRole[] = [];

  if (isMember) {
    roles.push("member");
  }

  if (isAdmin) {
    roles.push("admin");
  }

  if (isCleric) {
    roles.push("cleric");
  }

  return {
    canAccess: isMember || isAdmin || isCleric,
    canAdmin: isAdmin,
    canWriteRaidAccounting: isAdmin || isCleric,
    roles,
  };
}
