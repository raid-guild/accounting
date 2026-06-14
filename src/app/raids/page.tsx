import {
  Archive,
  ArrowLeft,
  BarChart3,
  BriefcaseBusiness,
  CircleDollarSign,
  HandCoins,
  Plus,
  ReceiptText,
  RotateCcw,
  Save,
  Swords,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { and, desc, eq, inArray } from "drizzle-orm";

import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { ledgerEntries, quarters } from "@/db/schema";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import {
  listEntitiesByTypes,
  listRaids,
  type CoreEntityView,
  type RaidRelatedEntityType,
  type RaidView,
} from "@/lib/core-entities";
import {
  formatAccountingCurrency,
  getRaidAccountingOverview,
  type ClientRevenueSummary,
  type RaidAccountingSummary,
} from "@/lib/raid-accounting";
import {
  archiveRaid,
  archiveRaidEntity,
  createRaid,
  deleteRaid,
  deleteRaidEntity,
  removeRaidEntityAddress,
  restoreRaid,
  restoreRaidEntity,
  updateRaid,
  updateRaidEntity,
} from "@/app/raids/actions";
import {
  RaidAddressForm,
  RaidEntityCreateForm,
} from "@/app/raids/raid-management-forms";
import { RaidManagementToast } from "@/app/raids/raid-management-toast";
import { RemoveManualLedgerEntryForm } from "@/app/raids/remove-manual-revenue-form";
import { TransactionLookupPanel } from "@/app/raids/transaction-lookup-panel";
import { listManualLookupChains } from "@/lib/manual-transaction-lookup";
import type { ManualRaidLedgerKind } from "@/app/raids/transaction-lookup-actions";

type FormAction = (formData: FormData) => Promise<void>;
type RaidFlow = "client" | "raid" | "subcontractor";
type RaidModal = `add-${RaidFlow}`;
type ManualAccountingModal = `manual-${ManualRaidLedgerKind}`;
type TeamPayoutStatus = RaidAccountingSummary["status"];
type RaidToastError =
  | "client-has-raids"
  | "duplicate-address"
  | "invalid-address"
  | "invalid-chain"
  | "missing-address";
type RaidToastSubject = "address" | RaidFlow;
type ManualRaidLedgerEntryView = {
  assetAmount: string;
  assetSymbol: string;
  chainId: number | null;
  counterpartyEntityId: string | null;
  id: string;
  kind: ManualRaidLedgerKind;
  occurredAt: Date;
  quarterId: string;
  quarterLabel: string;
  quarterStatus: typeof quarters.$inferSelect.status;
  raidId: string | null;
  txHash: string | null;
  usdAmount: string;
};

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatUsdAmount(value: string) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(number);
}

function getEntityLabel(type: RaidRelatedEntityType) {
  return type === "client" ? "Client" : "Subcontractor";
}

function getAddModalHref(flow: RaidFlow) {
  return `/raids?modal=add-${flow}`;
}

function getManualAccountingModalHref(kind: ManualRaidLedgerKind) {
  return `/raids?modal=manual-${kind}`;
}

function getEntityHref(entityId: string) {
  return `/raids?entity=${entityId}`;
}

function getRaidHref(raidId: string) {
  return `/raids?raid=${raidId}`;
}

const TEAM_PAYOUT_STATUS_COPY: Record<
  TeamPayoutStatus,
  { label: string; tone: string }
> = {
  fully_paid: {
    label: "Fully Paid",
    tone: "border-emerald-600/25 bg-emerald-600/10 text-emerald-800",
  },
  no_revenue: {
    label: "No Revenue",
    tone: "border-border bg-muted text-muted-foreground",
  },
  overpaid: {
    label: "Overpaid",
    tone: "border-primary/25 bg-primary/10 text-primary",
  },
  payouts_pending: {
    label: "Payouts Pending",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-800",
  },
};

function TeamPayoutStatusBadge({ status }: { status: TeamPayoutStatus }) {
  const copy = TEAM_PAYOUT_STATUS_COPY[status];

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${copy.tone}`}
    >
      {copy.label}
    </span>
  );
}

async function listManualRaidLedgerEntries(
  raidId: string | null,
): Promise<ManualRaidLedgerEntryView[]> {
  if (!raidId) {
    return [];
  }

  const rows = await getDb()
    .select({
      assetAmount: ledgerEntries.assetAmount,
      assetSymbol: ledgerEntries.assetSymbol,
      chainId: ledgerEntries.chainId,
      category: ledgerEntries.category,
      counterpartyEntityId: ledgerEntries.counterpartyEntityId,
      id: ledgerEntries.id,
      occurredAt: ledgerEntries.occurredAt,
      quarterId: quarters.id,
      quarterLabel: quarters.label,
      quarterStatus: quarters.status,
      raidId: ledgerEntries.raidId,
      txHash: ledgerEntries.txHash,
      usdAmount: ledgerEntries.usdAmount,
    })
    .from(ledgerEntries)
    .innerJoin(quarters, eq(ledgerEntries.quarterId, quarters.id))
    .where(
      and(
        eq(ledgerEntries.source, "manual"),
        inArray(ledgerEntries.category, [
          "raid_revenue",
          "subcontractor_payout",
        ]),
        eq(ledgerEntries.raidId, raidId),
      ),
    )
    .orderBy(desc(ledgerEntries.occurredAt));

  return rows.map((row) => ({
    ...row,
    kind: row.category === "subcontractor_payout" ? "payout" : "revenue",
  }));
}

function TextInput({
  defaultValue,
  inputMode,
  label,
  name,
  pattern,
  placeholder,
  required,
  title,
}: {
  defaultValue?: string | null;
  inputMode?: "numeric";
  label: string;
  name: string;
  pattern?: string;
  placeholder?: string;
  required?: boolean;
  title?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="type-label-sm text-muted-foreground">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        inputMode={inputMode}
        pattern={pattern}
        placeholder={placeholder}
        required={required}
        title={title}
        className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
      />
    </label>
  );
}

function NotesField({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="type-label-sm text-muted-foreground">Notes</span>
      <textarea
        name="notes"
        defaultValue={defaultValue ?? ""}
        className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

function FlowButton({
  flow,
  icon,
  title,
}: {
  flow: RaidFlow;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Link
      href={getAddModalHref(flow)}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-sm transition-all hover:border-primary/40 hover:bg-muted"
    >
      {icon}
      {title}
      <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function FlowLauncher() {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="type-label-sm text-muted-foreground">Raid Records</p>
          <h2 className="text-lg font-semibold">Manage raid accounting</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <FlowButton
            flow="client"
            icon={<BriefcaseBusiness className="size-5" aria-hidden="true" />}
            title="Add Client"
          />
          <FlowButton
            flow="raid"
            icon={<Swords className="size-5" aria-hidden="true" />}
            title="Add Raid"
          />
          <FlowButton
            flow="subcontractor"
            icon={
              <CircleDollarSign className="size-5" aria-hidden="true" />
            }
            title="Add Subcontractor"
          />
          <Link
            href={getManualAccountingModalHref("revenue")}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-sm transition-all hover:border-primary/40 hover:bg-muted"
          >
            <ReceiptText className="size-5" aria-hidden="true" />
            Add Revenue
            <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
          <Link
            href={getManualAccountingModalHref("payout")}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-sm transition-all hover:border-primary/40 hover:bg-muted"
          >
            <HandCoins className="size-5" aria-hidden="true" />
            Add Payout
            <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function AccountingSectionHeader({
  countLabel,
  title,
}: {
  countLabel: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
          <BarChart3 className="size-5" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <span className="type-label-sm text-muted-foreground">{countLabel}</span>
    </div>
  );
}

function TopClientsTable({ clients }: { clients: ClientRevenueSummary[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <AccountingSectionHeader
        countLabel={`${clients.length} clients`}
        title="Top Clients By Revenue"
      />
      {clients.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">Client</th>
                <th className="px-3 py-3 text-right font-medium">Revenue</th>
                <th className="px-3 py-3 text-right font-medium">Raids</th>
                <th className="px-3 py-3 text-right font-medium">
                  Expected Spoils
                </th>
                <th className="px-3 py-3 text-right font-medium">
                  Team Pool
                </th>
                <th className="px-3 py-3 text-right font-medium">Payouts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map((client) => (
                <tr key={client.clientId}>
                  <td className="px-3 py-3 font-medium">
                    {client.clientName}
                  </td>
                  <td className="px-3 py-3 text-right font-medium">
                    {formatAccountingCurrency(client.revenueCents)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {client.raidCount}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatAccountingCurrency(client.expectedSpoilsCents)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatAccountingCurrency(client.expectedTeamPoolCents)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatAccountingCurrency(client.subcontractorPayoutCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
          No client revenue yet.
        </div>
      )}
    </section>
  );
}

function RaidAccountingTable({
  summaries,
}: {
  summaries: RaidAccountingSummary[];
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <AccountingSectionHeader
        countLabel={`${summaries.length} raids`}
        title="Raid Accounting"
      />
      {summaries.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">Client</th>
                <th className="px-3 py-3 font-medium">Raid</th>
                <th className="px-3 py-3 text-right font-medium">Revenue</th>
                <th className="px-3 py-3 text-right font-medium">
                  Expected Spoils
                </th>
                <th className="px-3 py-3 text-right font-medium">
                  Team Pool
                </th>
                <th className="px-3 py-3 text-right font-medium">Payouts</th>
                <th className="px-3 py-3 text-right font-medium">
                  Remaining
                </th>
                <th className="px-3 py-3 font-medium">Team Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summaries.map((summary) => (
                <tr key={summary.raidId}>
                  <td className="px-3 py-3 font-medium">
                    {summary.clientName}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{summary.raidName}</span>
                      {summary.isShipped ? (
                        <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                          Shipped
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-medium">
                    {formatAccountingCurrency(summary.revenueCents)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatAccountingCurrency(summary.expectedSpoilsCents)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatAccountingCurrency(summary.expectedTeamPoolCents)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatAccountingCurrency(summary.subcontractorPayoutCents)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatAccountingCurrency(summary.remainingPoolCents)}
                  </td>
                  <td className="px-3 py-3">
                    <TeamPayoutStatusBadge status={summary.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
          No raid accounting activity yet.
        </div>
      )}
    </section>
  );
}

function CreateEntityFlow({ type }: { type: RaidRelatedEntityType }) {
  const label = getEntityLabel(type);

  return (
    <div>
      <RaidEntityCreateForm label={label} type={type} />
    </div>
  );
}

function AddressList({
  entity,
  removeAction,
}: {
  entity: CoreEntityView;
  removeAction: FormAction;
}) {
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="type-label-sm text-muted-foreground">Addresses</p>
      {entity.addresses.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {entity.addresses.map((address) => (
            <div
              key={address.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-mono">{formatAddress(address.address)}</p>
                <p className="text-xs text-muted-foreground">
                  {address.label ? `${address.label} · ` : ""}
                  {address.chainId !== null
                    ? `Chain ${address.chainId}`
                    : "Any chain"}
                </p>
              </div>
              <form action={removeAction}>
                <input type="hidden" name="id" value={address.id} />
                <Button type="submit" variant="ghost" size="icon">
                  <Trash2 className="size-4" aria-hidden="true" />
                  <span className="sr-only">Remove address</span>
                </Button>
              </form>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No addresses yet.</p>
      )}
    </div>
  );
}

function AddAddressForm({ entityId }: { entityId: string }) {
  return (
    <details className="mt-4 overflow-hidden rounded-md border border-border bg-background">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium marker:text-muted-foreground">
        Add address
      </summary>
      <RaidAddressForm entityId={entityId} />
    </details>
  );
}

function EntityDetails({ entity }: { entity: CoreEntityView }) {
  const type = entity.type as RaidRelatedEntityType;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            {type === "client" ? (
              <BriefcaseBusiness className="size-5" aria-hidden="true" />
            ) : (
              <CircleDollarSign className="size-5" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <p className="type-label-sm text-muted-foreground">
              {getEntityLabel(type)}
            </p>
            <h3 className="truncate text-base font-semibold">{entity.name}</h3>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {type === "subcontractor" && entity.isMember ? (
            <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              Member
            </span>
          ) : null}
          {entity.archivedAt ? (
            <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              Archived
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <dt className="type-label-sm text-muted-foreground">Website</dt>
          <dd className="mt-1 text-sm font-medium">
            {entity.website || "Not recorded"}
          </dd>
        </div>
        <div>
          <dt className="type-label-sm text-muted-foreground">Address Count</dt>
          <dd className="mt-1 text-sm font-medium">
            {entity.addresses.length}
          </dd>
        </div>
      </dl>

      {entity.notes ? (
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          {entity.notes}
        </p>
      ) : null}

      <AddressList entity={entity} removeAction={removeRaidEntityAddress} />
      <AddAddressForm entityId={entity.id} />

      <details className="mt-4 rounded-md border border-border bg-background">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Edit
        </summary>
        <form action={updateRaidEntity} className="grid gap-4 px-4 pb-4">
          <input type="hidden" name="id" value={entity.id} />
          <input type="hidden" name="type" value={entity.type} />
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput label="Name" name="name" defaultValue={entity.name} required />
            <TextInput
              label="Website"
              name="website"
              defaultValue={entity.website}
            />
          </div>
          {type === "subcontractor" ? (
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="isMember"
                defaultChecked={entity.isMember}
                className="size-4 rounded border-input"
              />
              DAO member
            </label>
          ) : null}
          <NotesField defaultValue={entity.notes} />
          <div>
            <Button type="submit">
              <Save data-icon="inline-start" />
              Save
            </Button>
          </div>
        </form>
      </details>

      <form
        action={entity.archivedAt ? restoreRaidEntity : archiveRaidEntity}
        className="mt-3"
      >
        <input type="hidden" name="id" value={entity.id} />
        <Button
          type="submit"
          variant={entity.archivedAt ? "outline" : "destructive"}
          size="sm"
        >
          {entity.archivedAt ? (
            <RotateCcw data-icon="inline-start" />
          ) : (
            <Archive data-icon="inline-start" />
          )}
          {entity.archivedAt ? "Restore" : "Archive"}
        </Button>
      </form>

      {entity.archivedAt ? (
        <form action={deleteRaidEntity} className="mt-2">
          <input type="hidden" name="id" value={entity.id} />
          <input type="hidden" name="type" value={entity.type} />
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 data-icon="inline-start" />
            Permanently Delete
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function EntityRows({
  entities,
  emptyLabel,
  title,
}: {
  entities: CoreEntityView[];
  emptyLabel: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="type-label-sm text-muted-foreground">
          {entities.length} records
        </span>
      </div>
      {entities.length > 0 ? (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
          {entities.map((entity) => (
            <EntityRow key={entity.id} entity={entity} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

function EntityRow({ entity }: { entity: CoreEntityView }) {
  const type = entity.type as RaidRelatedEntityType;

  return (
    <Link
      href={getEntityHref(entity.id)}
      className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_9rem_7rem]"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{entity.name}</span>
          {entity.archivedAt ? (
            <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Archived
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {entity.website || getEntityLabel(type)}
        </p>
      </div>
      <div className="text-sm">
        <p className="type-label-sm text-muted-foreground">Addresses</p>
        <p className="font-medium">{entity.addresses.length}</p>
      </div>
      <div className="text-sm">
        <p className="type-label-sm text-muted-foreground">Type</p>
        <p className="font-medium">{getEntityLabel(type)}</p>
      </div>
    </Link>
  );
}

function CreateRaidFlow({ clients }: { clients: CoreEntityView[] }) {
  return (
    <form action={createRaid} className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput label="Name" name="name" required />
        <label className="grid gap-2 text-sm font-medium">
          <span className="type-label-sm text-muted-foreground">Client</span>
          <select
            name="clientEntityId"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            required
          >
            <option value="">Select client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <NotesField />
      <div>
        <Button type="submit" disabled={clients.length === 0}>
          <Save data-icon="inline-start" />
          Add Raid
        </Button>
        <Link
          href="/raids"
          className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function ManualRaidLedgerRows({
  entries,
  kind,
  counterparties,
}: {
  counterparties?: CoreEntityView[];
  entries: ManualRaidLedgerEntryView[];
  kind: ManualRaidLedgerKind;
}) {
  const title = kind === "payout" ? "Manual Payouts" : "Manual Revenue";
  const emptyLabel =
    kind === "payout"
      ? "No manual payouts saved for this raid yet."
      : "No manual revenue saved for this raid yet.";

  return (
    <section className="mt-4 border-t border-border pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="type-label-sm text-muted-foreground">
          {entries.length} entries
        </span>
      </div>
      {entries.length > 0 ? (
        <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background">
          {entries.map((entry) => {
            const counterparty = counterparties?.find(
              (entity) => entity.id === entry.counterpartyEntityId,
            );

            return (
            <div
              key={entry.id}
              className="grid gap-3 px-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_8rem_auto]"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {formatUsdAmount(entry.usdAmount)}
                </p>
                <p className="mt-1 truncate text-muted-foreground">
                  {entry.assetAmount} {entry.assetSymbol}
                  {entry.txHash ? ` · ${formatAddress(entry.txHash)}` : ""}
                </p>
                {counterparty ? (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {kind === "payout" ? "Paid to" : "Linked to"}{" "}
                    {counterparty.name}
                  </p>
                ) : null}
              </div>
              <div>
                <p className="type-label-sm text-muted-foreground">Quarter</p>
                <p className="font-medium">{entry.quarterLabel}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTimestamp(entry.occurredAt)}
                </p>
              </div>
              <div className="flex items-center md:justify-end">
                {entry.quarterStatus === "draft" ? (
                  <RemoveManualLedgerEntryForm
                    kind={entry.kind}
                    ledgerEntryId={entry.id}
                  />
                ) : (
                  <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                    Locked
                  </span>
                )}
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
          {emptyLabel}
        </p>
      )}
    </section>
  );
}

function RaidDetails({
  clients,
  ledgerEntries,
  raid,
  subcontractors,
}: {
  clients: CoreEntityView[];
  ledgerEntries: ManualRaidLedgerEntryView[];
  raid: RaidView;
  subcontractors: CoreEntityView[];
}) {
  const clientOptions = clients.some(
    (client) => client.id === raid.clientEntityId,
  )
    ? clients
    : [...clients, { ...raid.client, name: `${raid.client.name} (archived)` }];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="type-label-sm text-muted-foreground">Raid</p>
          <h3 className="text-base font-semibold">{raid.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Client: {raid.client.name}
          </p>
        </div>
        {raid.archivedAt ? (
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
            Archived
          </span>
        ) : null}
      </div>

      {raid.notes ? (
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          {raid.notes}
        </p>
      ) : null}

      <ManualRaidLedgerRows
        entries={ledgerEntries.filter((entry) => entry.kind === "revenue")}
        kind="revenue"
      />
      <ManualRaidLedgerRows
        counterparties={subcontractors}
        entries={ledgerEntries.filter((entry) => entry.kind === "payout")}
        kind="payout"
      />

      <details className="mt-4 rounded-md border border-border bg-background">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Edit
        </summary>
        <form action={updateRaid} className="grid gap-4 px-4 pb-4">
          <input type="hidden" name="id" value={raid.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput label="Name" name="name" defaultValue={raid.name} required />
            <label className="grid gap-2 text-sm font-medium">
              <span className="type-label-sm text-muted-foreground">Client</span>
              <select
                name="clientEntityId"
                defaultValue={raid.clientEntityId}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                required
              >
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <NotesField defaultValue={raid.notes} />
          <div>
            <Button type="submit">
              <Save data-icon="inline-start" />
              Save
            </Button>
          </div>
        </form>
      </details>

      <form
        action={raid.archivedAt ? restoreRaid : archiveRaid}
        className="mt-3"
      >
        <input type="hidden" name="id" value={raid.id} />
        <Button
          type="submit"
          variant={raid.archivedAt ? "outline" : "destructive"}
          size="sm"
        >
          {raid.archivedAt ? (
            <RotateCcw data-icon="inline-start" />
          ) : (
            <Archive data-icon="inline-start" />
          )}
          {raid.archivedAt ? "Restore" : "Archive"}
        </Button>
      </form>

      {raid.archivedAt ? (
        <form action={deleteRaid} className="mt-2">
          <input type="hidden" name="id" value={raid.id} />
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 data-icon="inline-start" />
            Permanently Delete
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function RaidRows({
  emptyLabel,
  raids,
  title,
}: {
  emptyLabel: string;
  raids: RaidView[];
  title: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="type-label-sm text-muted-foreground">
          {raids.length} raids
        </span>
      </div>
      {raids.length > 0 ? (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
          {raids.map((raid) => (
            <RaidRow key={raid.id} raid={raid} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

function RaidRow({ raid }: { raid: RaidView }) {
  return (
    <Link
      href={getRaidHref(raid.id)}
      className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.45fr)_7rem]"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{raid.name}</span>
          {raid.archivedAt ? (
            <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Shipped
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {raid.notes || "No notes recorded"}
        </p>
      </div>
      <div className="min-w-0 text-sm">
        <p className="type-label-sm text-muted-foreground">Client</p>
        <p className="truncate font-medium">{raid.client.name}</p>
      </div>
      <div className="text-sm">
        <p className="type-label-sm text-muted-foreground">Status</p>
        <p className="font-medium">{raid.archivedAt ? "Shipped" : "Active"}</p>
      </div>
    </Link>
  );
}

function parseFlow(value: string | string[] | undefined): RaidFlow | null {
  const flow = Array.isArray(value) ? value[0] : value;

  if (flow === "client" || flow === "raid" || flow === "subcontractor") {
    return flow;
  }

  return null;
}

function parseAddModal(value: string | string[] | undefined): RaidModal | null {
  const modal = Array.isArray(value) ? value[0] : value;

  if (
    modal === "add-client" ||
    modal === "add-raid" ||
    modal === "add-subcontractor"
  ) {
    return modal;
  }

  return null;
}

function parseManualAccountingModal(
  value: string | string[] | undefined,
): ManualAccountingModal | null {
  const modal = Array.isArray(value) ? value[0] : value;

  if (modal === "manual-revenue" || modal === "manual-payout") {
    return modal;
  }

  return null;
}

function parseId(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value;

  return id || null;
}

function parseToastSubject(
  value: string | string[] | undefined,
): RaidToastSubject | null {
  const subject = Array.isArray(value) ? value[0] : value;

  if (subject === "address") {
    return subject;
  }

  return parseFlow(subject);
}

function parseToastError(
  value: string | string[] | undefined,
): RaidToastError | null {
  const error = Array.isArray(value) ? value[0] : value;

  if (
    error === "duplicate-address" ||
    error === "invalid-address" ||
    error === "invalid-chain" ||
    error === "missing-address" ||
    error === "client-has-raids"
  ) {
    return error;
  }

  return null;
}

function ModalShell({
  children,
  eyebrow,
  icon,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(41,16,10,0.72)] px-4 py-6 backdrop-blur-sm">
      <Link
        href="/raids"
        aria-label="Close modal"
        className="absolute inset-0"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 max-h-[min(42rem,calc(100vh-3rem))] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-xl md:p-6"
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
              {icon}
            </div>
            <div className="min-w-0">
              <p className="type-label-sm text-muted-foreground">{eyebrow}</p>
              <h2 className="text-lg font-semibold">{title}</h2>
            </div>
          </div>
          <Link
            href="/raids"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            Close
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}

function ActiveModal({
  activeClients,
  addModal,
  entities,
  entityId,
  manualRaidLedgerEntries,
  manualModal,
  raidId,
  raids,
  lookupChains,
  activeSubcontractors,
  subcontractors,
}: {
  activeClients: CoreEntityView[];
  addModal: RaidModal | null;
  activeSubcontractors: CoreEntityView[];
  entities: CoreEntityView[];
  entityId: string | null;
  lookupChains: ReturnType<typeof listManualLookupChains>;
  manualRaidLedgerEntries: ManualRaidLedgerEntryView[];
  manualModal: ManualAccountingModal | null;
  raidId: string | null;
  raids: RaidView[];
  subcontractors: CoreEntityView[];
}) {
  if (manualModal) {
    const kind = manualModal === "manual-payout" ? "payout" : "revenue";

    return (
      <ModalShell
        eyebrow="Manual Raid Accounting"
        icon={
          kind === "payout" ? (
            <HandCoins className="size-5" aria-hidden="true" />
          ) : (
            <ReceiptText className="size-5" aria-hidden="true" />
          )
        }
        title={kind === "payout" ? "Add Raid Payout" : "Add Raid Revenue"}
      >
        <TransactionLookupPanel
          chains={lookupChains}
          kind={kind}
          raids={raids}
          subcontractors={activeSubcontractors}
        />
      </ModalShell>
    );
  }

  if (addModal === "add-client") {
    return (
      <ModalShell
        eyebrow="New Client"
        icon={<BriefcaseBusiness className="size-5" aria-hidden="true" />}
        title="Add Client"
      >
        <CreateEntityFlow type="client" />
      </ModalShell>
    );
  }

  if (addModal === "add-raid") {
    return (
      <ModalShell
        eyebrow="New Raid"
        icon={<Swords className="size-5" aria-hidden="true" />}
        title="Add Raid"
      >
        <CreateRaidFlow clients={activeClients} />
      </ModalShell>
    );
  }

  if (addModal === "add-subcontractor") {
    return (
      <ModalShell
        eyebrow="New Subcontractor"
        icon={<CircleDollarSign className="size-5" aria-hidden="true" />}
        title="Add Subcontractor"
      >
        <CreateEntityFlow type="subcontractor" />
      </ModalShell>
    );
  }

  const selectedEntity = entityId
    ? entities.find((entity) => entity.id === entityId)
    : null;

  if (selectedEntity) {
    const type = selectedEntity.type as RaidRelatedEntityType;

    return (
      <ModalShell
        eyebrow={getEntityLabel(type)}
        icon={
          type === "client" ? (
            <BriefcaseBusiness className="size-5" aria-hidden="true" />
          ) : (
            <CircleDollarSign className="size-5" aria-hidden="true" />
          )
        }
        title={selectedEntity.name}
      >
        <EntityDetails entity={selectedEntity} />
      </ModalShell>
    );
  }

  const selectedRaid = raidId ? raids.find((raid) => raid.id === raidId) : null;

  if (selectedRaid) {
    return (
      <ModalShell
        eyebrow="Raid"
        icon={<Swords className="size-5" aria-hidden="true" />}
        title={selectedRaid.name}
      >
        <RaidDetails
          clients={activeClients}
          ledgerEntries={manualRaidLedgerEntries.filter(
            (entry) => entry.raidId === selectedRaid.id,
          )}
          raid={selectedRaid}
          subcontractors={subcontractors}
        />
      </ModalShell>
    );
  }

  return null;
}

export default async function RaidsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    added?: string | string[];
    deleted?: string | string[];
    entity?: string | string[];
    error?: string | string[];
    flow?: string | string[];
    modal?: string | string[];
    raid?: string | string[];
  }>;
}) {
  const session = await getAuthSession();
  const sessionState = serializeSession(session);

  if (
    !sessionState.authenticated ||
    !sessionState.permissions?.canWriteRaidAccounting
  ) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <section className="container-custom py-10">
          <Link
            href="/"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
          >
            <ArrowLeft data-icon="inline-start" />
            Home
          </Link>
          <div className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm">
            <p className="type-label-sm text-muted-foreground">Raid Records</p>
            <h1 className="mt-2 text-2xl font-semibold">
              Raid accounting access required
            </h1>
          </div>
        </section>
      </main>
    );
  }

  const params = await searchParams;
  const flow = parseFlow(params?.flow);
  const addModal =
    parseAddModal(params?.modal) ?? (flow ? (`add-${flow}` as RaidModal) : null);
  const manualModal = parseManualAccountingModal(params?.modal);
  const entityId = parseId(params?.entity);
  const raidId = parseId(params?.raid);
  const [entities, raids, manualRaidLedgerEntries] = await Promise.all([
    listEntitiesByTypes(["client", "subcontractor"]),
    listRaids(),
    listManualRaidLedgerEntries(raidId),
  ]);
  const accountingOverview = await getRaidAccountingOverview(raids);
  const lookupChains = listManualLookupChains();
  const activeClients = entities.filter(
    (entity) => entity.type === "client" && !entity.archivedAt,
  );
  const subcontractors = entities.filter(
    (entity) => entity.type === "subcontractor",
  );
  const activeSubcontractors = entities.filter(
    (entity) => entity.type === "subcontractor" && !entity.archivedAt,
  );
  const archivedEntities = entities.filter((entity) => entity.archivedAt);
  const activeRaids = raids.filter((raid) => !raid.archivedAt);
  const archivedRaids = raids.filter((raid) => raid.archivedAt);
  const added = parseToastSubject(params?.added);
  const deleted = parseToastSubject(params?.deleted);
  const error = parseToastError(params?.error);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <RaidManagementToast
        added={added}
        deleted={deleted}
        error={error}
        flow={flow}
      />
      <header className="border-b border-moloch-800 bg-moloch-800 text-scroll-100">
        <div className="container-custom flex h-16 items-center justify-between gap-4">
          <div>
            <p className="type-label-sm text-scroll-200">Cleric</p>
            <h1 className="text-base font-semibold leading-none">
              Raid Management
            </h1>
          </div>
          <Link
            href="/"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
          >
            <ArrowLeft data-icon="inline-start" />
            Home
          </Link>
        </div>
      </header>

      <section className="container-custom grid gap-8 py-8 md:py-12">
        <FlowLauncher />
        <TopClientsTable clients={accountingOverview.clients} />
        <RaidAccountingTable summaries={accountingOverview.raids} />
        <RaidRows
          emptyLabel="No active raids yet."
          raids={activeRaids}
          title="Active raids"
        />
        <EntityRows
          emptyLabel="No active clients yet."
          entities={activeClients}
          title="Clients"
        />
        <EntityRows
          emptyLabel="No active subcontractors yet."
          entities={activeSubcontractors}
          title="Subcontractors"
        />
        <RaidRows
          emptyLabel="No archived raids."
          raids={archivedRaids}
          title="Archived raids"
        />
        <EntityRows
          emptyLabel="No archived clients or subcontractors."
          entities={archivedEntities}
          title="Archived entities"
        />
      </section>
      <ActiveModal
        activeClients={activeClients}
        addModal={addModal}
        activeSubcontractors={activeSubcontractors}
        entities={entities}
        entityId={entityId}
        lookupChains={lookupChains}
        manualRaidLedgerEntries={manualRaidLedgerEntries}
        manualModal={manualModal}
        raidId={raidId}
        raids={raids}
        subcontractors={subcontractors}
      />
    </main>
  );
}
