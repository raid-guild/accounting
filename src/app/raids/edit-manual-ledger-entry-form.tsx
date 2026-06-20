"use client";

import { Pencil, Save } from "lucide-react";
import { useEffect, useActionState, useRef } from "react";
import { useRouter } from "next/navigation";

import {
  type ManualRaidLedgerKind,
  updateManualRaidLedgerEntry,
} from "@/app/raids/transaction-lookup-actions";
import { Button } from "@/components/ui/button";
import type { CoreEntityView, RaidView } from "@/lib/core-entities";

const INITIAL_STATE = {
  error: null,
  updated: false,
};

export function EditManualLedgerEntryForm({
  defaultNotes,
  defaultRaidId,
  defaultSubcontractorId,
  defaultUsdAmount,
  kind,
  ledgerEntryId,
  raids,
  subcontractors,
}: {
  defaultNotes: string | null;
  defaultRaidId: string | null;
  defaultSubcontractorId: string | null;
  defaultUsdAmount: string;
  kind: ManualRaidLedgerKind;
  ledgerEntryId: string;
  raids: RaidView[];
  subcontractors: CoreEntityView[];
}) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [state, action, pending] = useActionState(
    updateManualRaidLedgerEntry,
    INITIAL_STATE,
  );
  const label = kind === "payout" ? "payout" : "revenue";

  useEffect(() => {
    if (state.updated) {
      if (detailsRef.current) {
        detailsRef.current.open = false;
      }

      router.refresh();
    }
  }, [router, state.updated]);

  return (
    <details
      ref={detailsRef}
      className="rounded-md border border-border bg-background"
    >
      <summary className="inline-flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
        <Pencil className="size-4" aria-hidden="true" />
        Edit
      </summary>
      <form action={action} className="grid gap-3 px-3 pb-3">
        <input type="hidden" name="ledgerEntryId" value={ledgerEntryId} />
        <input type="hidden" name="kind" value={kind} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            <span className="type-label-sm text-muted-foreground">Raid</span>
            <select
              name="raidId"
              defaultValue={defaultRaidId ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              <option value="" disabled>
                Choose raid
              </option>
              {raids.map((raid) => (
                <option key={raid.id} value={raid.id}>
                  {raid.name}
                </option>
              ))}
            </select>
          </label>

          {kind === "payout" ? (
            <label className="grid gap-2 text-sm font-medium">
              <span className="type-label-sm text-muted-foreground">
                Subcontractor
              </span>
              <select
                name="subcontractorId"
                defaultValue={defaultSubcontractorId ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                required
              >
                <option value="" disabled>
                  Choose subcontractor
                </option>
                {subcontractors.map((subcontractor) => (
                  <option key={subcontractor.id} value={subcontractor.id}>
                    {subcontractor.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="grid gap-2 text-sm font-medium">
            <span className="type-label-sm text-muted-foreground">
              USD Amount
            </span>
            <input
              name="usdAmount"
              defaultValue={defaultUsdAmount}
              inputMode="decimal"
              pattern={String.raw`\d+(\.\d{1,2})?`}
              title="Enter a positive dollar amount with up to 2 decimals"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              required
            />
          </label>
        </div>

        <label className="grid gap-2 text-sm font-medium">
          <span className="type-label-sm text-muted-foreground">Notes</span>
          <textarea
            name="notes"
            defaultValue={defaultNotes ?? ""}
            className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            <Save
              data-icon="inline-start"
              className={pending ? "animate-pulse" : ""}
            />
            {pending ? "Saving..." : `Save ${label}`}
          </Button>
          {state.updated ? (
            <p className="text-xs font-medium text-emerald-800">
              Saved. Refreshing row...
            </p>
          ) : null}
        </div>
        {state.error ? (
          <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
            {state.error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
