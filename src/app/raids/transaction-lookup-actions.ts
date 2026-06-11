"use server";

import { getAuthSession } from "@/lib/auth/session";
import {
  lookupManualTransaction,
  type ManualTransactionLookupResult,
} from "@/lib/manual-transaction-lookup";

export type TransactionLookupState = {
  error: string | null;
  result: ManualTransactionLookupResult | null;
};

const USER_FACING_ERRORS = new Set([
  "ALCHEMY_API_KEY is required to look up this transaction",
  "Choose a supported chain",
  "Enter a valid transaction hash",
  "Raid accounting access required",
  "Transaction not found",
  "Unsupported lookup chain",
]);
const RPC_CONFIG_ERROR_PATTERN =
  /^[A-Z][A-Z0-9_]* is required to look up this transaction$/;

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getChainId(value: string) {
  const chainId = Number(value);

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error("Choose a supported chain");
  }

  return chainId;
}

async function requireRaidAccountingAccess() {
  const session = await getAuthSession();

  if (!session.address || !session.permissions?.canWriteRaidAccounting) {
    throw new Error("Raid accounting access required");
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      USER_FACING_ERRORS.has(error.message) ||
      RPC_CONFIG_ERROR_PATTERN.test(error.message)
    ) {
      return error.message;
    }
  }

  return "Transaction lookup failed. Check the selected chain and try again.";
}

export async function lookupRaidTransaction(
  _previousState: TransactionLookupState,
  formData: FormData,
): Promise<TransactionLookupState> {
  try {
    await requireRaidAccountingAccess();

    const chainId = getChainId(getString(formData, "chainId"));
    const txHash = getString(formData, "txHash");

    const result = await lookupManualTransaction({ chainId, txHash });

    return { error: null, result };
  } catch (error) {
    return {
      error: getErrorMessage(error),
      result: null,
    };
  }
}
