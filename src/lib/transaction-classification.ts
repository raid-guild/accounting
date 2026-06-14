import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import { gnosis } from "viem/chains";

import { getDb } from "@/db";
import {
  auditEvents,
  daoProposals,
  entities,
  ledgerCategoryEnum,
  ledgerEntries,
  quarters,
  raids,
  treasuryAccounts,
  treasuryTransactions,
  treasuryTransactionTransfers,
} from "@/db/schema";
import { decryptField, type EncryptedField } from "@/lib/encryption";
import { listEntitiesByTypes, listRaids } from "@/lib/core-entities";
import { listRipOptions, type RipOption } from "@/lib/rips";

export type LedgerCategory = (typeof ledgerCategoryEnum.enumValues)[number];
export type ClassificationStatus = "classified" | "unclassified" | "all";

export type ClassificationEntityOption = {
  id: string;
  label: string;
  type: "client" | "provider" | "subcontractor";
};

export type ClassificationRaidOption = {
  clientName: string;
  id: string;
  name: string;
};

export type ClassificationOptions = {
  entities: ClassificationEntityOption[];
  raids: ClassificationRaidOption[];
  rips: RipOption[];
};

export type TreasuryAccountLabel = {
  address: string;
  chainId: number;
  label: string;
};

export type TreasuryTransferDaoProposal = {
  daohausUrl: string;
  proposalId: string;
  proposalNumber: string | null;
  title: string;
};

export type TreasuryTransferClassificationView = {
  accountAddress: string;
  accountName: string;
  assetAmount: string;
  assetSymbol: string;
  category: LedgerCategory | null;
  chainId: number;
  counterpartyEntityId: string | null;
  direction: "inflow" | "outflow" | "internal";
  daoProposal: TreasuryTransferDaoProposal | null;
  executedAt: string;
  fromAddress: string;
  fromLabel: string | null;
  ledgerEntryId: string | null;
  notes: string | null;
  quarterId: string | null;
  raidId: string | null;
  ripId: string | null;
  toAddress: string;
  toLabel: string | null;
  transferId: string;
  txHash: string;
  usdAmount: string | null;
};

export type ManualLedgerEntryClassificationView = {
  assetAmount: string;
  assetSymbol: string;
  category: LedgerCategory;
  chainId: number | null;
  counterpartyEntityId: string | null;
  executedAt: string;
  id: string;
  notes: string | null;
  quarterId: string | null;
  raidId: string | null;
  ripId: string | null;
  source: "bank_csv" | "manual";
  txHash: string | null;
  usdAmount: string;
};

export const CLASSIFICATION_CATEGORIES = ledgerCategoryEnum.enumValues;
export const IMPORTED_TRANSFER_CLASSIFICATION_CATEGORIES =
  ledgerCategoryEnum.enumValues.filter(
    (category) => category !== "uncategorized",
  );

function getQuarterBounds({
  endsOn,
  startsOn,
}: {
  endsOn: string;
  startsOn: string;
}) {
  const startsAt = new Date(`${startsOn}T00:00:00.000Z`);
  const endsAtExclusive = new Date(`${endsOn}T00:00:00.000Z`);
  endsAtExclusive.setUTCDate(endsAtExclusive.getUTCDate() + 1);

  return { endsAtExclusive, startsAt };
}

function decryptNullableField(value: unknown) {
  return value ? decryptField(value as EncryptedField) : null;
}

function getAccountName(account: typeof treasuryAccounts.$inferSelect | null) {
  if (!account) {
    return "Treasury";
  }

  return decryptField(account.nameEncrypted as EncryptedField);
}

function getMainSafeLabelEntry() {
  const address = process.env.MAIN_SAFE_ADDRESS;

  if (!address || !isAddress(address, { strict: false })) {
    return null;
  }

  return {
    address: getAddress(address),
    chainId: gnosis.id,
    label: "Treasury",
  };
}

export function getCounterpartyAddressForTransfer({
  direction,
  fromAddress,
  toAddress,
}: {
  direction: "inflow" | "outflow" | "internal";
  fromAddress: string;
  toAddress: string;
}) {
  if (direction === "inflow") {
    return fromAddress;
  }

  return toAddress;
}

function getAccountLabelKey(chainId: number, address: string) {
  return `${chainId}:${address.toLowerCase()}`;
}

export async function getTreasuryAccountLabels() {
  const db = getDb();
  const accounts = await db.select().from(treasuryAccounts);
  const labels = new Map<string, TreasuryAccountLabel>();
  const mainSafe = getMainSafeLabelEntry();

  if (mainSafe) {
    labels.set(
      getAccountLabelKey(mainSafe.chainId, mainSafe.address),
      mainSafe,
    );
  }

  for (const account of accounts) {
    labels.set(
      getAccountLabelKey(account.chainId, account.address),
      {
        address: getAddress(account.address),
        chainId: account.chainId,
        label: decryptField(account.nameEncrypted as EncryptedField),
      },
    );
  }

  return labels;
}

export function getTreasuryAccountLabel({
  address,
  chainId,
  labels,
}: {
  address: string;
  chainId: number;
  labels: Map<string, TreasuryAccountLabel>;
}) {
  return labels.get(getAccountLabelKey(chainId, address)) ?? null;
}

function mapTransferRow({
  account,
  daoProposal,
  labels,
  ledgerEntry,
  transfer,
}: {
  account: typeof treasuryAccounts.$inferSelect | null;
  daoProposal: typeof daoProposals.$inferSelect | null;
  labels: Map<string, TreasuryAccountLabel>;
  ledgerEntry: typeof ledgerEntries.$inferSelect | null;
  transfer: typeof treasuryTransactionTransfers.$inferSelect;
}): TreasuryTransferClassificationView {
  const fromLabel = getTreasuryAccountLabel({
    address: transfer.fromAddress,
    chainId: transfer.chainId,
    labels,
  });
  const toLabel = getTreasuryAccountLabel({
    address: transfer.toAddress,
    chainId: transfer.chainId,
    labels,
  });

  return {
    accountAddress: transfer.accountAddress,
    accountName: getAccountName(account),
    assetAmount: transfer.amount,
    assetSymbol: transfer.assetSymbol,
    category: ledgerEntry?.category ?? null,
    chainId: transfer.chainId,
    counterpartyEntityId: ledgerEntry?.counterpartyEntityId ?? null,
    direction: transfer.direction,
    daoProposal: daoProposal
      ? {
          daohausUrl: daoProposal.daohausUrl,
          proposalId: daoProposal.proposalId,
          proposalNumber: daoProposal.proposalNumber,
          title: daoProposal.title,
        }
      : null,
    executedAt: transfer.executedAt.toISOString(),
    fromAddress: transfer.fromAddress,
    fromLabel: fromLabel?.label ?? null,
    ledgerEntryId: ledgerEntry?.id ?? null,
    notes: decryptNullableField(ledgerEntry?.notesEncrypted),
    quarterId: ledgerEntry?.quarterId ?? null,
    raidId: ledgerEntry?.raidId ?? null,
    ripId: ledgerEntry?.ripId ?? null,
    toAddress: transfer.toAddress,
    toLabel: toLabel?.label ?? null,
    transferId: transfer.id,
    txHash: transfer.txHash,
    usdAmount: ledgerEntry?.usdAmount ?? transfer.usdAmount,
  };
}

export function parseClassificationStatus(
  value: string | string[] | undefined,
): ClassificationStatus {
  const status = Array.isArray(value) ? value[0] : value;

  if (
    status === "all" ||
    status === "classified" ||
    status === "unclassified"
  ) {
    return status;
  }

  return "unclassified";
}

export function getCategoryLabel(category: LedgerCategory) {
  if (category === "rip_expense") {
    return "RIP Expense";
  }

  return category
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function listClassificationOptions(): Promise<ClassificationOptions> {
  const [entityRows, raidRows, ripRows] = await Promise.all([
    listEntitiesByTypes(["client", "provider", "subcontractor"]),
    listRaids(),
    listRipOptions(),
  ]);

  return {
    entities: entityRows.map((entity) => ({
      id: entity.id,
      label: entity.name,
      type: entity.type as ClassificationEntityOption["type"],
    })),
    raids: raidRows.map((raid) => ({
      clientName: raid.client.name,
      id: raid.id,
      name: raid.name,
    })),
    rips: ripRows,
  };
}

export async function listTreasuryTransferClassifications({
  limit,
  quarter,
  status = "unclassified",
}: {
  limit?: number;
  quarter?: { endsOn: string; startsOn: string };
  status?: ClassificationStatus;
} = {}): Promise<TreasuryTransferClassificationView[]> {
  const db = getDb();
  const statusFilter =
    status === "classified"
      ? isNotNull(ledgerEntries.id)
      : status === "unclassified"
        ? isNull(ledgerEntries.id)
        : undefined;
  const bounds = quarter ? getQuarterBounds(quarter) : null;
  const quarterFilter = bounds
    ? and(
        sql`${treasuryTransactionTransfers.executedAt} >= ${bounds.startsAt}`,
        sql`${treasuryTransactionTransfers.executedAt} < ${bounds.endsAtExclusive}`,
      )
    : undefined;
  const filters =
    statusFilter && quarterFilter
      ? and(statusFilter, quarterFilter)
      : (statusFilter ?? quarterFilter);

  const query = db
    .select({
      account: treasuryAccounts,
      daoProposal: daoProposals,
      ledgerEntry: ledgerEntries,
      transfer: treasuryTransactionTransfers,
    })
    .from(treasuryTransactionTransfers)
    .leftJoin(
      ledgerEntries,
      eq(
        ledgerEntries.treasuryTransactionTransferId,
        treasuryTransactionTransfers.id,
      ),
    )
    .leftJoin(
      treasuryAccounts,
      eq(treasuryAccounts.id, treasuryTransactionTransfers.treasuryAccountId),
    )
    .leftJoin(
      treasuryTransactions,
      eq(treasuryTransactions.id, treasuryTransactionTransfers.treasuryTransactionId),
    )
    .leftJoin(
      daoProposals,
      eq(daoProposals.id, treasuryTransactions.daoProposalId),
    )
    .where(filters)
    .orderBy(asc(treasuryTransactionTransfers.executedAt));

  const [labels, rows] = await Promise.all([
    getTreasuryAccountLabels(),
    limit ? query.limit(limit) : query,
  ]);

  return rows.map((row) => mapTransferRow({ ...row, labels }));
}

export async function listManualLedgerEntryClassifications({
  quarterId,
}: {
  quarterId: string;
}): Promise<ManualLedgerEntryClassificationView[]> {
  const rows = await getDb()
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.quarterId, quarterId),
        inArray(ledgerEntries.source, ["bank_csv", "manual"]),
      ),
    )
    .orderBy(asc(ledgerEntries.occurredAt));

  return rows.map((entry) => ({
    assetAmount: entry.assetAmount,
    assetSymbol: entry.assetSymbol,
    category: entry.category,
    chainId: entry.chainId,
    counterpartyEntityId: entry.counterpartyEntityId,
    executedAt: entry.occurredAt.toISOString(),
    id: entry.id,
    notes: decryptNullableField(entry.notesEncrypted),
    quarterId: entry.quarterId,
    raidId: entry.raidId,
    ripId: entry.ripId,
    source: entry.source as "bank_csv" | "manual",
    txHash: entry.txHash,
    usdAmount: entry.usdAmount,
  }));
}

export async function getQuarterIdForDate(date: Date) {
  const day = date.toISOString().slice(0, 10);
  const [quarter] = await getDb()
    .select({ id: quarters.id })
    .from(quarters)
    .where(
      and(sql`${quarters.startsOn} <= ${day}`, sql`${quarters.endsOn} >= ${day}`),
    )
    .limit(1);

  return quarter?.id ?? null;
}

export async function assertQuarterIsAvailable(quarterId: string | null) {
  if (!quarterId) {
    return;
  }

  const [quarter] = await getDb()
    .select({ id: quarters.id })
    .from(quarters)
    .where(eq(quarters.id, quarterId))
    .limit(1);

  if (!quarter) {
    throw new Error("Quarter not found");
  }
}

export async function assertClassificationEntityMatchesCategory({
  category,
  entityId,
}: {
  category: LedgerCategory;
  entityId: string | null;
}) {
  if (!entityId) {
    return;
  }

  const [entity] = await getDb()
    .select({ type: entities.type })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);

  if (!entity) {
    throw new Error("Counterparty not found");
  }

  if (category === "provider_expense" && entity.type !== "provider") {
    throw new Error("Provider expense must link to a provider");
  }

  if (category === "raid_revenue" && entity.type !== "client") {
    throw new Error("Raid revenue must link to a client");
  }

  if (
    category === "subcontractor_payout" &&
    entity.type !== "subcontractor"
  ) {
    throw new Error("Subcontractor payout must link to a subcontractor");
  }
}

export async function assertRaidIsAvailable(raidId: string | null) {
  if (!raidId) {
    return;
  }

  const [raid] = await getDb()
    .select({ id: raids.id })
    .from(raids)
    .where(eq(raids.id, raidId))
    .limit(1);

  if (!raid) {
    throw new Error("Raid not found");
  }
}

export async function listClassificationAuditHistory(limit = 20) {
  const rows = await getDb()
    .select({
      actorWalletAddress: auditEvents.actorWalletAddress,
      createdAt: auditEvents.createdAt,
      id: auditEvents.id,
      summary: auditEvents.summary,
    })
    .from(auditEvents)
    .where(eq(auditEvents.action, "classify"))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}
