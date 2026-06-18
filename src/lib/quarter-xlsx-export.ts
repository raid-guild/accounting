import "server-only";

import ExcelJS from "exceljs";

import type { QuarterSummary } from "@/lib/quarters";
import { getMembershipActivityReport } from "@/lib/membership-activity";
import { listProposalActivity } from "@/lib/proposal-activity";
import { listQuarterBalanceRows } from "@/lib/quarter-balances";
import {
  getCategoryLabel,
  listClassificationOptions,
  listManualLedgerEntryClassifications,
  listTreasuryTransferClassifications,
  type LedgerCategory,
} from "@/lib/transaction-classification";

type ExportLedgerRow = {
  account: string;
  assetAmount: string;
  assetSymbol: string;
  category: LedgerCategory | null;
  chainId: number | null;
  counterparty: string;
  direction: string;
  occurredAt: string;
  proposal: string;
  raid: string;
  rip: string;
  source: string;
  txHash: string;
  usdAmount: string | null;
};
type QuarterRaidExportRow = {
  expectedSpoils: number;
  payouts: number;
  raid: string;
  remainingPool: number;
  revenue: number;
  spoilsReceived: number;
};

const USD_FORMAT = '"$"#,##0.00;[Red]-"$"#,##0.00';

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function toNumber(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function categoryLabel(category: LedgerCategory | null) {
  return category ? getCategoryLabel(category) : "Unclassified";
}

function autoFitColumns(worksheet: ExcelJS.Worksheet) {
  worksheet.columns.forEach((column) => {
    let maxLength = 10;

    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const text = String(cell.value ?? "");
      maxLength = Math.max(maxLength, Math.min(text.length, 48));
    });

    column.width = maxLength + 2;
  });
}

function styleWorksheet(worksheet: ExcelJS.Worksheet) {
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    fgColor: { argb: "FF2A100A" },
    pattern: "solid",
    type: "pattern",
  };
  header.alignment = { vertical: "middle" };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  autoFitColumns(worksheet);
}

function addRowsSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Partial<ExcelJS.Column>[],
  rows: Record<string, string | number | null>[],
) {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = columns;
  worksheet.addRows(rows);
  styleWorksheet(worksheet);

  return worksheet;
}

function sumUsd(rows: ExportLedgerRow[], categories: LedgerCategory[]) {
  return rows.reduce((total, row) => {
    if (!row.category || !categories.includes(row.category)) {
      return total;
    }

    return total + (toNumber(row.usdAmount) ?? 0);
  }, 0);
}

function getQuarterRaidRows(ledgerRows: ExportLedgerRow[]) {
  const rows = new Map<string, QuarterRaidExportRow>();

  for (const ledgerRow of ledgerRows) {
    if (!ledgerRow.raid) {
      continue;
    }

    const row =
      rows.get(ledgerRow.raid) ??
      ({
        expectedSpoils: 0,
        payouts: 0,
        raid: ledgerRow.raid,
        remainingPool: 0,
        revenue: 0,
        spoilsReceived: 0,
      } satisfies QuarterRaidExportRow);
    const usdAmount = toNumber(ledgerRow.usdAmount) ?? 0;

    if (ledgerRow.category === "raid_revenue") {
      row.revenue += usdAmount;
    }

    if (ledgerRow.category === "raid_spoils") {
      row.spoilsReceived += usdAmount;
    }

    if (ledgerRow.category === "subcontractor_payout") {
      row.payouts += usdAmount;
    }

    row.expectedSpoils = row.revenue / 10;
    row.remainingPool = row.revenue - row.expectedSpoils - row.payouts;
    rows.set(ledgerRow.raid, row);
  }

  return Array.from(rows.values()).sort((left, right) => {
    if (left.revenue !== right.revenue) {
      return right.revenue - left.revenue;
    }

    return left.raid.localeCompare(right.raid);
  });
}

function buildLedgerRows({ quarter }: { quarter: QuarterSummary }) {
  return Promise.all([
    listClassificationOptions(),
    listTreasuryTransferClassifications({ quarter, status: "all" }),
    listManualLedgerEntryClassifications({ quarterId: quarter.id }),
  ]).then(([options, transfers, manualEntries]) => {
    const entitiesById = new Map(
      options.entities.map((entity) => [entity.id, entity.label]),
    );
    const raidsById = new Map(
      options.raids.map((raid) => [raid.id, `${raid.name} (${raid.clientName})`]),
    );
    const ripsById = new Map(options.rips.map((rip) => [rip.id, rip.title]));
    const rows: ExportLedgerRow[] = [
      ...transfers.map((transfer) => ({
        account: transfer.accountName,
        assetAmount: transfer.assetAmount,
        assetSymbol: transfer.assetSymbol,
        category: transfer.category,
        chainId: transfer.chainId,
        counterparty:
          (transfer.counterpartyEntityId
            ? entitiesById.get(transfer.counterpartyEntityId)
            : null) ??
          transfer.toLabel ??
          transfer.fromLabel ??
          "",
        direction: transfer.direction,
        occurredAt: transfer.executedAt,
        proposal: transfer.daoProposal?.title ?? "",
        raid: transfer.raidId ? (raidsById.get(transfer.raidId) ?? "") : "",
        rip: transfer.ripId ? (ripsById.get(transfer.ripId) ?? "") : "",
        source: "Treasury",
        txHash: transfer.txHash,
        usdAmount: transfer.usdAmount,
      })),
      ...manualEntries.map((entry) => ({
        account: "",
        assetAmount: entry.assetAmount,
        assetSymbol: entry.assetSymbol,
        category: entry.category,
        chainId: entry.chainId,
        counterparty: entry.counterpartyEntityId
          ? (entitiesById.get(entry.counterpartyEntityId) ?? "")
          : "",
        direction: "",
        occurredAt: entry.executedAt,
        proposal: "",
        raid: entry.raidId ? (raidsById.get(entry.raidId) ?? "") : "",
        rip: entry.ripId ? (ripsById.get(entry.ripId) ?? "") : "",
        source: entry.source === "bank_csv" ? "Bank CSV" : "Manual",
        txHash: entry.txHash ?? "",
        usdAmount: entry.usdAmount,
      })),
    ];

    return rows.sort(
      (left, right) =>
        new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime(),
    );
  });
}

export async function buildQuarterXlsxExport(quarter: QuarterSummary) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RaidGuild Accounting";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = `${quarter.label} accounting export`;
  workbook.title = `${quarter.label} Accounting Export`;

  const [ledgerRows, membershipReport, proposalActivity, balanceRows] =
    await Promise.all([
      buildLedgerRows({ quarter }),
      getMembershipActivityReport({ visibility: "admin" }),
      listProposalActivity({ visibility: "admin" }),
      listQuarterBalanceRows(quarter.id),
    ]);
  const membershipRows = membershipReport.rows.filter(
    (row) => row.quarterLabel === quarter.label,
  );
  const proposalRows = proposalActivity.filter(
    (row) => row.quarterLabel === quarter.label,
  );
  const revenue = sumUsd(ledgerRows, ["raid_revenue", "member_dues"]);
  const expenses = sumUsd(ledgerRows, [
    "provider_expense",
    "rip_expense",
    "subcontractor_payout",
    "ragequit",
  ]);
  const spoils = sumUsd(ledgerRows, ["raid_spoils"]);

  const summarySheet = addRowsSheet(
    workbook,
    "Summary",
    [
      { header: "Metric", key: "metric" },
      { header: "Value", key: "value" },
    ],
    [
      { metric: "Quarter", value: quarter.label },
      {
        metric: "Period",
        value: `${formatDate(quarter.startsOn)} - ${formatDate(quarter.endsOn)}`,
      },
      { metric: "Status", value: quarter.status },
      { metric: "Revenue", value: revenue },
      { metric: "Expenses", value: expenses },
      { metric: "Net", value: revenue - expenses },
      { metric: "Spoils Received", value: spoils },
      { metric: "Ledger Rows", value: ledgerRows.length },
      { metric: "Membership Events", value: membershipRows.length },
      { metric: "Linked Proposal Transfers", value: proposalRows.length },
    ],
  );
  for (const rowNumber of [5, 6, 7, 8]) {
    summarySheet.getCell(rowNumber, 2).numFmt = USD_FORMAT;
  }

  const balancesSheet = addRowsSheet(
    workbook,
    "Balances",
    [
      { header: "Boundary", key: "boundary" },
      { header: "Account", key: "accountName" },
      { header: "Account Address", key: "accountAddress" },
      { header: "Chain", key: "chainId" },
      { header: "Asset", key: "symbol" },
      { header: "Asset Name", key: "tokenName" },
      { header: "Balance", key: "balance" },
      { header: "USD Price", key: "usdPrice" },
      { header: "USD Value", key: "usdValue" },
      { header: "Price Source", key: "priceSource" },
      { header: "Block", key: "blockNumber" },
      { header: "Block Timestamp", key: "blockTimestamp" },
    ],
    balanceRows.map((row) => ({
      accountAddress: row.accountAddress,
      accountName: row.accountName,
      balance: toNumber(row.balance),
      blockNumber: row.blockNumber,
      blockTimestamp: row.blockTimestamp,
      boundary: row.boundary === "opening" ? "Opening" : "Closing",
      chainId: row.chainId,
      priceSource: row.priceSource,
      symbol: row.symbol,
      tokenName: row.tokenName,
      usdPrice: toNumber(row.usdPrice),
      usdValue: toNumber(row.usdValue),
    })),
  );
  balancesSheet.getColumn("usdPrice").numFmt = USD_FORMAT;
  balancesSheet.getColumn("usdValue").numFmt = USD_FORMAT;

  addRowsSheet(
    workbook,
    "Ledger",
    [
      { header: "Occurred At", key: "occurredAt" },
      { header: "Source", key: "source" },
      { header: "Category", key: "category" },
      { header: "Account", key: "account" },
      { header: "Direction", key: "direction" },
      { header: "Asset Amount", key: "assetAmount" },
      { header: "Asset", key: "assetSymbol" },
      { header: "USD Amount", key: "usdAmount" },
      { header: "Counterparty", key: "counterparty" },
      { header: "Raid", key: "raid" },
      { header: "RIP", key: "rip" },
      { header: "Proposal", key: "proposal" },
      { header: "Chain", key: "chainId" },
      { header: "Tx Hash", key: "txHash" },
    ],
    ledgerRows.map((row) => ({
      ...row,
      category: categoryLabel(row.category),
      usdAmount: toNumber(row.usdAmount),
    })),
  ).getColumn("usdAmount").numFmt = USD_FORMAT;

  const raidsSheet = addRowsSheet(
    workbook,
    "Raids",
    [
      { header: "Raid", key: "raidName" },
      { header: "Revenue", key: "revenue" },
      { header: "Expected Spoils", key: "expectedSpoils" },
      { header: "Spoils Received", key: "spoilsReceived" },
      { header: "Payouts", key: "payouts" },
      { header: "Remaining Pool", key: "remainingPool" },
    ],
    getQuarterRaidRows(ledgerRows).map((raid) => ({
      expectedSpoils: raid.expectedSpoils,
      payouts: raid.payouts,
      raidName: raid.raid,
      remainingPool: raid.remainingPool,
      revenue: raid.revenue,
      spoilsReceived: raid.spoilsReceived,
    })),
  );
  for (const columnKey of [
    "revenue",
    "expectedSpoils",
    "spoilsReceived",
    "payouts",
    "remainingPool",
  ]) {
    raidsSheet.getColumn(columnKey).numFmt = USD_FORMAT;
  }

  addRowsSheet(
    workbook,
    "RIPs",
    [
      { header: "Occurred At", key: "occurredAt" },
      { header: "RIP", key: "rip" },
      { header: "Source", key: "source" },
      { header: "Counterparty", key: "counterparty" },
      { header: "Asset Amount", key: "assetAmount" },
      { header: "Asset", key: "assetSymbol" },
      { header: "USD Amount", key: "usdAmount" },
      { header: "Proposal", key: "proposal" },
      { header: "Chain", key: "chainId" },
      { header: "Tx Hash", key: "txHash" },
    ],
    ledgerRows
      .filter((row) => row.category === "rip_expense")
      .map((row) => ({
        assetAmount: row.assetAmount,
        assetSymbol: row.assetSymbol,
        chainId: row.chainId,
        counterparty: row.counterparty,
        occurredAt: row.occurredAt,
        proposal: row.proposal,
        rip: row.rip,
        source: row.source,
        txHash: row.txHash,
        usdAmount: toNumber(row.usdAmount),
      })),
  ).getColumn("usdAmount").numFmt = USD_FORMAT;

  addRowsSheet(
    workbook,
    "Provider Expenses",
    [
      { header: "Occurred At", key: "occurredAt" },
      { header: "Provider", key: "provider" },
      { header: "Source", key: "source" },
      { header: "Account", key: "account" },
      { header: "Asset Amount", key: "assetAmount" },
      { header: "Asset", key: "assetSymbol" },
      { header: "USD Amount", key: "usdAmount" },
      { header: "Proposal", key: "proposal" },
      { header: "Chain", key: "chainId" },
      { header: "Tx Hash", key: "txHash" },
    ],
    ledgerRows
      .filter((row) => row.category === "provider_expense")
      .map((row) => ({
        account: row.account,
        assetAmount: row.assetAmount,
        assetSymbol: row.assetSymbol,
        chainId: row.chainId,
        occurredAt: row.occurredAt,
        proposal: row.proposal,
        provider: row.counterparty,
        source: row.source,
        txHash: row.txHash,
        usdAmount: toNumber(row.usdAmount),
      })),
  ).getColumn("usdAmount").numFmt = USD_FORMAT;

  addRowsSheet(
    workbook,
    "Membership",
    [
      { header: "Executed At", key: "executedAt" },
      { header: "Type", key: "type" },
      { header: "Member", key: "memberAddress" },
      { header: "Recipient", key: "recipientAddress" },
      { header: "Asset Amount", key: "assetAmount" },
      { header: "Asset", key: "assetSymbol" },
      { header: "USD Amount", key: "usdAmount" },
      { header: "Shares", key: "shares" },
      { header: "Loot", key: "loot" },
      { header: "Proposal", key: "proposalTitle" },
      { header: "Tx Hash", key: "txHash" },
    ],
    membershipRows.map((row) => ({
      ...row,
      usdAmount: toNumber(row.usdAmount),
    })),
  ).getColumn("usdAmount").numFmt = USD_FORMAT;

  addRowsSheet(
    workbook,
    "Proposals",
    [
      { header: "Executed At", key: "executedAt" },
      { header: "Proposal", key: "title" },
      { header: "Proposal Number", key: "proposalNumber" },
      { header: "Category", key: "category" },
      { header: "Counterparty", key: "counterpartyName" },
      { header: "Asset Amount", key: "assetAmount" },
      { header: "Asset", key: "assetSymbol" },
      { header: "USD Amount", key: "usdAmount" },
      { header: "Tx Hash", key: "txHash" },
      { header: "DAOhaus URL", key: "daohausUrl" },
    ],
    proposalRows.map((row) => ({
      ...row,
      usdAmount: toNumber(row.usdAmount),
    })),
  ).getColumn("usdAmount").numFmt = USD_FORMAT;

  return workbook.xlsx.writeBuffer();
}

export function getQuarterExportFilename(quarter: Pick<QuarterSummary, "label">) {
  const slug = quarter.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `raidguild-accounting-${slug || "quarter"}.xlsx`;
}
