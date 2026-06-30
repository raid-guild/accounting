import { NextResponse } from "next/server";

import { ACCOUNTING_DATA_REQUEST_TYPES } from "@/lib/machine-api/auth";
import { getPublicAccountingX402Config } from "@/lib/machine-api/x402";
import {
  DELEGATION_REGISTRY_ABI,
  getDelegationRegistryConfig,
} from "@/lib/machine-api/registry";
import { MACHINE_REPORT_SLICES } from "@/lib/machine-api/report-slices";

type AgentsCapability = {
  auth: {
    delegation: {
      registry: ReturnType<typeof getRegistryDiscovery>;
      type: "evm-contract";
    };
    payment: {
      facilitatorUrl: string;
      network: string;
      payTo: `0x${string}`;
      price: string;
      protocol: "x402";
      scheme: "exact";
    };
    signature: {
      domain: {
        chainId: number;
        name: string;
        verifyingContract: `0x${string}`;
        version: string;
      };
      primaryType: "AccountingDataRequest";
      types: typeof ACCOUNTING_DATA_REQUEST_TYPES;
    };
  };
  endpointTemplate: string;
  id: string;
  methods: ["POST"];
  privacy: {
    excludes: string[];
    visibility: string;
  };
  provenance: string[];
  reportSlices: typeof MACHINE_REPORT_SLICES;
};

function getRegistryDiscovery() {
  const config = getDelegationRegistryConfig();

  return {
    address: config.address,
    chainId: config.chainId,
    lookup: {
      abi: DELEGATION_REGISTRY_ABI,
      method: "delegatorOf(address)",
    },
  };
}

export function GET() {
  let capabilities: AgentsCapability[] = [];

  try {
    const x402 = getPublicAccountingX402Config();
    const registry = getRegistryDiscovery();

    capabilities = [
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
    ];
  } catch {
    capabilities = [];
  }

  return NextResponse.json({
    capabilities,
    demo: true,
    name: "RaidGuild Accounting",
    schema: "https://raidguild.org/schemas/agents-discovery-demo-v1",
  });
}
