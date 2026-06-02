import "server-only";

import { asc, eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import { base, gnosis, mainnet } from "viem/chains";

import { getDb } from "@/db";
import { treasuryAccounts, treasuryAccountTypeEnum } from "@/db/schema";
import { decryptField, type EncryptedField } from "@/lib/encryption";

export type TreasuryAccountType =
  (typeof treasuryAccountTypeEnum.enumValues)[number];

export type EditableTreasuryAccountType = "side_vault" | "operator";

export type TreasuryAccountChainId =
  | typeof gnosis.id
  | typeof mainnet.id
  | typeof base.id;

export const SUPPORTED_OPERATOR_CHAINS = [
  { id: gnosis.id, name: "Gnosis" },
  { id: mainnet.id, name: "Ethereum" },
  { id: base.id, name: "Base" },
] as const;

export const DEFAULT_TREASURY_ACCOUNT_CHAIN_ID = gnosis.id;

export type TreasuryAccountView = {
  id: string;
  name: string;
  address: `0x${string}`;
  chainId: number;
  chainName: string;
  type: TreasuryAccountType;
  isDaoControlled: boolean;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function getChainName(chainId: number) {
  return (
    SUPPORTED_OPERATOR_CHAINS.find((chain) => chain.id === chainId)?.name ??
    `Chain ${chainId}`
  );
}

function decryptOptionalField(value: unknown) {
  return value ? decryptField(value as EncryptedField) : null;
}

function mapTreasuryAccount(
  account: typeof treasuryAccounts.$inferSelect,
): TreasuryAccountView {
  return {
    id: account.id,
    name: decryptField(account.nameEncrypted as EncryptedField),
    address: getAddress(account.address),
    chainId: account.chainId,
    chainName: getChainName(account.chainId),
    type: account.type,
    isDaoControlled: account.isDaoControlled,
    notes: decryptOptionalField(account.notesEncrypted),
    archivedAt: account.archivedAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function normalizeTreasuryAccountInput({
  address,
  chainId,
  type,
}: {
  address: string;
  chainId: number;
  type: EditableTreasuryAccountType;
}) {
  if (!isAddress(address, { strict: false })) {
    throw new Error("Address must be a valid EVM address");
  }

  if (type === "side_vault") {
    return {
      address: getAddress(address),
      chainId: gnosis.id,
      isDaoControlled: true,
      type,
    };
  }

  const isSupportedOperatorChain = SUPPORTED_OPERATOR_CHAINS.some(
    (chain) => chain.id === chainId,
  );

  if (!isSupportedOperatorChain) {
    throw new Error("Operators must be on Gnosis, Ethereum, or Base");
  }

  return {
    address: getAddress(address),
    chainId,
    isDaoControlled: false,
    type,
  };
}

export async function listEditableTreasuryAccounts() {
  const db = getDb();
  const accounts = await db
    .select()
    .from(treasuryAccounts)
    .where(eq(treasuryAccounts.type, "side_vault"))
    .orderBy(asc(treasuryAccounts.archivedAt), asc(treasuryAccounts.createdAt));
  const operators = await db
    .select()
    .from(treasuryAccounts)
    .where(eq(treasuryAccounts.type, "operator"))
    .orderBy(asc(treasuryAccounts.archivedAt), asc(treasuryAccounts.createdAt));

  return [...accounts, ...operators].map(mapTreasuryAccount);
}
