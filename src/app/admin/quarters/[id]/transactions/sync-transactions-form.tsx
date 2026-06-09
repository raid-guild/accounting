"use client";

import { RefreshCw } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { syncQuarterTransactions } from "@/app/admin/quarters/[id]/transactions/actions";

function SyncButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      <RefreshCw
        data-icon="inline-start"
        className={pending ? "animate-spin" : ""}
        aria-hidden="true"
      />
      {pending ? "Syncing..." : "Sync Transactions"}
    </Button>
  );
}

export function SyncTransactionsForm({ quarterId }: { quarterId: string }) {
  return (
    <form action={syncQuarterTransactions}>
      <input type="hidden" name="quarterId" value={quarterId} />
      <SyncButton />
    </form>
  );
}
