"use client";

import { FileUp, Save, Upload } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import {
  confirmBankCsvImport,
  previewBankCsvImport,
  type BankCsvImportState,
} from "@/app/admin/quarters/[id]/transactions/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

const INITIAL_STATE: BankCsvImportState = {
  error: null,
  importedCount: 0,
  preview: null,
};

function formatCurrency(value: string) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(number);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getKindLabel(kind: string) {
  if (kind === "transfer_fee") {
    return "Transfer fee";
  }

  if (kind === "network_fee") {
    return "Network fee";
  }

  if (kind === "exchange_fee") {
    return "Exchange fee";
  }

  return "Bank transaction";
}

function getCategoryLabel(category: string) {
  if (category === "raid_revenue") {
    return "Raid Revenue";
  }

  if (category === "provider_expense") {
    return "Provider Expense";
  }

  if (category === "treasury_transfer") {
    return "Treasury Transfer";
  }

  return category;
}

export function BankCsvImportPanel({ quarterId }: { quarterId: string }) {
  const { showToast } = useToast();
  const [previewState, previewAction, previewPending] = useActionState(
    previewBankCsvImport,
    INITIAL_STATE,
  );
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmBankCsvImport,
    INITIAL_STATE,
  );
  const [hidePreview, setHidePreview] = useState(false);
  const preview = hidePreview ? null : previewState.preview;
  const handlePreviewAction = (formData: FormData) => {
    setHidePreview(false);
    previewAction(formData);
  };
  const handleConfirmAction = (formData: FormData) => {
    setHidePreview(true);
    confirmAction(formData);
  };

  useEffect(() => {
    if (previewState.error) {
      showToast(previewState.error);
    }
  }, [previewState.error, showToast]);

  useEffect(() => {
    if (confirmState.error) {
      showToast(confirmState.error);
    }
  }, [confirmState.error, showToast]);

  useEffect(() => {
    if (confirmState.importedCount > 0) {
      showToast(
        `Imported ${confirmState.importedCount} bank row${
          confirmState.importedCount === 1 ? "" : "s"
        }.`,
      );
    }
  }, [confirmState.importedCount, showToast]);

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <FileUp className="size-5" aria-hidden="true" />
          </div>
          <div>
            <p className="type-label-sm text-muted-foreground">Bank CSV</p>
            <h2 className="text-lg font-semibold">Import bank activity</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Preview completed rows for this quarter before anything is saved.
            </p>
          </div>
        </div>
        <form
          action={handlePreviewAction}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="quarterId" value={quarterId} />
          <label className="grid gap-2 text-sm font-medium">
            <span className="type-label-sm text-muted-foreground">
              CSV file
            </span>
            <input
              name="csvFile"
              type="file"
              accept=".csv,text/csv,text/tab-separated-values"
              className="h-9 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              required
            />
          </label>
          <Button type="submit" disabled={previewPending}>
            <Upload
              data-icon="inline-start"
              className={previewPending ? "animate-pulse" : ""}
            />
            {previewPending ? "Previewing..." : "Preview"}
          </Button>
        </form>
      </div>

      {preview ? (
        <div className="mt-5 border-t border-border pt-5">
          <div className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <PreviewMetric
              label="Importable"
              value={preview.importedRows.length}
            />
            <PreviewMetric label="Duplicates" value={preview.duplicateRows} />
            <PreviewMetric
              label="Outside quarter"
              value={preview.outsideQuarterRows}
            />
            <PreviewMetric
              label="Not completed"
              value={preview.skippedStatusRows}
            />
            <PreviewMetric label="Invalid" value={preview.invalidRows} />
            <PreviewMetric label="Skipped fees" value={preview.skippedFeeRows} />
          </div>

          {preview.importedRows.length > 0 ? (
            <>
              <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Bank type</th>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Amount
                      </th>
                      <th className="px-3 py-2 text-right font-medium">USD</th>
                      <th className="px-3 py-2 font-medium">Memo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.importedRows.slice(0, 25).map((row) => (
                      <tr key={row.sourceExternalId}>
                        <td className="px-3 py-3 text-muted-foreground">
                          {formatDate(row.occurredAt)}
                        </td>
                        <td className="px-3 py-3">{getKindLabel(row.kind)}</td>
                        <td className="max-w-[200px] truncate px-3 py-3 text-muted-foreground">
                          {row.type}
                        </td>
                        <td className="px-3 py-3">
                          {getCategoryLabel(row.category)}
                        </td>
                        <td className="px-3 py-3 text-right font-medium">
                          {row.assetAmount} {row.assetSymbol}
                        </td>
                        <td className="px-3 py-3 text-right font-medium">
                          {formatCurrency(row.usdAmount)}
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-3 text-muted-foreground">
                          {row.memo ?? row.recipient ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.importedRows.length > 25 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing first 25 importable rows.
                </p>
              ) : null}
              <form action={handleConfirmAction} className="mt-4">
                <input type="hidden" name="quarterId" value={quarterId} />
                <textarea
                  hidden
                  name="previewRows"
                  readOnly
                  value={JSON.stringify(preview.importedRows)}
                />
                <Button type="submit" disabled={confirmPending}>
                  <Save
                    data-icon="inline-start"
                    className={confirmPending ? "animate-pulse" : ""}
                  />
                  {confirmPending ? "Importing..." : "Import Previewed Rows"}
                </Button>
              </form>
            </>
          ) : (
            <p className="mt-4 rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
              No new completed rows from this quarter were found.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function PreviewMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="type-label-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
