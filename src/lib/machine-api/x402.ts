import "server-only";

import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { getAddress, isAddress } from "viem";

export function getAccountingX402Config() {
  const payTo = process.env.X402_ACCOUNTING_PAY_TO_ADDRESS;

  if (!payTo || !isAddress(payTo)) {
    throw new Error("X402_ACCOUNTING_PAY_TO_ADDRESS must be a valid EVM address");
  }

  const chainIdValue = process.env.X402_ACCOUNTING_CHAIN_ID ?? "84532";
  const chainId = Number(chainIdValue);

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error("X402_ACCOUNTING_CHAIN_ID must be a positive integer");
  }

  const maxTimeoutSeconds = Number(
    process.env.X402_ACCOUNTING_MAX_TIMEOUT_SECONDS ?? 60,
  );

  if (!Number.isInteger(maxTimeoutSeconds) || maxTimeoutSeconds <= 0) {
    throw new Error(
      "X402_ACCOUNTING_MAX_TIMEOUT_SECONDS must be a positive integer",
    );
  }

  return {
    description:
      process.env.X402_ACCOUNTING_DESCRIPTION ??
      "Access published RaidGuild accounting report data",
    facilitatorUrl:
      process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    maxTimeoutSeconds,
    network: `eip155:${chainId}` as const,
    payTo: getAddress(payTo),
    price: process.env.X402_ACCOUNTING_REPORT_PRICE ?? "0.01",
  };
}

export function getPublicAccountingX402Config() {
  const chainIdValue = process.env.X402_ACCOUNTING_CHAIN_ID ?? "84532";
  const chainId = Number(chainIdValue);
  const payTo = process.env.X402_ACCOUNTING_PAY_TO_ADDRESS;

  return {
    chainId: Number.isInteger(chainId) && chainId > 0 ? chainId : 84532,
    facilitatorUrl:
      process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    network: `eip155:${Number.isInteger(chainId) && chainId > 0 ? chainId : 84532}`,
    payTo: payTo && isAddress(payTo) ? getAddress(payTo) : null,
    price: process.env.X402_ACCOUNTING_REPORT_PRICE ?? "0.01",
  };
}

export function createAccountingX402Server() {
  const config = getAccountingX402Config();
  const facilitatorClient = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
  });
  const server = new x402ResourceServer(facilitatorClient);

  registerExactEvmScheme(server, { networks: [config.network] });

  return { config, server };
}
