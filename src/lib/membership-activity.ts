import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { formatUnits, getAddress, isAddress } from "viem";
import { gnosis } from "viem/chains";

import { getDb } from "@/db";
import {
  daoProposals,
  membershipActivities,
  quarters,
  treasuryTransactionTransfers,
} from "@/db/schema";

type SyncPeriod = {
  endsAtExclusive: Date;
  startsAt: Date;
};

type MembershipActivityVisibility = "admin" | "member";

type MembershipProposal = {
  createdAt?: string | null;
  createdBy?: string | null;
  details?: string | null;
  id: string;
  passed?: boolean | null;
  processTxAt?: string | null;
  processed?: boolean | null;
  proposalId: string;
  proposalOffering?: string | null;
  proposalType?: string | null;
  proposedBy?: string | null;
  title?: string | null;
  tributeOffered?: string | null;
  tributeToken?: string | null;
  tributeTokenDecimals?: string | null;
  tributeTokenSymbol?: string | null;
  txHash?: string | null;
};

type RageQuit = {
  createdAt?: string | null;
  id: string;
  loot?: string | null;
  member?: string | null;
  shares?: string | null;
  to?: string | null;
  tokens?: string[] | null;
  txHash?: string | null;
};

type MembershipGraphResponse = {
  proposals?: MembershipProposal[];
  rageQuits?: RageQuit[];
};

type TransferValue = {
  assetAddress: string | null;
  assetAmount: string | null;
  assetSymbol: string | null;
  usdAmount: string | null;
};

type MembershipActivityInsert = typeof membershipActivities.$inferInsert;

export type MembershipActivitySyncResult = {
  skipped: boolean;
  syncedActivities: number;
  syncedAt: string;
};

export type MembershipActivityRow = {
  assetAmount: string | null;
  assetSymbol: string | null;
  daohausUrl: string | null;
  executedAt: string;
  explorerUrl: string;
  loot: string | null;
  memberAddress: string;
  proposalTitle: string | null;
  quarterLabel: string | null;
  quarterStatus: string | null;
  recipientAddress: string | null;
  shares: string | null;
  txHash: string;
  type: "join" | "ragequit";
  usdAmount: string | null;
};

export type MembershipActivitySummary = {
  joinCount: number;
  memberDuesCents: bigint;
  netCents: bigint;
  ragequitCount: number;
  ragequitOutflowCents: bigint;
};

export type MembershipActivityReport = {
  rows: MembershipActivityRow[];
  summary: MembershipActivitySummary;
};

const DEFAULT_DAOHAUS_APP_BASE_URL = "https://admin.daohaus.club";
const DEFAULT_SUBGRAPH_TIMEOUT_MS = 10_000;
const GRAPH_PAGE_SIZE = 250;
const STABLE_ASSET_SYMBOLS = new Set(["USDC", "XDAI", "WXDAI"]);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const ONE_HUNDRED = BigInt(100);

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

function getSubgraphTimeoutMs() {
  const value = Number(process.env.DAOHAUS_SUBGRAPH_TIMEOUT_MS ?? "");

  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_SUBGRAPH_TIMEOUT_MS;
}

function getDaohausProposalUrl(proposalId: string) {
  const daoAddress = getDaoAddress();
  const baseUrl = (
    process.env.DAOHAUS_APP_BASE_URL?.trim() || DEFAULT_DAOHAUS_APP_BASE_URL
  ).replace(/\/$/, "");

  if (!daoAddress) {
    return null;
  }

  return `${baseUrl}/molochv3/0x${gnosis.id.toString(16)}/${daoAddress.toLowerCase()}/proposal/${encodeURIComponent(
    proposalId,
  )}`;
}

function getExplorerUrl(txHash: string) {
  return `https://gnosisscan.io/tx/${txHash}`;
}

function normalizeHash(value: string | null | undefined) {
  if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    return null;
  }

  return value.toLowerCase();
}

function normalizeAddress(value: string | null | undefined) {
  if (!value || !isAddress(value, { strict: false })) {
    return null;
  }

  return getAddress(value);
}

function normalizeTimestamp(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  const date = new Date(parsed < 10_000_000_000 ? parsed * 1000 : parsed);

  return Number.isNaN(date.getTime()) ? null : date;
}

function isWithinPeriod(date: Date, period: SyncPeriod) {
  return date >= period.startsAt && date < period.endsAtExclusive;
}

function formatRawUnits(value: string | null | undefined, decimals = 18) {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  return formatUnits(BigInt(value), decimals);
}

function getUsdAmount({
  amount,
  symbol,
}: {
  amount: string | null;
  symbol: string | null;
}) {
  if (!amount || !symbol || !STABLE_ASSET_SYMBOLS.has(symbol.toUpperCase())) {
    return null;
  }

  const usdAmount = Number(amount);

  return Number.isFinite(usdAmount) ? usdAmount.toFixed(2) : null;
}

function parseUsdCents(value: string | null) {
  if (!value) {
    return ZERO;
  }

  const [dollars = "0", rawCents = ""] = value.split(".");
  const cents = rawCents.padEnd(2, "0").slice(0, 2);
  const sign = dollars.trim().startsWith("-") ? -ONE : ONE;
  const wholeDollars = dollars.replace("-", "") || "0";

  return sign * (BigInt(wholeDollars) * ONE_HUNDRED + BigInt(cents || "0"));
}

export function formatMembershipCurrency(cents: bigint) {
  const isNegative = cents < ZERO;
  const absolute = isNegative ? -cents : cents;
  const dollars = absolute / ONE_HUNDRED;
  const remainder = absolute % ONE_HUNDRED;
  const formatted = `${dollars.toLocaleString("en-US")}.${remainder
    .toString()
    .padStart(2, "0")}`;

  return `${isNegative ? "-" : ""}$${formatted}`;
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
    throw new Error("DAOHAUS_SUBGRAPH_URL is required to sync membership activity");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getSubgraphTimeoutMs());
  let response: Response;

  try {
    response = await fetch(url, {
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("DAOhaus subgraph request timed out");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

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

async function fetchMembershipGraphPage({
  daoAddress,
  skip,
}: {
  daoAddress: string;
  skip: number;
}) {
  return requestGraphQl<MembershipGraphResponse>({
    query: `query MembershipActivity($dao: String!, $first: Int!, $skip: Int!) {
      proposals(
        first: $first
        skip: $skip
        orderBy: processTxAt
        orderDirection: asc
        where: { dao: $dao, proposalType: "TOKENS_FOR_SHARES", processed: true, passed: true }
      ) {
        id
        proposalId
        txHash
        processTxAt
        createdAt
        createdBy
        proposedBy
        proposalType
        title
        tributeToken
        tributeTokenSymbol
        tributeTokenDecimals
        tributeOffered
        proposalOffering
        processed
        passed
        details
      }
      rageQuits(
        first: $first
        skip: $skip
        orderBy: createdAt
        orderDirection: asc
        where: { dao: $dao }
      ) {
        id
        createdAt
        txHash
        member
        to
        shares
        loot
        tokens
      }
    }`,
    variables: {
      dao: daoAddress.toLowerCase(),
      first: GRAPH_PAGE_SIZE,
      skip,
    },
  });
}

async function fetchMembershipGraph(daoAddress: string) {
  const proposals: MembershipProposal[] = [];
  const rageQuits: RageQuit[] = [];
  let skip = 0;

  while (true) {
    const page = await fetchMembershipGraphPage({ daoAddress, skip });

    proposals.push(...(page.proposals ?? []));
    rageQuits.push(...(page.rageQuits ?? []));

    if (
      (page.proposals?.length ?? 0) < GRAPH_PAGE_SIZE &&
      (page.rageQuits?.length ?? 0) < GRAPH_PAGE_SIZE
    ) {
      break;
    }

    skip += GRAPH_PAGE_SIZE;
  }

  return { proposals, rageQuits };
}

async function getTransferValue({
  direction,
  txHash,
}: {
  direction: "inflow" | "outflow";
  txHash: string;
}): Promise<TransferValue> {
  const transfers = await getDb()
    .select({
      amount: treasuryTransactionTransfers.amount,
      assetSymbol: treasuryTransactionTransfers.assetSymbol,
      tokenAddress: treasuryTransactionTransfers.tokenAddress,
      usdAmount: treasuryTransactionTransfers.usdAmount,
    })
    .from(treasuryTransactionTransfers)
    .where(
      and(
        eq(treasuryTransactionTransfers.chainId, gnosis.id),
        eq(treasuryTransactionTransfers.direction, direction),
        sql`lower(${treasuryTransactionTransfers.txHash}) = ${txHash}`,
      ),
    );

  if (transfers.length === 0) {
    return {
      assetAddress: null,
      assetAmount: null,
      assetSymbol: null,
      usdAmount: null,
    };
  }

  const usdCents = transfers.reduce(
    (total, transfer) => total + parseUsdCents(transfer.usdAmount),
    ZERO,
  );

  if (transfers.length === 1) {
    const [transfer] = transfers;

    return {
      assetAddress: transfer.tokenAddress,
      assetAmount: transfer.amount,
      assetSymbol: transfer.assetSymbol,
      usdAmount:
        transfer.usdAmount ??
        getUsdAmount({
          amount: transfer.amount,
          symbol: transfer.assetSymbol,
        }),
    };
  }

  return {
    assetAddress: null,
    assetAmount: null,
    assetSymbol: "Multiple",
    usdAmount:
      usdCents === ZERO
        ? null
        : `${usdCents / ONE_HUNDRED}.${(usdCents % ONE_HUNDRED)
            .toString()
            .padStart(2, "0")}`,
  };
}

async function findDaoProposalId({
  proposalId,
  txHash,
}: {
  proposalId: string | null;
  txHash: string;
}) {
  const filters = [
    and(
      eq(daoProposals.chainId, gnosis.id),
      sql`lower(${daoProposals.executionTxHash}) = ${txHash}`,
    ),
  ];

  if (proposalId) {
    const daoAddress = getDaoAddress();

    if (daoAddress) {
      filters.push(
        and(
          eq(daoProposals.chainId, gnosis.id),
          sql`lower(${daoProposals.daoAddress}) = ${daoAddress.toLowerCase()}`,
          eq(daoProposals.proposalId, proposalId),
        ),
      );
    }
  }

  for (const filter of filters) {
    const [proposal] = await getDb()
      .select({ id: daoProposals.id })
      .from(daoProposals)
      .where(filter)
      .limit(1);

    if (proposal) {
      return proposal.id;
    }
  }

  return null;
}

async function mapJoinActivity({
  daoAddress,
  period,
  proposal,
  quarterId,
}: {
  daoAddress: string;
  period: SyncPeriod;
  proposal: MembershipProposal;
  quarterId: string;
}): Promise<MembershipActivityInsert | null> {
  const txHash = normalizeHash(proposal.txHash);
  const executedAt =
    normalizeTimestamp(proposal.processTxAt) ??
    normalizeTimestamp(proposal.createdAt);
  const memberAddress = normalizeAddress(proposal.proposedBy ?? proposal.createdBy);

  if (!txHash || !executedAt || !memberAddress || !isWithinPeriod(executedAt, period)) {
    return null;
  }

  const transferValue = await getTransferValue({ direction: "inflow", txHash });
  const decimals = Number(proposal.tributeTokenDecimals ?? 18);
  const fallbackAmount = formatRawUnits(
    proposal.tributeOffered,
    Number.isInteger(decimals) ? decimals : 18,
  );
  const fallbackSymbol = proposal.tributeTokenSymbol ?? null;
  const assetAmount = transferValue.assetAmount ?? fallbackAmount;
  const assetSymbol = transferValue.assetSymbol ?? fallbackSymbol;
  const proposalId = proposal.proposalId || null;

  return {
    assetAddress: transferValue.assetAddress ?? proposal.tributeToken ?? null,
    assetAmount,
    assetSymbol,
    chainId: gnosis.id,
    daoAddress,
    daoProposalId: await findDaoProposalId({ proposalId, txHash }),
    executedAt,
    loot: null,
    memberAddress,
    proposalId,
    proposalTitle: proposal.title ?? null,
    quarterId,
    rawMetadata: proposal,
    recipientAddress: null,
    shares: null,
    txHash,
    type: "join",
    usdAmount:
      transferValue.usdAmount ??
      getUsdAmount({
        amount: assetAmount,
        symbol: assetSymbol,
      }),
  };
}

async function mapRagequitActivity({
  daoAddress,
  period,
  quarterId,
  rageQuit,
}: {
  daoAddress: string;
  period: SyncPeriod;
  quarterId: string;
  rageQuit: RageQuit;
}): Promise<MembershipActivityInsert | null> {
  const txHash = normalizeHash(rageQuit.txHash);
  const executedAt = normalizeTimestamp(rageQuit.createdAt);
  const memberAddress = normalizeAddress(rageQuit.member);

  if (!txHash || !executedAt || !memberAddress || !isWithinPeriod(executedAt, period)) {
    return null;
  }

  const transferValue = await getTransferValue({ direction: "outflow", txHash });

  return {
    assetAddress: transferValue.assetAddress,
    assetAmount: transferValue.assetAmount,
    assetSymbol: transferValue.assetSymbol,
    chainId: gnosis.id,
    daoAddress,
    daoProposalId: null,
    executedAt,
    loot: formatRawUnits(rageQuit.loot),
    memberAddress,
    proposalId: null,
    proposalTitle: null,
    quarterId,
    rawMetadata: rageQuit,
    recipientAddress: normalizeAddress(rageQuit.to),
    shares: formatRawUnits(rageQuit.shares),
    txHash,
    type: "ragequit",
    usdAmount: transferValue.usdAmount,
  };
}

async function upsertMembershipActivity(values: MembershipActivityInsert) {
  const db = getDb();
  const [created] = await db
    .insert(membershipActivities)
    .values(values)
    .onConflictDoNothing()
    .returning();

  if (created) {
    return 1;
  }

  const [updated] = await db
    .update(membershipActivities)
    .set(values)
    .where(
      and(
        eq(membershipActivities.chainId, values.chainId),
        eq(membershipActivities.type, values.type),
        sql`lower(${membershipActivities.txHash}) = ${values.txHash.toLowerCase()}`,
        sql`lower(${membershipActivities.memberAddress}) = ${values.memberAddress.toLowerCase()}`,
      ),
    )
    .returning();

  return updated ? 1 : 0;
}

export async function syncMembershipActivitiesForPeriod({
  period,
  quarterId,
}: {
  period: SyncPeriod;
  quarterId: string;
}): Promise<MembershipActivitySyncResult> {
  const daoAddress = getDaoAddress();
  const syncedAt = new Date().toISOString();

  if (!daoAddress) {
    throw new Error("DAO_CONTRACT_ADDRESS is required to sync membership activity");
  }

  if (!getSubgraphUrl()) {
    throw new Error("DAOHAUS_SUBGRAPH_URL is required to sync membership activity");
  }

  const graph = await fetchMembershipGraph(daoAddress);
  const rows = (
    await Promise.all([
      ...(graph.proposals ?? []).map((proposal) =>
        mapJoinActivity({ daoAddress, period, proposal, quarterId }),
      ),
      ...(graph.rageQuits ?? []).map((rageQuit) =>
        mapRagequitActivity({ daoAddress, period, quarterId, rageQuit }),
      ),
    ])
  ).filter((row): row is MembershipActivityInsert => Boolean(row));
  let syncedActivities = 0;

  for (const row of rows) {
    syncedActivities += await upsertMembershipActivity(row);
  }

  return {
    skipped: false,
    syncedActivities,
    syncedAt,
  };
}

export async function getMembershipActivityReport({
  visibility,
}: {
  visibility: MembershipActivityVisibility;
}): Promise<MembershipActivityReport> {
  const rows = await getDb()
    .select({
      activity: membershipActivities,
      proposal: daoProposals,
      quarter: quarters,
    })
    .from(membershipActivities)
    .leftJoin(quarters, eq(membershipActivities.quarterId, quarters.id))
    .leftJoin(daoProposals, eq(membershipActivities.daoProposalId, daoProposals.id))
    .orderBy(asc(membershipActivities.executedAt));
  const visibleRows = rows.filter((row) =>
    visibility === "admin" ? true : row.quarter?.status === "published",
  );
  const reportRows = visibleRows.map(({ activity, proposal, quarter }) => ({
    assetAmount: activity.assetAmount,
    assetSymbol: activity.assetSymbol,
    daohausUrl: activity.proposalId
      ? (proposal?.daohausUrl ?? getDaohausProposalUrl(activity.proposalId))
      : null,
    executedAt: activity.executedAt.toISOString(),
    explorerUrl: getExplorerUrl(activity.txHash),
    loot: activity.loot,
    memberAddress: activity.memberAddress,
    proposalTitle: activity.proposalTitle,
    quarterLabel: quarter?.label ?? null,
    quarterStatus: quarter?.status ?? null,
    recipientAddress: activity.recipientAddress,
    shares: activity.shares,
    txHash: activity.txHash,
    type: activity.type,
    usdAmount: activity.usdAmount,
  }));
  const summary = reportRows.reduce<MembershipActivitySummary>(
    (totals, row) => {
      if (row.type === "join") {
        totals.joinCount += 1;
        totals.memberDuesCents += parseUsdCents(row.usdAmount);
      } else {
        totals.ragequitCount += 1;
        totals.ragequitOutflowCents += parseUsdCents(row.usdAmount);
      }

      totals.netCents = totals.memberDuesCents - totals.ragequitOutflowCents;

      return totals;
    },
    {
      joinCount: 0,
      memberDuesCents: ZERO,
      netCents: ZERO,
      ragequitCount: 0,
      ragequitOutflowCents: ZERO,
    },
  );

  return {
    rows: reportRows,
    summary,
  };
}
