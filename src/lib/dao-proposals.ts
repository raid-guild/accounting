import "server-only";

import { and, eq, sql } from "drizzle-orm";
import {
  createPublicClient,
  decodeFunctionData,
  getAddress,
  http,
  isAddress,
} from "viem";
import { gnosis } from "viem/chains";

import { getDb } from "@/db";
import { daoProposals, treasuryTransactions } from "@/db/schema";

const DEFAULT_DAOHAUS_APP_BASE_URL = "https://admin.daohaus.club";
const MAX_PROPOSALS_TO_SCAN = 1000;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const FIELD_CANDIDATES = [
  "id",
  "proposalId",
  "proposalNumber",
  "proposalIndex",
  "serial",
  "title",
  "name",
  "details",
  "description",
  "content",
  "status",
  "processed",
  "passed",
  "cancelled",
  "processedAt",
  "executedAt",
  "executionDate",
  "createdAt",
  "executionTxHash",
  "processedTxHash",
  "actionTxHash",
  "txHash",
  "transactionHash",
];
const TX_HASH_FIELD_HINTS = ["execut", "process", "action", "txhash", "transactionhash"];
const DATE_FIELD_CANDIDATES = [
  "executedAt",
  "executionDate",
  "processedAt",
  "createdAt",
];
const TITLE_FIELD_CANDIDATES = ["title", "name", "details", "description", "content"];
const STATUS_FIELD_CANDIDATES = ["status", "processed", "passed", "cancelled"];
const BAAL_PROPOSAL_ABI = [
  {
    inputs: [
      { name: "proposal", type: "uint32" },
      { name: "proposalData", type: "bytes" },
    ],
    name: "processProposal",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type SyncPeriod = {
  endsAtExclusive: Date;
  startsAt: Date;
};

type GraphQlField = {
  name: string;
  type?: {
    kind?: string;
    name?: string | null;
    ofType?: {
      kind?: string;
      name?: string | null;
      ofType?: {
        kind?: string;
        name?: string | null;
      } | null;
    } | null;
  } | null;
};

type ProposalFieldInfo = {
  eventTransactionFields: Set<string>;
  eventTransactionsField: string | null;
  fields: Set<string>;
};

type GraphProposal = Record<string, unknown> & {
  eventTransactions?: Record<string, unknown>[];
};

type MatchedProposal = {
  daoAddress: `0x${string}`;
  daohausUrl: string;
  executedAt: Date | null;
  executionTxHash: `0x${string}`;
  proposalId: string;
  proposalNumber: string | null;
  rawMetadata: Record<string, unknown>;
  status: string | null;
  title: string;
};

export type DaoProposalSyncResult = {
  linkedTransactions: number;
  matchedProposals: number;
  skipped: boolean;
  syncedAt: string;
};

function getDaoAddress() {
  const address = process.env.DAO_CONTRACT_ADDRESS;

  if (!address || !isAddress(address, { strict: false })) {
    return null;
  }

  return getAddress(address);
}

function getSubgraphUrl() {
  return process.env.DAOHAUS_SUBGRAPH_URL?.trim() || null;
}

function getGnosisClient() {
  const rpcUrl = process.env.GNOSIS_RPC_URL;

  if (!rpcUrl) {
    throw new Error("GNOSIS_RPC_URL is required to sync DAO proposals");
  }

  return createPublicClient({
    chain: gnosis,
    transport: http(rpcUrl),
  });
}

function normalizeHash(value: unknown) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    return null;
  }

  return value.toLowerCase() as `0x${string}`;
}

function normalizeTimestamp(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value);
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    const parsed = Number(value);
    return new Date(parsed < 10_000_000_000 ? parsed * 1000 : parsed);
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getScalarFieldNames(info: ProposalFieldInfo) {
  return FIELD_CANDIDATES.filter((field) => info.fields.has(field));
}

async function requestGraphQl<T>({
  query,
  variables,
}: {
  query: string;
  variables?: Record<string, unknown>;
}) {
  const url = getSubgraphUrl();

  if (!url) {
    throw new Error("DAOHAUS_SUBGRAPH_URL is required to sync DAO proposals");
  }

  const response = await fetch(url, {
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`DAOhaus subgraph request failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: T;
    errors?: { message?: string }[];
  };

  if (json.errors?.length) {
    throw new Error(
      json.errors.map((error) => error.message ?? "GraphQL error").join("; "),
    );
  }

  if (!json.data) {
    throw new Error("DAOhaus subgraph returned no data");
  }

  return json.data;
}

async function getProposalFieldInfo(): Promise<ProposalFieldInfo> {
  const data = await requestGraphQl<{
    eventTransactionType?: { fields?: GraphQlField[] } | null;
    __type?: { fields?: GraphQlField[] } | null;
  }>({
    query: `{
      __type(name: "Proposal") {
        fields {
          name
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
      eventTransactionType: __type(name: "EventTransaction") {
        fields {
          name
        }
      }
    }`,
  });
  const fields = data.__type?.fields ?? [];
  const fieldNames = new Set(fields.map((field) => field.name));
  const eventTransactionFields = new Set(
    (data.eventTransactionType?.fields ?? []).map((field) => field.name),
  );
  const eventTransactionsField =
    fields.find((field) => {
      const typeName =
        field.type?.name ??
        field.type?.ofType?.name ??
        field.type?.ofType?.ofType?.name;

      return (
        field.name.toLowerCase().includes("event") &&
        typeName?.toLowerCase().includes("eventtransaction")
      );
    })?.name ?? null;

  return {
    eventTransactionFields,
    eventTransactionsField,
    fields: fieldNames,
  };
}

function getProposalSelection(info: ProposalFieldInfo) {
  const scalarFields = getScalarFieldNames(info);
  const eventFields = [
    "id",
    "txHash",
    "transactionHash",
    "createdAt",
    "eventType",
    "type",
  ].filter((field) => info.eventTransactionFields.has(field));
  const eventSelection =
    info.eventTransactionsField && eventFields.length > 0
      ? `${info.eventTransactionsField}(first: 20) { ${eventFields.join(" ")} }`
    : "";

  return [...scalarFields, eventSelection].filter(Boolean).join("\n");
}

async function fetchDaoProposals(daoAddress: `0x${string}`) {
  const info = await getProposalFieldInfo();
  const selection = getProposalSelection(info);

  if (!selection) {
    return [];
  }

  const data = await requestGraphQl<{ proposals?: GraphProposal[] }>({
    query: `query DaoProposals($dao: String!, $first: Int!) {
      proposals(first: $first, where: { dao: $dao }) {
        ${selection}
      }
    }`,
    variables: {
      dao: daoAddress.toLowerCase(),
      first: MAX_PROPOSALS_TO_SCAN,
    },
  });

  return data.proposals ?? [];
}

async function tryFetchDaoProposals(daoAddress: `0x${string}`) {
  try {
    return await fetchDaoProposals(daoAddress);
  } catch (error) {
    console.error("DAOhaus proposal enrichment failed", error);
    return [];
  }
}

function pickString(proposal: GraphProposal, fields: string[]) {
  for (const field of fields) {
    const value = proposal[field];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "boolean") {
      return String(value);
    }
  }

  return null;
}

function getProposalTitle(proposal: GraphProposal) {
  const rawTitle = pickString(proposal, TITLE_FIELD_CANDIDATES);

  if (!rawTitle) {
    return "Untitled proposal";
  }

  try {
    const parsed = JSON.parse(rawTitle) as unknown;

    if (parsed && typeof parsed === "object") {
      const title = (parsed as { title?: unknown; name?: unknown }).title;
      const name = (parsed as { title?: unknown; name?: unknown }).name;

      if (typeof title === "string" && title.trim()) {
        return title.trim();
      }

      if (typeof name === "string" && name.trim()) {
        return name.trim();
      }
    }
  } catch {
    // Proposal details are often plain text rather than JSON.
  }

  return rawTitle.length > 120 ? `${rawTitle.slice(0, 117)}...` : rawTitle;
}

function getProposalDate(proposal: GraphProposal) {
  for (const field of DATE_FIELD_CANDIDATES) {
    const date = normalizeTimestamp(proposal[field]);

    if (date) {
      return date;
    }
  }

  return null;
}

function getProposalTxHashes(proposal: GraphProposal) {
  const hashes = new Set<`0x${string}`>();

  for (const [field, value] of Object.entries(proposal)) {
    const normalizedField = field.toLowerCase();

    if (!TX_HASH_FIELD_HINTS.some((hint) => normalizedField.includes(hint))) {
      continue;
    }

    const hash = normalizeHash(value);

    if (hash) {
      hashes.add(hash);
    }
  }

  for (const value of Object.values(proposal)) {
    if (!Array.isArray(value)) {
      continue;
    }

    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      for (const [field, nestedValue] of Object.entries(
        item as Record<string, unknown>,
      )) {
        const normalizedField = field.toLowerCase();

        if (
          !TX_HASH_FIELD_HINTS.some((hint) => normalizedField.includes(hint))
        ) {
          continue;
        }

        const hash = normalizeHash(nestedValue);

        if (hash) {
          hashes.add(hash);
        }
      }
    }
  }

  return [...hashes];
}

function getProposalId(proposal: GraphProposal) {
  return (
    pickString(proposal, ["proposalId", "proposalNumber", "proposalIndex", "serial"]) ??
    pickString(proposal, ["id"]) ??
    crypto.randomUUID()
  );
}

function getProposalNumber(proposal: GraphProposal) {
  return pickString(proposal, ["proposalNumber", "proposalIndex", "serial"]);
}

function getProposalStatus(proposal: GraphProposal) {
  return pickString(proposal, STATUS_FIELD_CANDIDATES);
}

export function getDaohausProposalUrl({
  chainId,
  daoAddress,
  proposalId,
}: {
  chainId: number;
  daoAddress: string;
  proposalId: string;
}) {
  const baseUrl = (
    process.env.DAOHAUS_APP_BASE_URL?.trim() || DEFAULT_DAOHAUS_APP_BASE_URL
  ).replace(/\/$/, "");

  return `${baseUrl}/molochv3/0x${chainId.toString(16)}/${daoAddress.toLowerCase()}/proposal/${encodeURIComponent(
    proposalId,
  )}`;
}

async function getPeriodTransactions(period: SyncPeriod) {
  return getDb()
    .select({
      executedAt: treasuryTransactions.executedAt,
      id: treasuryTransactions.id,
      txHash: treasuryTransactions.txHash,
    })
    .from(treasuryTransactions)
    .where(
      and(
        eq(treasuryTransactions.chainId, gnosis.id),
        sql`${treasuryTransactions.executedAt} >= ${period.startsAt}`,
        sql`${treasuryTransactions.executedAt} < ${period.endsAtExclusive}`,
      ),
    );
}

function getMatchedProposal({
  daoAddress,
  proposal,
  transactionByHash,
}: {
  daoAddress: `0x${string}`;
  proposal: GraphProposal;
  transactionByHash: Map<
    `0x${string}`,
    { executedAt: Date; id: string; txHash: string }
  >;
}): MatchedProposal | null {
  for (const txHash of getProposalTxHashes(proposal)) {
    const transaction = transactionByHash.get(txHash);

    if (!transaction) {
      continue;
    }

    const proposalId = getProposalId(proposal);

    return {
      daoAddress,
      daohausUrl: getDaohausProposalUrl({
        chainId: gnosis.id,
        daoAddress,
        proposalId,
      }),
      executedAt: getProposalDate(proposal) ?? transaction.executedAt,
      executionTxHash: txHash,
      proposalId,
      proposalNumber: getProposalNumber(proposal),
      rawMetadata: proposal,
      status: getProposalStatus(proposal),
      title: getProposalTitle(proposal),
    };
  }

  return null;
}

async function getOnchainProposalMatch({
  daoAddress,
  transaction,
}: {
  daoAddress: `0x${string}`;
  transaction: { executedAt: Date; id: string; txHash: string };
}): Promise<MatchedProposal | null> {
  const client = getGnosisClient();
  const chainTransaction = await client
    .getTransaction({
      hash: transaction.txHash as `0x${string}`,
    })
    .catch(() => null);

  if (!chainTransaction) {
    return null;
  }

  if (chainTransaction.to?.toLowerCase() !== daoAddress.toLowerCase()) {
    return null;
  }

  try {
    const decoded = decodeFunctionData({
      abi: BAAL_PROPOSAL_ABI,
      data: chainTransaction.input,
    });
    const proposalId = decoded.args[0].toString();

    return {
      daoAddress,
      daohausUrl: getDaohausProposalUrl({
        chainId: gnosis.id,
        daoAddress,
        proposalId,
      }),
      executedAt: transaction.executedAt,
      executionTxHash: transaction.txHash.toLowerCase() as `0x${string}`,
      proposalId,
      proposalNumber: proposalId,
      rawMetadata: {
        proposalId,
        source: "gnosis_rpc_processProposal",
      },
      status: "processed",
      title: `Proposal ${proposalId}`,
    };
  } catch {
    return null;
  }
}

async function getOnchainProposalMatches({
  daoAddress,
  transactions,
}: {
  daoAddress: `0x${string}`;
  transactions: { executedAt: Date; id: string; txHash: string }[];
}) {
  const matches = new Map<`0x${string}`, MatchedProposal>();

  for (const transaction of transactions) {
    const match = await getOnchainProposalMatch({ daoAddress, transaction });

    if (match) {
      matches.set(match.executionTxHash, match);
    }
  }

  return matches;
}

function mergeProposalMetadata({
  base,
  proposal,
}: {
  base: MatchedProposal;
  proposal: GraphProposal;
}): MatchedProposal {
  const proposalId = getProposalId(proposal);
  const proposalNumber = getProposalNumber(proposal);

  const proposalIdMatches = proposalId === base.proposalId;
  const proposalNumberMatches =
    proposalNumber !== null &&
    base.proposalNumber !== null &&
    proposalNumber === base.proposalNumber;

  if (!proposalIdMatches && !proposalNumberMatches) {
    return base;
  }

  return {
    ...base,
    executedAt: getProposalDate(proposal) ?? base.executedAt,
    proposalNumber: proposalNumber ?? base.proposalNumber,
    rawMetadata: {
      ...proposal,
      onchainMatch: base.rawMetadata,
    },
    status: getProposalStatus(proposal) ?? base.status,
    title: getProposalTitle(proposal),
  };
}

async function upsertAndLinkProposal(proposal: MatchedProposal) {
  const db = getDb();
  const values = {
    chainId: gnosis.id,
    daoAddress: proposal.daoAddress,
    daohausUrl: proposal.daohausUrl,
    executedAt: proposal.executedAt ?? new Date(),
    executionTxHash: proposal.executionTxHash,
    proposalId: proposal.proposalId,
    proposalNumber: proposal.proposalNumber,
    rawMetadata: proposal.rawMetadata,
    status: proposal.status,
    title: proposal.title,
  } satisfies typeof daoProposals.$inferInsert;
  const [row] = await db
    .insert(daoProposals)
    .values(values)
    .onConflictDoNothing()
    .returning();
  const proposalRow =
    row ??
    (
      await db
        .update(daoProposals)
        .set(values)
        .where(
          and(
            eq(daoProposals.chainId, gnosis.id),
            sql`lower(${daoProposals.executionTxHash}) = ${proposal.executionTxHash}`,
          ),
        )
        .returning()
    )[0];

  if (!proposalRow) {
    return 0;
  }

  const updated = await db
    .update(treasuryTransactions)
    .set({ daoProposalId: proposalRow.id })
    .where(
      and(
        eq(treasuryTransactions.chainId, gnosis.id),
        sql`lower(${treasuryTransactions.txHash}) = ${proposal.executionTxHash}`,
      ),
    )
    .returning();

  return updated.length;
}

export async function syncDaoProposalsForPeriod(
  period: SyncPeriod,
): Promise<DaoProposalSyncResult> {
  const daoAddress = getDaoAddress();
  const syncedAt = new Date().toISOString();
  const subgraphUrl = getSubgraphUrl();

  if (!daoAddress) {
    return {
      linkedTransactions: 0,
      matchedProposals: 0,
      skipped: true,
      syncedAt,
    };
  }

  const transactions = await getPeriodTransactions(period);

  if (transactions.length === 0) {
    return {
      linkedTransactions: 0,
      matchedProposals: 0,
      skipped: false,
      syncedAt,
    };
  }

  const transactionByHash = new Map(
    transactions.map((transaction) => [
      transaction.txHash.toLowerCase() as `0x${string}`,
      transaction,
    ]),
  );
  const matchedByHash = await getOnchainProposalMatches({
    daoAddress,
    transactions,
  });
  const proposals = subgraphUrl ? await tryFetchDaoProposals(daoAddress) : [];

  for (const proposal of proposals) {
    const match = getMatchedProposal({
      daoAddress,
      proposal,
      transactionByHash,
    });

    if (!match) {
      for (const [txHash, existingMatch] of matchedByHash) {
        matchedByHash.set(
          txHash,
          mergeProposalMetadata({ base: existingMatch, proposal }),
        );
      }
      continue;
    }

    matchedByHash.set(match.executionTxHash, match);
  }

  let linkedTransactions = 0;

  for (const proposal of matchedByHash.values()) {
    linkedTransactions += await upsertAndLinkProposal(proposal);
  }

  return {
    linkedTransactions,
    matchedProposals: matchedByHash.size,
    skipped: false,
    syncedAt,
  };
}
