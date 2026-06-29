"use client";

import { LockKeyhole, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import {
  type QuarterStatusFormState,
  updateQuarterStatusWithState,
} from "@/app/admin/quarters/actions";
import { Button } from "@/components/ui/button";

const INITIAL_STATE: QuarterStatusFormState = {
  error: null,
  saved: false,
};

export function PublishQuarterConfirmation({
  disabled,
  quarterId,
  quarterLabel,
}: {
  disabled: boolean;
  quarterId: string;
  quarterLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    updateQuarterStatusWithState,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (!state.saved) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setOpen(false), 0);

    return () => window.clearTimeout(timeoutId);
  }, [state.saved]);

  return (
    <>
      <Button
        type="button"
        variant="default"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <LockKeyhole data-icon="inline-start" />
        Publish Quarter
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid cursor-default place-items-center bg-[rgba(41,16,10,0.72)] px-4 py-6 backdrop-blur-sm"
          role="presentation"
        >
          <button
            type="button"
            aria-label="Close publish confirmation"
            className="absolute inset-0 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-quarter-title"
            className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-6 text-foreground shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                  <LockKeyhole className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="type-label-sm text-muted-foreground">
                    Publish Quarter
                  </p>
                  <h2 id="publish-quarter-title" className="text-xl font-semibold">
                    Publish {quarterLabel}?
                  </h2>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" />
                <span className="sr-only">Close</span>
              </Button>
            </div>

            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              Members will be able to view this quarter report and download the
              XLSX export. Further edits require reopening the quarter with a
              reason.
            </p>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <form action={action} className="contents">
                <input type="hidden" name="id" value={quarterId} />
                <input type="hidden" name="status" value="published" />
                <Button type="submit" variant="default" disabled={pending}>
                  <LockKeyhole data-icon="inline-start" />
                  {pending ? "Publishing..." : "Publish Quarter"}
                </Button>
              </form>
            </div>
            {state.error ? (
              <p
                className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
                aria-live="polite"
              >
                {state.error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
