import {
  ArrowLeft,
  AlertTriangle,
  BadgeCheck,
  CircleDollarSign,
  Pencil,
  ExternalLink,
  FileText,
  Save,
  Tags,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { classifyQuarterTransfer } from "@/app/admin/quarters/[id]/transactions/actions";
import { QuarterWorkflowProgress } from "@/components/quarters/quarter-workflow-progress";
import { SyncTransactionsForm } from "@/app/admin/quarters/[id]/transactions/sync-transactions-form";
import { TransactionReviewToast } from "@/app/admin/quarters/[id]/transactions/transaction-review-toast";
import { UsdAmountField } from "@/app/admin/quarters/[id]/transactions/usd-amount-field";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import {
  getQuarterClassificationSummary,
  listQuarters,
  type QuarterSummary,
} from "@/lib/quarters";
import {
  buildQuarterWorkflowSteps,
  getQuarterSyncStatus,
} from "@/lib/quarter-sync";
import {
  getCategoryLabel,
  IMPORTED_TRANSFER_CLASSIFICATION_CATEGORIES,
  listClassificationOptions,
  listTreasuryTransferClassifications,
  type ClassificationEntityOption,
  type ClassificationOptions,
  type LedgerCategory,
  type TreasuryTransferDaoProposal,
  type TreasuryTransferClassificationView,
} from "@/lib/transaction-classification";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{
  classified?: string;
  classifiedId?: string;
  errors?: string;
  imported?: string;
  proposals?: string;
  syncId?: string;
  synced?: string;
}>;

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function getTransactionExplorerUrl({
  chainId,
  txHash,
}: {
  chainId: number;
  txHash: string;
}) {
  if (chainId === 100) {
    return `https://gnosisscan.io/tx/${txHash}`;
  }

  if (chainId === 1) {
    return `https://etherscan.io/tx/${txHash}`;
  }

  if (chainId === 8453) {
    return `https://basescan.org/tx/${txHash}`;
  }

  return null;
}

function formatCurrency(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value));
}

function formatUsdAmount(value: string) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : "";
}

function isStableAssetSymbol(symbol: string) {
  return ["USDC", "XDAI", "WXDAI"].includes(symbol.toUpperCase());
}

function getDefaultUsdAmount(transfer: TreasuryTransferClassificationView) {
  if (transfer.usdAmount) {
    return transfer.usdAmount;
  }

  if (isStableAssetSymbol(transfer.assetSymbol)) {
    return formatUsdAmount(transfer.assetAmount);
  }

  return "";
}

function formatTokenAmount(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");

  if (!trimmedFraction) {
    return whole;
  }

  if (trimmedFraction.length <= 8) {
    return `${whole}.${trimmedFraction}`;
  }

  return `${whole}.${trimmedFraction.slice(0, 8)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getQueryNumber(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) {
    return 0;
  }

  return Number(value);
}

function getCounterpartyAddress(transfer: TreasuryTransferClassificationView) {
  if (transfer.direction === "inflow") {
    return transfer.fromAddress;
  }

  if (transfer.direction === "outflow") {
    return transfer.toAddress;
  }

  return transfer.toAddress;
}

function getCounterpartyLabel(transfer: TreasuryTransferClassificationView) {
  if (transfer.direction === "inflow") {
    return transfer.fromLabel;
  }

  if (transfer.direction === "outflow") {
    return transfer.toLabel;
  }

  return transfer.toLabel;
}

function getDirectionLabel(
  direction: TreasuryTransferClassificationView["direction"],
) {
  if (direction === "inflow") {
    return "Inflow";
  }

  if (direction === "outflow") {
    return "Outflow";
  }

  return "Internal";
}

function getEntityTypeLabel(type: ClassificationEntityOption["type"]) {
  if (type === "client") {
    return "Client";
  }

  if (type === "provider") {
    return "Provider";
  }

  return "Subcontractor";
}

function CategorySelect({ defaultValue }: { defaultValue: LedgerCategory | null }) {
  return (
    <select
      name="category"
      defaultValue={defaultValue ?? ""}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      required
    >
      <option value="">Choose category</option>
      {IMPORTED_TRANSFER_CLASSIFICATION_CATEGORIES.map((category) => (
        <option key={category} value={category}>
          {getCategoryLabel(category)}
        </option>
      ))}
    </select>
  );
}

function EntitySelect({
  defaultValue,
  entities,
}: {
  defaultValue: string | null;
  entities: ClassificationOptions["entities"];
}) {
  return (
    <select
      name="counterpartyEntityId"
      defaultValue={defaultValue ?? ""}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
    >
      <option value="">No entity link</option>
      {entities.map((entity) => (
        <option key={entity.id} value={entity.id}>
          {entity.label} ({getEntityTypeLabel(entity.type)})
        </option>
      ))}
    </select>
  );
}

function RaidSelect({
  defaultValue,
  raids,
}: {
  defaultValue: string | null;
  raids: ClassificationOptions["raids"];
}) {
  return (
    <select
      name="raidId"
      defaultValue={defaultValue ?? ""}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
    >
      <option value="">No raid link</option>
      {raids.map((raid) => (
        <option key={raid.id} value={raid.id}>
          {raid.name} ({raid.clientName})
        </option>
      ))}
    </select>
  );
}

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="type-label-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ProposalTitleLink({
  proposal,
}: {
  proposal: TreasuryTransferDaoProposal;
}) {
  return (
    <a
      href={proposal.daohausUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1 font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
    >
      <span className="truncate">{proposal.title}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">Open DAO proposal</span>
    </a>
  );
}

function ProposalInline({
  proposal,
}: {
  proposal: TreasuryTransferDaoProposal | null;
}) {
  if (!proposal) {
    return null;
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <FileText className="size-3 shrink-0 text-primary" aria-hidden="true" />
      <span>Proposal:</span>
      <ProposalTitleLink proposal={proposal} />
    </span>
  );
}

function ProposalContext({
  proposal,
}: {
  proposal: TreasuryTransferDaoProposal | null;
}) {
  if (!proposal) {
    return null;
  }

  return (
    <div className="mt-5 border-t border-border pt-4 text-sm">
      <div className="flex min-w-0 items-start gap-3">
        <FileText
          className="mt-0.5 size-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="type-label-sm text-muted-foreground">DAO Proposal</p>
          <div className="mt-1 flex min-w-0">
            <ProposalTitleLink proposal={proposal} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Proposal {proposal.proposalNumber ?? proposal.proposalId}
          </p>
        </div>
      </div>
    </div>
  );
}

function ClassificationForm({
  counterpartyAddress,
  counterpartyLabel,
  defaultCategory,
  isTreasuryCounterparty,
  options,
  quarter,
  transfer,
  usdAmount,
}: {
  counterpartyAddress: string;
  counterpartyLabel: string | null;
  defaultCategory: LedgerCategory | null;
  isTreasuryCounterparty: boolean;
  options: ClassificationOptions;
  quarter: QuarterSummary;
  transfer: TreasuryTransferClassificationView;
  usdAmount: string;
}) {
  return (
    <form action={classifyQuarterTransfer} className="grid gap-4">
      <input type="hidden" name="quarterId" value={quarter.id} />
      <input type="hidden" name="transferId" value={transfer.transferId} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Category">
          {isTreasuryCounterparty ? (
            <div className="flex h-9 items-center rounded-md border border-border bg-secondary px-3 text-sm font-medium text-secondary-foreground">
              Treasury Transfer
              <input type="hidden" name="category" value="treasury_transfer" />
            </div>
          ) : (
            <CategorySelect defaultValue={defaultCategory} />
          )}
        </Field>
        <Field label="USD Amount">
          <UsdAmountField
            defaultValue={usdAmount}
            transferId={transfer.transferId}
          />
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Counterparty">
          {isTreasuryCounterparty ? (
            <div className="flex h-9 items-center rounded-md border border-border bg-secondary px-3 text-sm text-secondary-foreground">
              <span className="font-medium">{counterpartyLabel}</span>
              <span className="ml-2 font-mono text-muted-foreground">
                {formatAddress(counterpartyAddress)}
              </span>
              <input type="hidden" name="counterpartyEntityId" value="" />
            </div>
          ) : (
            <EntitySelect
              defaultValue={transfer.counterpartyEntityId}
              entities={options.entities}
            />
          )}
        </Field>
        <Field label="Raid">
          {isTreasuryCounterparty ? (
            <div className="flex h-9 items-center rounded-md border border-border bg-secondary px-3 text-sm text-muted-foreground">
              Not needed for treasury transfers
              <input type="hidden" name="raidId" value="" />
            </div>
          ) : (
            <RaidSelect defaultValue={transfer.raidId} raids={options.raids} />
          )}
        </Field>
      </div>
      <Field label="Notes">
        <textarea
          name="notes"
          defaultValue={transfer.notes ?? ""}
          className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </Field>
      <div>
        <Button type="submit">
          <Save data-icon="inline-start" />
          Save Classification
        </Button>
      </div>
    </form>
  );
}

function TransferCard({
  options,
  quarter,
  transfer,
}: {
  options: ClassificationOptions;
  quarter: QuarterSummary;
  transfer: TreasuryTransferClassificationView;
}) {
  const usdAmount = getDefaultUsdAmount(transfer);
  const counterpartyAddress = getCounterpartyAddress(transfer);
  const counterpartyLabel = getCounterpartyLabel(transfer);
  const isTreasuryCounterparty = Boolean(counterpartyLabel);
  const defaultCategory =
    transfer.category ?? (isTreasuryCounterparty ? "treasury_transfer" : null);
  const transactionExplorerUrl = getTransactionExplorerUrl({
    chainId: transfer.chainId,
    txHash: transfer.txHash,
  });
  const linkedEntity = options.entities.find(
    (entity) => entity.id === transfer.counterpartyEntityId,
  );
  const linkedRaid = options.raids.find((raid) => raid.id === transfer.raidId);

  if (transfer.ledgerEntryId && transfer.category) {
    return (
      <article className="rounded-lg border border-emerald-600/20 bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-600/20 bg-emerald-600/10 px-2 py-1 text-xs font-medium text-emerald-800">
                <BadgeCheck className="size-3" aria-hidden="true" />
                Classified
              </span>
              <span className="inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
                {getDirectionLabel(transfer.direction)}
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {getCategoryLabel(transfer.category)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold">
                {formatTokenAmount(transfer.assetAmount)}{" "}
                {transfer.assetSymbol}
                {usdAmount ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatCurrency(usdAmount)}
                  </span>
                ) : null}
              </h2>
              <p className="text-xs text-muted-foreground">
                {transfer.accountName} · {formatTimestamp(transfer.executedAt)}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {linkedEntity ? (
                <span>
                  {getEntityTypeLabel(linkedEntity.type)}:{" "}
                  <span className="font-medium text-foreground">
                    {linkedEntity.label}
                  </span>
                </span>
              ) : null}
              {linkedRaid ? (
                <span>
                  Raid:{" "}
                  <span className="font-medium text-foreground">
                    {linkedRaid.name}
                  </span>
                </span>
              ) : null}
              <span>
                Counterparty:{" "}
                <span className="font-mono text-foreground">
                  {counterpartyLabel ? `${counterpartyLabel} ` : ""}
                  {formatAddress(counterpartyAddress)}
                </span>
              </span>
              <ProposalInline proposal={transfer.daoProposal} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {transactionExplorerUrl ? (
              <a
                href={transactionExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {formatHash(transfer.txHash)}
                <ExternalLink className="size-3" aria-hidden="true" />
                <span className="sr-only">Open transaction explorer</span>
              </a>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">
                {formatHash(transfer.txHash)}
              </span>
            )}
          </div>
        </div>
        <details className="group mt-3 border-t border-border pt-3">
          <summary className="inline-flex h-8 cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground marker:hidden">
            <Pencil className="size-3" aria-hidden="true" />
            Edit
          </summary>
          <div className="mt-4 rounded-md border border-border bg-background/60 p-4">
            <ClassificationForm
              counterpartyAddress={counterpartyAddress}
              counterpartyLabel={counterpartyLabel}
              defaultCategory={defaultCategory}
              isTreasuryCounterparty={isTreasuryCounterparty}
              options={options}
              quarter={quarter}
              transfer={transfer}
              usdAmount={usdAmount}
            />
          </div>
        </details>
      </article>
    );
  }

  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
              {getDirectionLabel(transfer.direction)}
            </span>
            {transfer.ledgerEntryId ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-600/20 bg-emerald-600/10 px-2 py-1 text-xs font-medium text-emerald-800">
                <BadgeCheck className="size-3" aria-hidden="true" />
                Classified
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                Needs classification
              </span>
            )}
          </div>
          <h2 className="mt-3 text-lg font-semibold">
            {formatTokenAmount(transfer.assetAmount)} {transfer.assetSymbol}
            {usdAmount ? (
              <span className="text-muted-foreground">
                {" "}
                · {formatCurrency(usdAmount)}
              </span>
            ) : null}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {transfer.accountName} · {formatTimestamp(transfer.executedAt)}
          </p>
        </div>
        <div className="text-right text-sm">
          {counterpartyLabel ? (
            <p className="font-medium">{counterpartyLabel}</p>
          ) : null}
          <p className="font-mono">{formatAddress(counterpartyAddress)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Counterparty</p>
        </div>
      </div>

      <dl className="mt-5 grid gap-4 border-t border-border pt-4 text-sm md:grid-cols-3">
        <div>
          <dt className="type-label-sm text-muted-foreground">Account</dt>
          <dd className="mt-1">
            <span className="font-medium">{transfer.accountName}</span>
            <span className="ml-2 font-mono text-muted-foreground">
              {formatAddress(transfer.accountAddress)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="type-label-sm text-muted-foreground">Tx Hash</dt>
          <dd className="mt-1">
            {transactionExplorerUrl ? (
              <a
                href={transactionExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 font-mono text-primary transition-colors hover:text-primary/80 hover:underline"
              >
                <span className="truncate">{formatHash(transfer.txHash)}</span>
                <ExternalLink className="size-3" aria-hidden="true" />
                <span className="sr-only">Open transaction explorer</span>
              </a>
            ) : (
              <span className="font-mono">{formatHash(transfer.txHash)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="type-label-sm text-muted-foreground">Chain</dt>
          <dd className="mt-1 font-medium">{transfer.chainId}</dd>
        </div>
      </dl>

      <ProposalContext proposal={transfer.daoProposal} />

      <div className="mt-5 border-t border-border pt-5">
        <ClassificationForm
          counterpartyAddress={counterpartyAddress}
          counterpartyLabel={counterpartyLabel}
          defaultCategory={defaultCategory}
          isTreasuryCounterparty={isTreasuryCounterparty}
          options={options}
          quarter={quarter}
          transfer={transfer}
          usdAmount={usdAmount}
        />
      </div>
    </article>
  );
}

function AdminGate() {
  return (
    <main className="container-custom py-10">
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Admin access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect an Angry Dwarf wallet to review quarter transactions.
        </p>
        <Link
          href="/admin/quarters"
          className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Back to Quarters
        </Link>
      </div>
    </main>
  );
}

export default async function QuarterTransactionsPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const session = serializeSession(await getAuthSession());

  if (!session.authenticated || !session.permissions?.canAdmin) {
    return <AdminGate />;
  }

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const quarter = (await listQuarters()).find((item) => item.id === id);

  if (!quarter) {
    return (
      <main className="container-custom py-10">
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Quarter not found</h1>
          <Link
            href="/admin/quarters"
            className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to Quarters
          </Link>
        </div>
      </main>
    );
  }

  const [options, transfers, summary, quarterSyncStatus] = await Promise.all([
    listClassificationOptions(),
    listTreasuryTransferClassifications({
      quarter,
      status: "all",
    }),
    getQuarterClassificationSummary(quarter),
    getQuarterSyncStatus(quarter.id),
  ]);
  const toastSyncStatus =
    query.synced === "1"
      ? "complete"
      : query.synced === "partial"
        ? "partial"
        : null;
  const syncErrorCount = getQueryNumber(query.errors);
  const syncImportedCount = getQueryNumber(query.imported);
  const proposalMatchCount = getQueryNumber(query.proposals);
  const workflowSteps = buildQuarterWorkflowSteps({
    classificationSummary: summary,
    quarter,
    syncStatus: quarterSyncStatus,
  });
  const syncComplete =
    workflowSteps.find((step) => step.key === "sync")?.status === "complete";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <TransactionReviewToast
        classifiedId={query.classifiedId ?? null}
        proposalMatchCount={proposalMatchCount}
        saved={query.classified === "1"}
        syncErrorCount={syncErrorCount}
        syncId={query.syncId ?? null}
        syncImportedCount={syncImportedCount}
        syncStatus={toastSyncStatus}
      />
      <section className="container-custom py-8 md:py-10">
        <div className="mb-6 grid gap-5">
          <div>
            <Link
              href="/admin/quarters"
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Quarters
            </Link>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <Tags className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="type-label-sm text-muted-foreground">
                  {formatDate(quarter.startsOn)} - {formatDate(quarter.endsOn)}
                </p>
                <h1 className="text-2xl font-semibold">
                  {quarter.label} Transaction Review
                </h1>
              </div>
            </div>
          </div>
          <div className="grid gap-4 rounded-lg border border-border bg-card p-4 shadow-sm lg:grid-cols-[minmax(180px,240px)_1fr]">
            <div className="flex items-center justify-between gap-4 lg:justify-start">
              <div className="flex items-center gap-3">
                <CircleDollarSign
                  className="size-5 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <p className="type-label-sm text-muted-foreground">
                    Classified
                  </p>
                  <p className="text-lg font-semibold">
                    {summary.classifiedTransfers} / {summary.totalTransfers}
                  </p>
                </div>
              </div>
            </div>
            <SyncTransactionsForm
              initialSyncStatus={quarterSyncStatus}
              syncComplete={syncComplete}
              quarterId={quarter.id}
            />
          </div>
          <QuarterWorkflowProgress steps={workflowSteps} />
        </div>

        {summary.unclassifiedTransfers > 0 ? (
          <div className="mb-5 rounded-lg border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
            {summary.unclassifiedTransfers} transaction
            {summary.unclassifiedTransfers === 1 ? "" : "s"} still need
            classification before this quarter can be published.
          </div>
        ) : null}

        {toastSyncStatus === "partial" ? (
          <div className="mb-5 flex gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">Some accounts failed to sync.</p>
              <p className="mt-1 text-destructive/80">
                {syncErrorCount} account
                {syncErrorCount === 1 ? "" : "s"} returned errors. The sync
                imported {syncImportedCount} new transfer
                {syncImportedCount === 1 ? "" : "s"} from the accounts that
                completed.
              </p>
            </div>
          </div>
        ) : null}

        <section className="grid gap-4">
          {transfers.length > 0 ? (
            transfers.map((transfer) => (
              <TransferCard
                key={transfer.transferId}
                options={options}
                quarter={quarter}
                transfer={transfer}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
              No imported treasury transfers found for this quarter.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
