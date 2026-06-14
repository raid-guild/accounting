import "server-only";

import type { LedgerCategory } from "@/lib/transaction-classification";

export type BankCsvImportRow = {
  assetAmount: string;
  assetSymbol: string;
  category: Extract<
    LedgerCategory,
    "provider_expense" | "raid_revenue" | "treasury_transfer"
  >;
  kind: "bank_transaction" | "exchange_fee" | "network_fee" | "transfer_fee";
  memo: string | null;
  occurredAt: string;
  paymentType: string | null;
  recipient: string | null;
  sourceExternalId: string;
  transactionId: string;
  type: string;
  usdAmount: string;
};

export type BankCsvPreviewResult = {
  duplicateRows: number;
  importedRows: BankCsvImportRow[];
  invalidRows: number;
  outsideQuarterRows: number;
  skippedFeeRows: number;
  skippedStatusRows: number;
  totalRows: number;
};

type RawBankCsvRow = Record<string, string>;

const REQUIRED_COLUMNS = [
  "Type",
  "Initiated At",
  "Status",
  "Amount",
  "Amount Currency",
  "Amount In USD",
  "Recipient",
  "Transaction ID",
] as const;

const REVENUE_TYPES = new Set(["Bank Deposit", "Deposit"]);
const EXPENSE_TYPES = new Set([
  "Bank Payment",
  "Billing Drawdown Withdrawal",
  "Card Transaction",
  "Funds added to Cards",
  "Transfer to Cards",
  "Withdrawal",
]);
const TREASURY_TRANSFER_TYPES = new Set([
  "Funds removed from Cards",
  "Stablecoin Conversion",
  "Transfer from Cards",
]);

const FEE_COLUMNS = [
  {
    amountColumn: "Transfer Fee",
    currencyColumn: "Transfer Fee Currency",
    kind: "transfer_fee",
  },
  {
    amountColumn: "Network Fee",
    currencyColumn: "Network Fee Currency",
    kind: "network_fee",
  },
  {
    amountColumn: "Exchange Fee",
    currencyColumn: "Exchange Fee Currency",
    kind: "exchange_fee",
  },
] as const;

function detectDelimiter(header: string) {
  return header.split("\t").length > header.split(",").length ? "\t" : ",";
}

function parseDelimited(text: string) {
  const delimiter = detectDelimiter(text.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.trim())) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) {
    rows.push(row);
  }

  return rows;
}

function mapRows(text: string): RawBankCsvRow[] {
  const [headers = [], ...rows] = parseDelimited(text);
  const normalizedHeaders = headers.map((header) => header.trim());

  for (const column of REQUIRED_COLUMNS) {
    if (!normalizedHeaders.includes(column)) {
      throw new Error(`CSV is missing ${column}`);
    }
  }

  return rows.map((row) =>
    Object.fromEntries(
      normalizedHeaders.map((header, index) => [
        header,
        (row[index] ?? "").trim(),
      ]),
    ),
  );
}

function parseMoney(value: unknown) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return null;
  }

  const isParenthesized = trimmed.startsWith("(") && trimmed.endsWith(")");
  const normalized = trimmed.replace(/[,$()\s]/g, "");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return isParenthesized ? -parsed : parsed;
}

function formatDecimal(value: number) {
  return Math.abs(value).toFixed(2);
}

function hasImportableUsdAmount(value: number) {
  return Number(formatDecimal(value)) > 0;
}

function formatAssetAmount(value: number) {
  return Math.abs(value).toFixed(18).replace(/\.?0+$/, "");
}

function getSourceExternalId(transactionId: string, kind: BankCsvImportRow["kind"]) {
  const normalizedId = transactionId.trim().toLowerCase();

  return kind === "bank_transaction"
    ? `bank-csv:${normalizedId}`
    : `bank-csv:${normalizedId}:${kind}`;
}

function getCategoryForType({
  signedUsdAmount,
  type,
}: {
  signedUsdAmount: number;
  type: string;
}): BankCsvImportRow["category"] {
  if (REVENUE_TYPES.has(type)) {
    return "raid_revenue";
  }

  if (EXPENSE_TYPES.has(type)) {
    return "provider_expense";
  }

  if (TREASURY_TRANSFER_TYPES.has(type)) {
    return "treasury_transfer";
  }

  return signedUsdAmount > 0 ? "raid_revenue" : "provider_expense";
}

function getEncryptedNoteText({
  memo,
  paymentType,
  recipient,
}: {
  memo: string | null;
  paymentType: string | null;
  recipient: string | null;
}) {
  return [
    recipient ? `Recipient: ${recipient}` : null,
    memo ? `Memo: ${memo}` : null,
    paymentType ? `Payment type: ${paymentType}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildBankCsvNote(row: BankCsvImportRow) {
  return getEncryptedNoteText({
    memo: row.memo,
    paymentType: row.paymentType,
    recipient: row.recipient,
  });
}

function isInsideQuarter({
  date,
  endsOn,
  startsOn,
}: {
  date: Date;
  endsOn: string;
  startsOn: string;
}) {
  const startsAt = new Date(`${startsOn}T00:00:00.000Z`);
  const endsAtExclusive = new Date(`${endsOn}T00:00:00.000Z`);
  endsAtExclusive.setUTCDate(endsAtExclusive.getUTCDate() + 1);

  return date >= startsAt && date < endsAtExclusive;
}

function buildPrimaryRow(row: RawBankCsvRow): BankCsvImportRow | null {
  const amount = parseMoney(row.Amount ?? "");
  const usdAmount = parseMoney(row["Amount In USD"] ?? "");
  const transactionId = row["Transaction ID"]?.trim();
  const occurredAt = new Date(row["Initiated At"] ?? "");
  const assetSymbol = row["Amount Currency"]?.trim() || "USD";
  const type = row.Type?.trim() || "Unknown";

  if (
    !transactionId ||
    amount === null ||
    amount === 0 ||
    !Number.isFinite(occurredAt.getTime())
  ) {
    return null;
  }

  const fallbackUsdAmount =
    assetSymbol.toUpperCase() === "USD" ? amount : null;
  const normalizedUsdAmount = usdAmount ?? fallbackUsdAmount;

  if (
    normalizedUsdAmount === null ||
    normalizedUsdAmount === 0 ||
    !hasImportableUsdAmount(normalizedUsdAmount)
  ) {
    return null;
  }

  const category = getCategoryForType({
    signedUsdAmount: normalizedUsdAmount,
    type,
  });

  return {
    assetAmount: formatAssetAmount(amount),
    assetSymbol,
    category,
    kind: "bank_transaction",
    memo: row.Memo?.trim() || null,
    occurredAt: occurredAt.toISOString(),
    paymentType: row["Payment Type"]?.trim() || null,
    recipient: row.Recipient?.trim() || null,
    sourceExternalId: getSourceExternalId(transactionId, "bank_transaction"),
    transactionId,
    type,
    usdAmount: formatDecimal(normalizedUsdAmount),
  };
}

function buildFeeRows(row: RawBankCsvRow): BankCsvImportRow[] {
  const transactionId = row["Transaction ID"]?.trim();
  const occurredAt = new Date(row["Initiated At"] ?? "");

  if (!transactionId || !Number.isFinite(occurredAt.getTime())) {
    return [];
  }

  return FEE_COLUMNS.flatMap(({ amountColumn, currencyColumn, kind }) => {
    const amount = parseMoney(row[amountColumn] ?? "");
    const currency = row[currencyColumn]?.trim() || "USD";

    if (
      !amount ||
      currency.toUpperCase() !== "USD" ||
      !hasImportableUsdAmount(amount)
    ) {
      return [];
    }

    return [
      {
        assetAmount: formatAssetAmount(amount),
        assetSymbol: currency,
        category: "provider_expense",
        kind,
        memo: amountColumn,
        occurredAt: occurredAt.toISOString(),
        paymentType: row["Payment Type"]?.trim() || null,
        recipient: row.Recipient?.trim() || null,
        sourceExternalId: getSourceExternalId(transactionId, kind),
        transactionId,
        type: row.Type?.trim() || "Unknown",
        usdAmount: formatDecimal(amount),
      } satisfies BankCsvImportRow,
    ];
  });
}

export function parseBankCsvImport({
  existingSourceExternalIds,
  quarter,
  text,
}: {
  existingSourceExternalIds: Set<string>;
  quarter: { endsOn: string; startsOn: string };
  text: string;
}): BankCsvPreviewResult {
  const rows = mapRows(text);
  const seenSourceExternalIds = new Set(existingSourceExternalIds);
  const result: BankCsvPreviewResult = {
    duplicateRows: 0,
    importedRows: [],
    invalidRows: 0,
    outsideQuarterRows: 0,
    skippedFeeRows: 0,
    skippedStatusRows: 0,
    totalRows: rows.length,
  };

  for (const row of rows) {
    if (row.Status !== "Completed") {
      result.skippedStatusRows += 1;
      continue;
    }

    const primaryRow = buildPrimaryRow(row);

    if (!primaryRow) {
      result.invalidRows += 1;
      continue;
    }

    if (
      !isInsideQuarter({
        date: new Date(primaryRow.occurredAt),
        endsOn: quarter.endsOn,
        startsOn: quarter.startsOn,
      })
    ) {
      result.outsideQuarterRows += 1;
      continue;
    }

    const candidateRows = [primaryRow, ...buildFeeRows(row)];
    const unsupportedFeeCount = FEE_COLUMNS.filter(({ amountColumn, currencyColumn }) => {
      const amount = parseMoney(row[amountColumn] ?? "");
      const currency = row[currencyColumn]?.trim() || "USD";

      return Boolean(amount) && currency.toUpperCase() !== "USD";
    }).length;
    result.skippedFeeRows += unsupportedFeeCount;

    for (const candidateRow of candidateRows) {
      if (seenSourceExternalIds.has(candidateRow.sourceExternalId)) {
        result.duplicateRows += 1;
        continue;
      }

      seenSourceExternalIds.add(candidateRow.sourceExternalId);
      result.importedRows.push(candidateRow);
    }
  }

  return result;
}

export function parseBankCsvConfirmRows(value: string): BankCsvImportRow[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Bank import preview has a bad format");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Bank import preview is required");
  }

  return parsed.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new Error(`Bank import preview row ${index + 1} is invalid`);
    }

    const candidate = row as Partial<BankCsvImportRow>;
    const kind =
      candidate.kind === "transfer_fee" ||
      candidate.kind === "network_fee" ||
      candidate.kind === "exchange_fee"
        ? candidate.kind
        : "bank_transaction";
    const transactionId =
      typeof candidate.transactionId === "string" && candidate.transactionId
        ? candidate.transactionId
        : typeof candidate.sourceExternalId === "string"
          ? candidate.sourceExternalId
              .replace(/^bank-csv:/, "")
              .replace(/:(transfer_fee|network_fee|exchange_fee)$/, "")
          : "";
    const sourceExternalId =
      typeof candidate.sourceExternalId === "string" &&
      candidate.sourceExternalId.startsWith("bank-csv:")
        ? candidate.sourceExternalId
        : transactionId
          ? getSourceExternalId(transactionId, kind)
          : "";
    const assetSymbol =
      typeof candidate.assetSymbol === "string" && candidate.assetSymbol
        ? candidate.assetSymbol
        : "USD";

    const occurredAt = new Date(candidate.occurredAt ?? "");
    const assetAmount = parseMoney(candidate.assetAmount ?? "");
    const usdAmount = parseMoney(candidate.usdAmount ?? "");
    const fallbackUsdAmount =
      usdAmount ??
      (assetSymbol.toUpperCase() === "USD" ? assetAmount : null);
    const fallbackAssetAmount =
      assetAmount ??
      (assetSymbol.toUpperCase() === "USD" ? fallbackUsdAmount : null);
    const category =
      candidate.category === "raid_revenue" ||
      candidate.category === "provider_expense" ||
      candidate.category === "treasury_transfer"
        ? candidate.category
        : fallbackUsdAmount
          ? getCategoryForType({
              signedUsdAmount: fallbackUsdAmount,
              type: candidate.type ?? "Unknown",
            })
          : null;

    if (!sourceExternalId) {
      throw new Error(`Bank import preview row ${index + 1} has an invalid id`);
    }

    if (!transactionId) {
      throw new Error(
        `Bank import preview row ${index + 1} is missing a transaction id`,
      );
    }

    if (!Number.isFinite(occurredAt.getTime())) {
      throw new Error(`Bank import preview row ${index + 1} has an invalid date`);
    }

    if (fallbackAssetAmount === null || fallbackAssetAmount <= 0) {
      throw new Error(
        `Bank import preview row ${index + 1} has an invalid amount`,
      );
    }

    if (fallbackUsdAmount === null || fallbackUsdAmount <= 0) {
      throw new Error(
        `Bank import preview row ${index + 1} has an invalid USD amount`,
      );
    }

    if (!category) {
      throw new Error(
        `Bank import preview row ${index + 1} has an invalid category`,
      );
    }

    return {
      assetAmount: formatAssetAmount(fallbackAssetAmount),
      assetSymbol,
      category,
      kind,
      memo: candidate.memo ?? null,
      occurredAt: occurredAt.toISOString(),
      paymentType: candidate.paymentType ?? null,
      recipient: candidate.recipient ?? null,
      sourceExternalId,
      transactionId,
      type: candidate.type ?? "Unknown",
      usdAmount: formatDecimal(fallbackUsdAmount),
    };
  });
}
