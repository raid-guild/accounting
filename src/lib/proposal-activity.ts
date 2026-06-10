import "server-only";

import { asc, eq, isNotNull } from "drizzle-orm";

import { getDb } from "@/db";
import {
  daoProposals,
  entities,
  ledgerEntries,
  quarters,
  treasuryTransactionTransfers,
  treasuryTransactions,
} from "@/db/schema";
import { decryptField, type EncryptedField } from "@/lib/encryption";
import { getCategoryLabel } from "@/lib/transaction-classification";

export type ProposalActivityVisibility = "admin" | "member";

export type ProposalActivityRow = {
  assetAmount: string;
  assetSymbol: string;
  category: string | null;
  counterpartyName: string | null;
  daohausUrl: string;
  executedAt: string;
  explorerUrl: string | null;
  proposalId: string;
  proposalNumber: string | null;
  quarterLabel: string | null;
  quarterStatus: string | null;
  title: string;
  transferId: string;
  txHash: string;
  usdAmount: string | null;
};

const EXPLORER_BY_CHAIN: Record<number, string> = {
  100: "https://gnosisscan.io/tx",
};

function decryptNullableField(value: unknown) {
  return value ? decryptField(value as EncryptedField) : null;
}

function getExplorerUrl(chainId: number, txHash: string) {
  const baseUrl = EXPLORER_BY_CHAIN[chainId];

  return baseUrl ? `${baseUrl}/${txHash}` : null;
}

export async function listProposalActivity({
  visibility,
}: {
  visibility: ProposalActivityVisibility;
}): Promise<ProposalActivityRow[]> {
  const rows = await getDb()
    .select({
      daoProposal: daoProposals,
      entity: entities,
      ledgerEntry: ledgerEntries,
      quarter: quarters,
      transfer: treasuryTransactionTransfers,
      transaction: treasuryTransactions,
    })
    .from(daoProposals)
    .innerJoin(
      treasuryTransactions,
      eq(treasuryTransactions.daoProposalId, daoProposals.id),
    )
    .innerJoin(
      treasuryTransactionTransfers,
      eq(
        treasuryTransactionTransfers.treasuryTransactionId,
        treasuryTransactions.id,
      ),
    )
    .leftJoin(
      ledgerEntries,
      eq(
        ledgerEntries.treasuryTransactionTransferId,
        treasuryTransactionTransfers.id,
      ),
    )
    .leftJoin(quarters, eq(ledgerEntries.quarterId, quarters.id))
    .leftJoin(entities, eq(ledgerEntries.counterpartyEntityId, entities.id))
    .where(isNotNull(treasuryTransactions.daoProposalId))
    .orderBy(asc(daoProposals.executedAt), asc(treasuryTransactionTransfers.id));

  return rows
    .filter((row) =>
      visibility === "admin" ? true : row.quarter?.status === "published",
    )
    .map((row) => ({
      assetAmount: row.transfer.amount,
      assetSymbol: row.transfer.assetSymbol,
      category: row.ledgerEntry?.category
        ? getCategoryLabel(row.ledgerEntry.category)
        : null,
      counterpartyName: decryptNullableField(row.entity?.nameEncrypted),
      daohausUrl: row.daoProposal.daohausUrl,
      executedAt: row.daoProposal.executedAt.toISOString(),
      explorerUrl: getExplorerUrl(row.transaction.chainId, row.transaction.txHash),
      proposalId: row.daoProposal.proposalId,
      proposalNumber: row.daoProposal.proposalNumber,
      quarterLabel: row.quarter?.label ?? null,
      quarterStatus: row.quarter?.status ?? null,
      title: row.daoProposal.title,
      transferId: row.transfer.id,
      txHash: row.transaction.txHash,
      usdAmount: row.ledgerEntry?.usdAmount ?? row.transfer.usdAmount,
    }));
}
