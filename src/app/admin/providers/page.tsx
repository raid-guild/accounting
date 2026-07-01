import {
  Archive,
  ArrowLeft,
  Building2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { and, eq, inArray, sql } from "drizzle-orm";

import { AppHeader } from "@/components/app-header";
import { CopyableAddress } from "@/components/copyable-address";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import {
  listEntitiesByTypes,
  type CoreEntityView,
} from "@/lib/core-entities";
import {
  archiveProvider,
  deleteProvider,
  removeProviderAddress,
  restoreProvider,
  updateProvider,
} from "@/app/admin/providers/actions";
import {
  ProviderAddressForm,
  ProviderCreateForm,
} from "@/app/admin/providers/provider-management-forms";
import { ProviderManagementToast } from "@/app/admin/providers/provider-management-toast";

type ProviderToastError =
  | "duplicate-address"
  | "invalid-address"
  | "invalid-chain"
  | "missing-address";
type ProviderToastSubject = "address" | "provider";
type ProviderModal = "add-provider" | `provider-${string}`;
type ProviderSpendSummary = {
  entryCount: number;
  totalUsd: string;
};

function formatCurrency(value: string | number) {
  const number = typeof value === "number" ? value : Number(value);

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

async function getProviderSpendSummaries(providers: CoreEntityView[]) {
  if (providers.length === 0) {
    return new Map<string, ProviderSpendSummary>();
  }

  const rows = await getDb()
    .select({
      entryCount: sql<string>`count(${ledgerEntries.id})`,
      providerId: ledgerEntries.counterpartyEntityId,
      totalUsd: sql<string>`coalesce(sum(${ledgerEntries.usdAmount}), 0)`,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.category, "provider_expense"),
        inArray(
          ledgerEntries.counterpartyEntityId,
          providers.map((provider) => provider.id),
        ),
      ),
    )
    .groupBy(ledgerEntries.counterpartyEntityId);

  return new Map(
    rows
      .filter((row) => row.providerId)
      .map((row) => [
        row.providerId as string,
        {
          entryCount: Number(row.entryCount),
          totalUsd: row.totalUsd,
        },
      ]),
  );
}

function parseToastSubject(
  value: string | string[] | undefined,
): ProviderToastSubject | null {
  const subject = Array.isArray(value) ? value[0] : value;

  if (subject === "address" || subject === "provider") {
    return subject;
  }

  return null;
}

function parseToastError(
  value: string | string[] | undefined,
): ProviderToastError | null {
  const error = Array.isArray(value) ? value[0] : value;

  if (
    error === "duplicate-address" ||
    error === "invalid-address" ||
    error === "invalid-chain" ||
    error === "missing-address"
  ) {
    return error;
  }

  return null;
}

function TextInput({
  defaultValue,
  label,
  name,
  placeholder,
  required,
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="type-label-sm text-muted-foreground">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
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

function CreateProviderForm() {
  return <ProviderCreateForm />;
}

function getProviderModalHref(modal: ProviderModal) {
  return `/admin/providers?modal=${modal}`;
}

function parseProviderModal(value: string | string[] | undefined) {
  const modal = Array.isArray(value) ? value[0] : value;

  if (modal === "add-provider" || modal?.startsWith("provider-")) {
    return modal as ProviderModal;
  }

  return null;
}

function ProviderLauncher({ canManage }: { canManage: boolean }) {
  if (!canManage) {
    return null;
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="type-label-sm text-muted-foreground">Providers</p>
          <h2 className="text-lg font-semibold">Manage service providers</h2>
        </div>
        <Link
          href={getProviderModalHref("add-provider")}
          scroll={false}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-sm transition-all hover:border-primary/40 hover:bg-muted"
        >
          <Building2 className="size-5" aria-hidden="true" />
          Add Provider
          <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
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
        href="/admin/providers"
        scroll={false}
        aria-label="Close modal"
        className="absolute inset-0 cursor-default"
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
            href="/admin/providers"
            scroll={false}
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

function AddressList({
  canManage,
  provider,
}: {
  canManage: boolean;
  provider: CoreEntityView;
}) {
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="type-label-sm text-muted-foreground">Addresses</p>
      {provider.addresses.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {provider.addresses.map((address) => (
            <div
              key={address.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <CopyableAddress address={address.address} />
                <p className="text-xs text-muted-foreground">
                  {address.label ? `${address.label} · ` : ""}
                  {address.chainId !== null
                    ? `Chain ${address.chainId}`
                    : "Any chain"}
                </p>
              </div>
              {canManage ? (
                <form action={removeProviderAddress}>
                  <input type="hidden" name="id" value={address.id} />
                  <Button type="submit" variant="ghost" size="icon">
                    <Trash2 className="size-4" aria-hidden="true" />
                    <span className="sr-only">Remove address</span>
                  </Button>
                </form>
              ) : null}
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
    <details className="mt-4 rounded-md border border-border bg-background">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Add address
      </summary>
      <ProviderAddressForm entityId={entityId} />
    </details>
  );
}

function ProviderDetails({
  canManage,
  provider,
}: {
  canManage: boolean;
  provider: CoreEntityView;
}) {
  return (
    <div>
      <div className="flex flex-wrap justify-end gap-2">
          {provider.isMember ? (
            <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              Member
            </span>
          ) : null}
          {provider.archivedAt ? (
            <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              Archived
            </span>
          ) : null}
      </div>

      <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <dt className="type-label-sm text-muted-foreground">Website</dt>
          <dd className="mt-1 text-sm font-medium">
            {provider.website || "Not recorded"}
          </dd>
        </div>
        <div>
          <dt className="type-label-sm text-muted-foreground">Address Count</dt>
          <dd className="mt-1 text-sm font-medium">
            {provider.addresses.length}
          </dd>
        </div>
      </dl>

      {provider.notes ? (
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          {provider.notes}
        </p>
      ) : null}

      <AddressList canManage={canManage} provider={provider} />
      {canManage ? <AddAddressForm entityId={provider.id} /> : null}

      {canManage ? (
        <details className="mt-4 rounded-md border border-border bg-background">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Edit
          </summary>
          <form action={updateProvider} className="grid gap-4 px-4 pb-4">
            <input type="hidden" name="id" value={provider.id} />
            <input type="hidden" name="type" value="provider" />
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput
                label="Name"
                name="name"
                defaultValue={provider.name}
                required
              />
              <TextInput
                label="Website"
                name="website"
                defaultValue={provider.website}
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="isMember"
                defaultChecked={provider.isMember}
                className="size-4 rounded border-input"
              />
              DAO member
            </label>
            <NotesField defaultValue={provider.notes} />
            <div>
              <Button type="submit">
                <Save data-icon="inline-start" />
                Save
              </Button>
            </div>
          </form>
        </details>
      ) : null}

      {canManage ? (
        <form
          action={provider.archivedAt ? restoreProvider : archiveProvider}
          className="mt-3"
        >
          <input type="hidden" name="id" value={provider.id} />
          <Button
            type="submit"
            variant={provider.archivedAt ? "outline" : "destructive"}
            size="sm"
          >
            {provider.archivedAt ? (
              <RotateCcw data-icon="inline-start" />
            ) : (
              <Archive data-icon="inline-start" />
            )}
            {provider.archivedAt ? "Restore" : "Archive"}
          </Button>
        </form>
      ) : null}

      {canManage && provider.archivedAt ? (
        <form action={deleteProvider} className="mt-2">
          <input type="hidden" name="id" value={provider.id} />
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 data-icon="inline-start" />
            Permanently Delete
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function ProviderRankingTable({
  emptyLabel,
  providers,
  spendSummaries,
  title,
}: {
  emptyLabel: string;
  providers: CoreEntityView[];
  spendSummaries: Map<string, ProviderSpendSummary>;
  title: string;
}) {
  const rankedProviders = [...providers].sort((left, right) => {
    if (left.archivedAt && !right.archivedAt) {
      return 1;
    }

    if (!left.archivedAt && right.archivedAt) {
      return -1;
    }

    const spendDifference =
      Number(spendSummaries.get(right.id)?.totalUsd ?? 0) -
      Number(spendSummaries.get(left.id)?.totalUsd ?? 0);

    return spendDifference ||
      right.addresses.length - left.addresses.length ||
      left.name.localeCompare(right.name);
  });

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Building2 className="size-5" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <span className="type-label-sm text-muted-foreground">
          {providers.length} providers
        </span>
      </div>
      {providers.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-3 md:p-0">
          <table className="mobile-card-table">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">Provider</th>
                <th className="px-3 py-3 text-right font-medium">Spend</th>
                <th className="px-3 py-3 text-right font-medium">Entries</th>
                <th className="px-3 py-3 font-medium">Website</th>
                <th className="px-3 py-3 text-right font-medium">Addresses</th>
                <th className="px-3 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rankedProviders.map((provider) => {
                const href = getProviderModalHref(`provider-${provider.id}`);
                const spend = spendSummaries.get(provider.id);

                return (
                  <tr
                    key={provider.id}
                    className="transition-colors hover:bg-muted/50"
                  >
                    <td data-label="Provider" data-full="true" className="p-0">
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3 font-medium"
                      >
                        {provider.name}
                      </Link>
                    </td>
                    <td data-align="right" data-label="Spend" className="p-0">
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3 text-right font-medium"
                      >
                        {formatCurrency(spend?.totalUsd ?? "0")}
                      </Link>
                    </td>
                    <td data-align="right" data-label="Entries" className="p-0">
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3 text-right text-muted-foreground"
                      >
                        {spend?.entryCount ?? 0}
                      </Link>
                    </td>
                    <td data-label="Website" className="p-0">
                      <Link
                        href={href}
                        scroll={false}
                        className="block truncate px-3 py-3 text-muted-foreground"
                      >
                        {provider.website || "Not recorded"}
                      </Link>
                    </td>
                    <td data-align="right" data-label="Addresses" className="p-0">
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3 text-right"
                      >
                        {provider.addresses.length}
                      </Link>
                    </td>
                    <td data-label="Status" className="p-0">
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3"
                      >
                        {provider.archivedAt ? (
                          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                            Archived
                          </span>
                        ) : (
                          <span className="rounded-md border border-emerald-600/20 bg-emerald-600/10 px-2 py-1 text-xs font-medium text-emerald-800">
                            Active
                          </span>
                        )}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

export default async function ProvidersPage({
  searchParams,
}: {
  searchParams?: Promise<{
    added?: string | string[];
    error?: string | string[];
    modal?: string | string[];
  }>;
}) {
  const session = await getAuthSession();
  const sessionState = serializeSession(session);

  if (!sessionState.authenticated || !sessionState.permissions?.canAccess) {
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
            <p className="type-label-sm text-muted-foreground">Admin</p>
            <h1 className="mt-2 text-2xl font-semibold">
              Admin access required
            </h1>
          </div>
        </section>
      </main>
    );
  }

  const providers = await listEntitiesByTypes(["provider"]);
  const activeProviders = providers.filter((provider) => !provider.archivedAt);
  const archivedProviders = providers.filter((provider) => provider.archivedAt);
  const spendSummaries = await getProviderSpendSummaries(providers);
  const params = await searchParams;
  const added = parseToastSubject(params?.added);
  const error = parseToastError(params?.error);
  const modal = parseProviderModal(params?.modal);
  const canManage = Boolean(sessionState.permissions.canAdmin);
  const selectedProvider =
    modal?.startsWith("provider-")
      ? providers.find((provider) => provider.id === modal.slice(9))
      : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <ProviderManagementToast added={added} error={error} />
      <AppHeader initialSession={sessionState} />

      <section className="container-custom grid gap-8 py-8 md:py-12">
        <ProviderLauncher canManage={canManage} />
        <ProviderRankingTable
          emptyLabel="No service providers yet."
          providers={[...activeProviders, ...archivedProviders]}
          spendSummaries={spendSummaries}
          title="Providers By Spend"
        />
      </section>
      {canManage && modal === "add-provider" ? (
        <ModalShell
          eyebrow="Provider"
          icon={<Building2 className="size-5" aria-hidden="true" />}
          title="Add Provider"
        >
          <CreateProviderForm />
        </ModalShell>
      ) : null}
      {selectedProvider ? (
        <ModalShell
          eyebrow="Provider"
          icon={<Building2 className="size-5" aria-hidden="true" />}
          title={selectedProvider.name}
        >
          <ProviderDetails
            canManage={canManage}
            provider={selectedProvider}
          />
        </ModalShell>
      ) : null}
    </main>
  );
}
