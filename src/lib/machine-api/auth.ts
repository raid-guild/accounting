import "server-only";

import { getAddress, isAddress, verifyTypedData } from "viem";

import { hasDaoShares } from "@/lib/auth/permissions";
import { consumeMachineApiNonce } from "@/lib/machine-api/nonces";
import { getDelegationRegistryConfig, getRegistryDelegator } from "@/lib/machine-api/registry";
import {
  isMachineReportSlice,
  type MachineReportSlice,
} from "@/lib/machine-api/report-slices";

export type MachineApiAuthPayload = {
  agent?: unknown;
  delegator?: unknown;
  expiresAt?: unknown;
  nonce?: unknown;
  signature?: unknown;
};

export type VerifiedMachineApiRequest = {
  agent: `0x${string}`;
  delegator: `0x${string}`;
  expiresAt: Date;
  nonce: string;
  reportSlice: MachineReportSlice;
};

export class MachineApiAuthError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
    this.name = "MachineApiAuthError";
  }
}

const ACCOUNTING_DATA_REQUEST_TYPES = {
  AccountingDataRequest: [
    { name: "agent", type: "address" },
    { name: "delegator", type: "address" },
    { name: "method", type: "string" },
    { name: "resource", type: "string" },
    { name: "quarterId", type: "string" },
    { name: "reportSlice", type: "string" },
    { name: "nonce", type: "string" },
    { name: "expiresAt", type: "uint256" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MachineApiAuthError(`${field} is required.`, 400);
  }

  return value.trim();
}

function normalizeAddress(value: unknown, field: string) {
  const address = requireString(value, field);

  if (!isAddress(address)) {
    throw new MachineApiAuthError(`${field} must be a valid EVM address.`, 400);
  }

  return getAddress(address);
}

function parseExpiry(value: unknown) {
  const expiresAt = Number(value);

  if (!Number.isInteger(expiresAt) || expiresAt <= 0) {
    throw new MachineApiAuthError("expiresAt must be a Unix timestamp.", 400);
  }

  if (expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new MachineApiAuthError("Machine API request has expired.", 401);
  }

  return {
    date: new Date(expiresAt * 1000),
    timestamp: BigInt(expiresAt),
  };
}

function parseSignature(value: unknown) {
  const signature = requireString(value, "signature");

  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new MachineApiAuthError(
      "signature must be a 65-byte hex EVM signature.",
      400,
    );
  }

  return signature as `0x${string}`;
}

export async function verifyMachineApiRequest({
  auth,
  method,
  quarterId,
  reportSlice,
  resource,
}: {
  auth: MachineApiAuthPayload;
  method: string;
  quarterId: string;
  reportSlice: unknown;
  resource: string;
}): Promise<VerifiedMachineApiRequest> {
  if (!isMachineReportSlice(reportSlice)) {
    throw new MachineApiAuthError("Unsupported report slice.", 400);
  }

  const registryConfig = getDelegationRegistryConfig();
  const agent = normalizeAddress(auth.agent, "agent");
  const delegator = normalizeAddress(auth.delegator, "delegator");
  const nonce = requireString(auth.nonce, "nonce");
  const signature = parseSignature(auth.signature);
  const expiresAt = parseExpiry(auth.expiresAt);

  const validSignature = await verifyTypedData({
    address: agent,
    domain: {
      chainId: registryConfig.chainId,
      name: "RaidGuild Member API Demo",
      verifyingContract: registryConfig.address,
      version: "1",
    },
    message: {
      agent,
      chainId: BigInt(registryConfig.chainId),
      delegator,
      expiresAt: expiresAt.timestamp,
      method,
      nonce,
      quarterId,
      reportSlice,
      resource,
    },
    primaryType: "AccountingDataRequest",
    signature,
    types: ACCOUNTING_DATA_REQUEST_TYPES,
  }).catch(() => {
    throw new MachineApiAuthError("Invalid agent signature.");
  });

  if (!validSignature) {
    throw new MachineApiAuthError("Invalid agent signature.");
  }

  const currentDelegator = await getRegistryDelegator(agent);

  if (!currentDelegator || currentDelegator !== delegator) {
    throw new MachineApiAuthError("Agent is not delegated by this member.");
  }

  if (!(await hasDaoShares(delegator))) {
    throw new MachineApiAuthError("Delegator is not a current member.", 403);
  }

  await consumeMachineApiNonce({
    agentAddress: agent,
    delegatorAddress: delegator,
    expiresAt: expiresAt.date,
    nonce,
    quarterId,
    reportSlice,
  });

  return {
    agent,
    delegator,
    expiresAt: expiresAt.date,
    nonce,
    reportSlice,
  };
}

export { ACCOUNTING_DATA_REQUEST_TYPES };
