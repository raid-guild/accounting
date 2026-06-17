"use client";

import { HandCoins, Save, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  createManualProviderExpense,
  type ManualProviderExpenseState,
} from "@/app/admin/quarters/[id]/transactions/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ClassificationEntityOption } from "@/lib/transaction-classification";

const INITIAL_STATE: ManualProviderExpenseState = {
  error: null,
  saved: false,
};

export function ManualProviderExpenseButton({
  defaultDate,
  defaultOccurredAt,
  providers,
  quarterId,
  sourceChainId,
  sourceTransferId,
  sourceTxHash,
}: {
  defaultDate: string;
  defaultOccurredAt: string;
  providers: ClassificationEntityOption[];
  quarterId: string;
  sourceChainId?: number | null;
  sourceTransferId?: string | null;
  sourceTxHash?: string | null;
}) {
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [state, action, pending] = useActionState(
    createManualProviderExpense,
    INITIAL_STATE,
  );
  const hasProviders = providers.length > 0;

  useEffect(() => {
    if (state.error) {
      showToast(state.error);
    }
  }, [state.error, showToast]);

  useEffect(() => {
    if (state.saved) {
      showToast("Provider expense added.");
      formRef.current?.reset();
      const timeoutId = window.setTimeout(() => setIsOpen(false), 0);

      return () => window.clearTimeout(timeoutId);
    }

    return undefined;
  }, [showToast, state.saved]);

  return (
    <>
      <div className="group/add-expense absolute left-1/2 top-full z-10 flex -translate-x-1/2 -translate-y-1/2 justify-center">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex h-7 min-w-7 items-center justify-center gap-0 overflow-hidden rounded-full border border-border bg-background px-0 text-xs font-medium text-muted-foreground shadow-sm transition-all hover:min-w-36 hover:gap-1.5 hover:border-primary/40 hover:px-3 hover:text-foreground focus-visible:min-w-36 focus-visible:gap-1.5 focus-visible:px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/add-expense:min-w-36 group-hover/add-expense:gap-1.5 group-hover/add-expense:px-3"
        >
          <span
            className="block translate-y-[-1px] text-lg font-normal leading-none"
            aria-hidden="true"
          >
            +
          </span>
          <span className="w-0 whitespace-nowrap opacity-0 transition-all group-hover/add-expense:w-24 group-hover/add-expense:opacity-100 group-focus-within/add-expense:w-24 group-focus-within/add-expense:opacity-100">
            Provider Expense
          </span>
        </button>
      </div>
      {isOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(41,16,10,0.72)] px-4 py-6 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close provider expense modal"
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 cursor-default"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add provider expense"
            className="relative z-10 max-h-[min(42rem,calc(100vh-3rem))] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-xl md:p-6"
          >
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                  <HandCoins className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="type-label-sm text-muted-foreground">
                    Manual Entry
                  </p>
                  <h2 className="text-lg font-semibold">
                    Add provider expense
                  </h2>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                <X data-icon="inline-start" />
                Close
              </Button>
            </div>

            <form ref={formRef} action={action} className="grid gap-4">
              <input type="hidden" name="quarterId" value={quarterId} />
              <input
                type="hidden"
                name="defaultOccurredAt"
                value={defaultOccurredAt}
              />
              {sourceChainId ? (
                <input
                  type="hidden"
                  name="sourceChainId"
                  value={sourceChainId}
                />
              ) : null}
              {sourceTransferId ? (
                <input
                  type="hidden"
                  name="sourceTransferId"
                  value={sourceTransferId}
                />
              ) : null}
              {sourceTxHash ? (
                <input
                  type="hidden"
                  name="sourceTxHash"
                  value={sourceTxHash}
                />
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  <span className="type-label-sm text-muted-foreground">
                    Provider
                  </span>
                  <select
                    name="providerId"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    disabled={!hasProviders}
                    required
                  >
                    <option value="">
                      {hasProviders
                        ? "Choose provider"
                        : "No providers available"}
                    </option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  <span className="type-label-sm text-muted-foreground">
                    Date
                  </span>
                  <input
                    name="occurredOn"
                    type="date"
                    defaultValue={defaultDate}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  <span className="type-label-sm text-muted-foreground">
                    USD Amount
                  </span>
                  <input
                    name="usdAmount"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  <span className="type-label-sm text-muted-foreground">
                    Asset
                  </span>
                  <input
                    name="assetSymbol"
                    defaultValue="USD"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm uppercase"
                    required
                  />
                </label>
              </div>
              <label className="grid gap-2 text-sm font-medium">
                <span className="type-label-sm text-muted-foreground">
                  Notes
                </span>
                <textarea
                  name="notes"
                  rows={3}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <div>
                <Button type="submit" disabled={!hasProviders || pending}>
                  <Save
                    data-icon="inline-start"
                    className={pending ? "animate-pulse" : ""}
                  />
                  {pending ? "Adding..." : "Add Provider Expense"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
