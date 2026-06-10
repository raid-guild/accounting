"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { syncQuarterTransactions } from "@/app/admin/quarters/[id]/transactions/actions";

const SYNC_STEPS = [
  "Syncing treasury...",
  "Fetching transfers...",
  "Matching proposals...",
  "Refreshing review...",
];

function SyncButton() {
  const { pending } = useFormStatus();
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!pending) {
      return;
    }

    const interval = window.setInterval(() => {
      setStepIndex((current) => (current + 1) % SYNC_STEPS.length);
    }, 2500);

    return () => window.clearInterval(interval);
  }, [pending]);

  return (
    <div className="w-56 max-w-full">
      <Button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        onClick={() => setStepIndex(0)}
        className="w-full"
      >
        <RefreshCw
          data-icon="inline-start"
          className={pending ? "animate-spin" : ""}
          aria-hidden="true"
        />
        {pending ? SYNC_STEPS[stepIndex] : "Sync Transactions"}
      </Button>
    </div>
  );
}

export function SyncTransactionsForm({ quarterId }: { quarterId: string }) {
  return (
    <form action={syncQuarterTransactions} className="shrink-0">
      <input type="hidden" name="quarterId" value={quarterId} />
      <SyncButton />
    </form>
  );
}
