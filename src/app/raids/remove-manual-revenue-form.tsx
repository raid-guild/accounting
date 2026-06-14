"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";

import {
  removeManualRaidLedgerEntry,
  type ManualRaidLedgerKind,
} from "@/app/raids/transaction-lookup-actions";
import { Button } from "@/components/ui/button";

const INITIAL_STATE = {
  error: null,
  removed: false,
};

export function RemoveManualLedgerEntryForm({
  kind,
  ledgerEntryId,
}: {
  kind: ManualRaidLedgerKind;
  ledgerEntryId: string;
}) {
  const [state, action, pending] = useActionState(
    removeManualRaidLedgerEntry,
    INITIAL_STATE,
  );
  const label = kind === "payout" ? "Payout" : "Revenue";

  if (state.removed) {
    return (
      <p className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
        {label} removed.
      </p>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Remove this manual ${kind} entry? This action cannot be undone.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="ledgerEntryId" value={ledgerEntryId} />
      <input type="hidden" name="kind" value={kind} />
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        disabled={pending}
        aria-busy={pending}
      >
        <Trash2
          data-icon="inline-start"
          className={pending ? "animate-pulse" : ""}
        />
        {pending ? "Removing..." : "Remove"}
      </Button>
      {state.error ? (
        <p className="mt-2 max-w-64 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
