import "server-only";

import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { getAddress, isAddress } from "viem";

type AccountingX402Server = ReturnType<typeof buildAccountingX402Server>;

let cachedServer: AccountingX402Server | null = null;

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
    chainId,
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
  const config = getAccountingX402Config();

  return {
    chainId: config.chainId,
    facilitatorUrl: config.facilitatorUrl,
    network: config.network,
    payTo: config.payTo,
    price: config.price,
  };
}

function buildAccountingX402Server() {
  const config = getAccountingX402Config();
  const facilitatorClient = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
  });
  const server = new x402ResourceServer(facilitatorClient);

  registerExactEvmScheme(server, { networks: [config.network] });

  return { config, server };
}

export function createAccountingX402Server() {
  cachedServer ??= buildAccountingX402Server();

  return cachedServer;
}
