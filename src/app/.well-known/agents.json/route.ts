import { NextResponse } from "next/server";

import { ACCOUNTING_DATA_REQUEST_TYPES } from "@/lib/machine-api/auth";
import { getPublicAccountingX402Config } from "@/lib/machine-api/x402";
import { MACHINE_REPORT_SLICES } from "@/lib/machine-api/report-slices";

function getRegistryDiscovery() {
  const chainId = Number(process.env.RG_DELEGATION_REGISTRY_CHAIN_ID ?? 84532);
  const address = process.env.RG_DELEGATION_REGISTRY_ADDRESS;

  return {
    address: address || null,
    chainId: Number.isInteger(chainId) && chainId > 0 ? chainId : 84532,
    lookup: {
      abi: [
        {
          inputs: [{ name: "agent", type: "address" }],
          name: "delegatorOf",
          outputs: [{ name: "", type: "address" }],
          stateMutability: "view",
          type: "function",
        },
      ],
      method: "delegatorOf(address)",
    },
  };
}

export function GET() {
  const x402 = getPublicAccountingX402Config();
  const registry = getRegistryDiscovery();

  return NextResponse.json({
    capabilities: [
      {
        auth: {
          delegation: {
            registry,
            type: "evm-contract",
          },
          payment: {
            facilitatorUrl: x402.facilitatorUrl,
            network: x402.network,
            payTo: x402.payTo,
            price: x402.price,
            protocol: "x402",
            scheme: "exact",
          },
          signature: {
            domain: {
              chainId: registry.chainId,
              name: "RaidGuild Member API Demo",
              verifyingContract: registry.address,
              version: "1",
            },
            primaryType: "AccountingDataRequest",
            types: ACCOUNTING_DATA_REQUEST_TYPES,
          },
        },
        endpointTemplate: "/api/machine/reports/quarters/{quarterId}",
        id: "raidguild.accounting.published-reports",
        methods: ["POST"],
        privacy: {
          excludes: [
            "draft data",
            "reopened unpublished changes",
            "audit-only metadata",
            "decrypted private notes",
            "raw bank memo data",
            "admin-only records",
          ],
          visibility: "published member-visible accounting data only",
        },
        provenance: [
          "quarter",
          "quarterId",
          "publishedAt",
          "reportExportVersion",
          "reportSlice",
        ],
        reportSlices: MACHINE_REPORT_SLICES,
      },
    ],
    demo: true,
    name: "RaidGuild Accounting",
    schema: "https://raidguild.org/schemas/agents-discovery-demo-v1",
  });
}
