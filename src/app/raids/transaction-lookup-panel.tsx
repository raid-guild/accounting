"use client";

import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  Search,
  Save,
  Trash2,
} from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";

import {
  fetchManualTransferUsdPrice,
  lookupRaidTransaction,
  removeManualRaidLedgerEntry,
  saveManualRaidPayout,
  saveManualRaidRevenue,
  type ManualRaidLedgerKind,
  type SavedManualRaidLedgerEntry,
  type TransactionLookupState,
} from "@/app/raids/transaction-lookup-actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { CoreEntityView, RaidView } from "@/lib/core-entities";
import type {
  ManualLookupChain,
  ManualLookupClassification,
  ManualLookupTransfer,
  ManualTransactionLookupResult,
} from "@/lib/manual-transaction-lookup";

const INITIAL_STATE: TransactionLookupState = {
  error: null,
  result: null,
  saved: false,
  savedEntry: null,
};

const REMOVE_INITIAL_STATE = {
  error: null,
  removed: false,
};

const CLASSIFICATION_COPY: Record<
  ManualLookupClassification,
  { label: string; tone: string }
> = {
  ambiguous: {
    label: "Ambiguous",
    tone: "border-border bg-muted text-muted-foreground",
  },
  possible_raid_payout: {
    label: "Possible raid payout",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-800",
  },
  possible_raid_revenue: {
    label: "Possible raid revenue",
    tone: "border-emerald-600/25 bg-emerald-600/10 text-emerald-800",
  },
};

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeAddress(address: string) {
  return address.toLowerCase();
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAmount(transfer: ManualLookupTransfer) {
  const number = Number(transfer.amount);
  const amount = Number.isFinite(number)
    ? new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 8,
        minimumFractionDigits: 0,
      }).format(number)
    : transfer.amount;

  return `${amount} ${transfer.assetSymbol}`;
}

function formatUsd(value: string | null) {
  if (!value) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(number);
}

function LookupSubmitButton({
  disabled,
  pending,
}: {
  disabled: boolean;
  pending: boolean;
}) {
  return (
    <Button type="submit" disabled={disabled || pending} aria-busy={pending}>
      <Search
        data-icon="inline-start"
        className={pending ? "animate-pulse" : ""}
      />
      {pending ? "Looking Up" : "Lookup Transaction"}
    </Button>
  );
}

function SaveSubmitButton({
  disabled,
  kind,
  pending,
}: {
  disabled: boolean;
  kind: ManualRaidLedgerKind;
  pending: boolean;
}) {
  return (
    <Button type="submit" disabled={disabled || pending} aria-busy={pending}>
      <Save
        data-icon="inline-start"
        className={pending ? "animate-pulse" : ""}
      />
      {pending
        ? "Saving..."
        : kind === "payout"
          ? "Save Raid Payout"
          : "Save Raid Revenue"}
    </Button>
  );
}

function RemoveEntryButton({
  disabled,
  kind,
  pending,
}: {
  disabled: boolean;
  kind: ManualRaidLedgerKind;
  pending: boolean;
}) {
  return (
    <Button
      type="submit"
      variant="destructive"
      size="sm"
      disabled={disabled || pending}
      aria-busy={pending}
    >
      <Trash2
        data-icon="inline-start"
        className={pending ? "animate-pulse" : ""}
      />
      {pending
        ? "Removing..."
        : kind === "payout"
          ? "Remove Payout"
          : "Remove Revenue"}
    </Button>
  );
}

function ClassificationBadge({
  classification,
}: {
  classification: ManualLookupClassification;
}) {
  const copy = CLASSIFICATION_COPY[classification];

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${copy.tone}`}
    >
      {copy.label}
    </span>
  );
}

function TransferRow({ transfer }: { transfer: ManualLookupTransfer }) {
  const usdAmount = formatUsd(transfer.usdAmount);

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{formatAmount(transfer)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {transfer.transferType === "native"
              ? "Native transfer"
              : "ERC20 transfer"}
            {transfer.tokenAddress
              ? ` · ${formatAddress(transfer.tokenAddress)}`
              : ""}
          </p>
        </div>
        {usdAmount ? (
          <span className="rounded-md border border-emerald-600/20 bg-emerald-600/10 px-2 py-1 text-xs font-medium text-emerald-800">
            {usdAmount}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <span className="font-mono">{formatAddress(transfer.fromAddress)}</span>
        <ArrowRight
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="font-mono">{formatAddress(transfer.toAddress)}</span>
      </div>
    </div>
  );
}

function SavedLedgerEntryPanel({
  savedEntry,
}: {
  savedEntry: SavedManualRaidLedgerEntry;
}) {
  const { showToast } = useToast();
  const [removeState, removeAction, removePending] = useActionState(
    removeManualRaidLedgerEntry,
    REMOVE_INITIAL_STATE,
  );
  const label = savedEntry.kind === "payout" ? "Payout" : "Revenue";

  useEffect(() => {
    if (removeState.removed) {
      showToast(`Raid ${savedEntry.kind} removed.`);
    }
  }, [removeState.removed, savedEntry.kind, showToast]);

  if (removeState.removed) {
    return (
      <div className="rounded-md border border-border bg-background px-4 py-3 text-sm font-medium text-muted-foreground">
        {label} removed from the quarter ledger.
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-md border border-emerald-600/20 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-900">
      <div>
        <p className="font-medium">{label} saved to the quarter ledger.</p>
        <p className="mt-1 text-emerald-900/80">
          Saved to {savedEntry.quarterLabel}.
        </p>
      </div>
      {savedEntry.canRemove ? (
        <form action={removeAction}>
          <input type="hidden" name="ledgerEntryId" value={savedEntry.id} />
          <input type="hidden" name="kind" value={savedEntry.kind} />
          <RemoveEntryButton
            disabled={false}
            kind={savedEntry.kind}
            pending={removePending}
          />
        </form>
      ) : (
        <p className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-amber-900">
          {label} can only be removed while the quarter is draft.
        </p>
      )}
      {removeState.error ? (
        <div className="flex gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{removeState.error}</p>
        </div>
      ) : null}
    </div>
  );
}

function ManualEntrySaveForm({
  kind,
  onSaved,
  raids,
  result,
  subcontractors,
}: {
  kind: ManualRaidLedgerKind;
  onSaved: (savedEntry: SavedManualRaidLedgerEntry) => void;
  raids: RaidView[];
  result: ManualTransactionLookupResult;
  subcontractors: CoreEntityView[];
}) {
  const { showToast } = useToast();
  const [revenueState, revenueAction, revenuePending] = useActionState(
    saveManualRaidRevenue,
    INITIAL_STATE,
  );
  const [payoutState, payoutAction, payoutPending] = useActionState(
    saveManualRaidPayout,
    INITIAL_STATE,
  );
  const [selectedTransferIndex, setSelectedTransferIndex] = useState("0");
  const [selectedSubcontractorId, setSelectedSubcontractorId] = useState("");
  const [usdAmount, setUsdAmount] = useState(
    result.transfers[0]?.usdAmount ?? "",
  );
  const [priceMessage, setPriceMessage] = useState<string | null>(null);
  const [pricePending, startPriceTransition] = useTransition();
  const saveState = kind === "payout" ? payoutState : revenueState;
  const saveAction = kind === "payout" ? payoutAction : revenueAction;
  const savePending = kind === "payout" ? payoutPending : revenuePending;
  const selectedTransfer = result.transfers[Number(selectedTransferIndex)];
  const hasTransfers = result.transfers.length > 0;
  const hasRaids = raids.length > 0;
  const hasSubcontractors = subcontractors.length > 0;
  const matchedSubcontractor =
    kind === "payout" && selectedTransfer
      ? subcontractors.find((subcontractor) =>
          subcontractor.addresses.some(
            (address) =>
              normalizeAddress(address.address) ===
              normalizeAddress(selectedTransfer.toAddress),
          ),
        )
      : null;

  useEffect(() => {
    if (saveState.savedEntry) {
      showToast(`Raid ${saveState.savedEntry.kind} saved.`);
      onSaved(saveState.savedEntry);
    }
  }, [onSaved, saveState.savedEntry, showToast]);

  function fetchSelectedTransferPrice() {
    setPriceMessage(null);

    startPriceTransition(async () => {
      const pricing = await fetchManualTransferUsdPrice({
        chainId: result.chainId,
        transferIndex: selectedTransferIndex,
        txHash: result.txHash,
      });

      if (pricing.error || !pricing.usdAmount) {
        setPriceMessage(pricing.error ?? "Historical price unavailable.");
        return;
      }

      setUsdAmount(pricing.usdAmount);
      setPriceMessage(
        pricing.priceSource === "stable_1_to_1"
          ? "Filled from 1:1 stablecoin pricing."
          : `Fetched historical price: $${pricing.priceUsd}.`,
      );
    });
  }

  return (
    <form
      action={saveAction}
      className="grid gap-4 rounded-md border border-border bg-background p-4"
    >
      <input type="hidden" name="chainId" value={result.chainId} />
      <input type="hidden" name="txHash" value={result.txHash} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          <span className="type-label-sm text-muted-foreground">
            {kind === "payout" ? "Payout Transfer" : "Revenue Transfer"}
          </span>
          <select
            name="transferIndex"
            value={selectedTransferIndex}
            onChange={(event) => {
              const nextIndex = event.target.value;
              const nextTransfer = result.transfers[Number(nextIndex)];

              setSelectedTransferIndex(nextIndex);
              setSelectedSubcontractorId("");
              setUsdAmount(nextTransfer?.usdAmount ?? "");
              setPriceMessage(null);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            disabled={!hasTransfers}
            required
          >
            {result.transfers.map((transfer, index) => (
              <option key={index} value={index}>
                {formatAmount(transfer)} from{" "}
                {formatAddress(transfer.fromAddress)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          <span className="type-label-sm text-muted-foreground">Raid</span>
          <select
            name="raidId"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            disabled={!hasRaids}
            required
          >
            <option value="">
              {hasRaids ? "Choose raid" : "No raids available"}
            </option>
            {raids.map((raid) => (
              <option key={raid.id} value={raid.id}>
                {raid.name} · {raid.client.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind === "payout" ? (
        <label className="grid gap-2 text-sm font-medium">
          <span className="type-label-sm text-muted-foreground">
            Subcontractor
          </span>
          {matchedSubcontractor ? (
            <input
              type="hidden"
              name="subcontractorId"
              value={matchedSubcontractor.id}
            />
          ) : null}
          <select
            name="subcontractorId"
            value={matchedSubcontractor?.id ?? selectedSubcontractorId}
            onChange={(event) => setSelectedSubcontractorId(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            disabled={!hasSubcontractors || Boolean(matchedSubcontractor)}
            required
          >
            <option value="">
              {hasSubcontractors
                ? "Choose subcontractor"
                : "No subcontractors available"}
            </option>
            {subcontractors.map((subcontractor) => (
              <option key={subcontractor.id} value={subcontractor.id}>
                {subcontractor.name}
              </option>
            ))}
          </select>
          {matchedSubcontractor ? (
            <p className="text-xs font-normal text-muted-foreground">
              Matched from recipient address{" "}
              {formatAddress(selectedTransfer.toAddress)}.
            </p>
          ) : null}
        </label>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2 text-sm font-medium">
          <span className="type-label-sm text-muted-foreground">
            USD Amount
          </span>
          <div className="flex flex-wrap gap-2">
            <input
              name="usdAmount"
              value={usdAmount}
              onChange={(event) => {
                setUsdAmount(event.target.value);
                setPriceMessage(null);
              }}
              inputMode="decimal"
              placeholder="0.00"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              required
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchSelectedTransferPrice}
              disabled={!selectedTransfer || pricePending}
              aria-busy={pricePending}
            >
              <RefreshCw
                data-icon="inline-start"
                className={pricePending ? "animate-spin" : ""}
              />
              {pricePending ? "Fetching" : "Fetch Price"}
            </Button>
          </div>
          {priceMessage ? (
            <p className="text-xs font-normal text-muted-foreground">
              {priceMessage}
            </p>
          ) : null}
        </div>
        <div className="rounded-md border border-border bg-card p-3 text-sm">
          <p className="type-label-sm text-muted-foreground">
            Selected Receipt
          </p>
          <p className="mt-1 font-medium">
            {selectedTransfer ? formatAmount(selectedTransfer) : "-"}
          </p>
        </div>
      </div>
      <label className="grid gap-2 text-sm font-medium">
        <span className="type-label-sm text-muted-foreground">Notes</span>
        <textarea
          name="notes"
          className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      {saveState.error ? (
        <div className="flex gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{saveState.error}</p>
        </div>
      ) : null}
      <div>
        <SaveSubmitButton
          disabled={
            !hasTransfers ||
            !hasRaids ||
            (kind === "payout" && !hasSubcontractors)
          }
          kind={kind}
          pending={savePending}
        />
      </div>
    </form>
  );
}

export function TransactionLookupPanel({
  chains,
  kind,
  raids,
  subcontractors,
}: {
  chains: ManualLookupChain[];
  kind: ManualRaidLedgerKind;
  raids: RaidView[];
  subcontractors: CoreEntityView[];
}) {
  const [lookupState, lookupAction, lookupPending] = useActionState(
    lookupRaidTransaction,
    INITIAL_STATE,
  );
  const hasChains = chains.length > 0;
  const result = lookupState.result;
  const [savedEntry, setSavedEntry] =
    useState<SavedManualRaidLedgerEntry | null>(null);

  return (
    <section className="grid gap-5">
      {result ? (
        <div className="flex justify-end">
          <ClassificationBadge classification={result.classification} />
        </div>
      ) : null}

      <form
        action={lookupAction}
        onSubmit={() => setSavedEntry(null)}
        className="grid gap-4 md:grid-cols-[180px_1fr_auto]"
      >
        <label className="grid gap-2 text-sm font-medium">
          <span className="type-label-sm text-muted-foreground">Chain</span>
          <select
            name="chainId"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={chains[0]?.id ?? ""}
            disabled={!hasChains}
            required
          >
            {!hasChains ? (
              <option value="" disabled>
                No chains available
              </option>
            ) : null}
            {chains.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          <span className="type-label-sm text-muted-foreground">
            Transaction Hash
          </span>
          <input
            name="txHash"
            placeholder="0x..."
            pattern="^0x[a-fA-F0-9]{64}$"
            title="Enter a valid transaction hash"
            className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 font-mono text-sm"
            required
          />
        </label>
        <div className="flex items-end">
          <LookupSubmitButton disabled={!hasChains} pending={lookupPending} />
        </div>
      </form>

      {lookupState.error ? (
        <div className="mt-4 flex gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{lookupState.error}</p>
        </div>
      ) : null}

      {savedEntry ? (
        <div className="border-t border-border pt-5">
          <SavedLedgerEntryPanel savedEntry={savedEntry} />
        </div>
      ) : result ? (
        <div className="grid gap-4 border-t border-border pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="type-label-sm text-muted-foreground">
                {result.chainName} · block {result.blockNumber}
              </p>
              <h3 className="mt-1 text-base font-semibold">
                {formatTimestamp(result.executedAt)}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Status: {result.status}
              </p>
            </div>
            <a
              href={result.blockExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-all hover:bg-muted"
            >
              Explorer
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border bg-background p-3">
              <p className="type-label-sm text-muted-foreground">Sender</p>
              <p className="mt-1 font-mono text-sm">
                {formatAddress(result.fromAddress)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <p className="type-label-sm text-muted-foreground">Recipient</p>
              <p className="mt-1 font-mono text-sm">
                {result.toAddress
                  ? formatAddress(result.toAddress)
                  : "Contract creation"}
              </p>
            </div>
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Transfers</h3>
              <span className="type-label-sm text-muted-foreground">
                {result.transfers.length} found
              </span>
            </div>
            {result.transfers.length > 0 ? (
              <div className="grid gap-3">
                {result.transfers.map((transfer, index) => (
                  <TransferRow key={index} transfer={transfer} />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
                No token or native value transfers detected in this transaction.
              </div>
            )}
          </div>

          <ManualEntrySaveForm
            key={`${kind}:${result.chainId}:${result.txHash}`}
            kind={kind}
            onSaved={setSavedEntry}
            raids={raids}
            result={result}
            subcontractors={subcontractors}
          />
        </div>
      ) : null}
    </section>
  );
}
