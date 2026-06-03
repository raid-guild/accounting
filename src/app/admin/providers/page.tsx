import {
  Archive,
  ArrowLeft,
  Building2,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
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

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
          <Building2 className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="type-label-sm text-muted-foreground">Provider</p>
          <h2 className="text-lg font-semibold">Add service provider</h2>
        </div>
      </div>

      <ProviderCreateForm />
    </section>
  );
}

function AddressList({ provider }: { provider: CoreEntityView }) {
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
                <p className="font-mono">{formatAddress(address.address)}</p>
                <p className="text-xs text-muted-foreground">
                  {address.label ? `${address.label} · ` : ""}
                  {address.chainId !== null
                    ? `Chain ${address.chainId}`
                    : "Any chain"}
                </p>
              </div>
              <form action={removeProviderAddress}>
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
    <details className="mt-4 rounded-md border border-border bg-background">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Add address
      </summary>
      <ProviderAddressForm entityId={entityId} />
    </details>
  );
}

function ProviderCard({ provider }: { provider: CoreEntityView }) {
  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Building2 className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="type-label-sm text-muted-foreground">Provider</p>
            <h3 className="truncate text-base font-semibold">
              {provider.name}
            </h3>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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

      <AddressList provider={provider} />
      <AddAddressForm entityId={provider.id} />

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

      {provider.archivedAt ? (
        <form action={deleteProvider} className="mt-2">
          <input type="hidden" name="id" value={provider.id} />
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 data-icon="inline-start" />
            Permanently Delete
          </Button>
        </form>
      ) : null}
    </article>
  );
}

function ProviderList({
  emptyLabel,
  providers,
  title,
}: {
  emptyLabel: string;
  providers: CoreEntityView[];
  title: string;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="type-label-sm text-muted-foreground">
          {providers.length} providers
        </span>
      </div>
      {providers.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
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
  }>;
}) {
  const session = await getAuthSession();
  const sessionState = serializeSession(session);

  if (!sessionState.authenticated || !sessionState.permissions?.canAdmin) {
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
  const params = await searchParams;
  const added = parseToastSubject(params?.added);
  const error = parseToastError(params?.error);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <ProviderManagementToast added={added} error={error} />
      <header className="border-b border-moloch-800 bg-moloch-800 text-scroll-100">
        <div className="container-custom flex h-16 items-center justify-between gap-4">
          <div>
            <p className="type-label-sm text-scroll-200">Admin</p>
            <h1 className="text-base font-semibold leading-none">Providers</h1>
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
        <CreateProviderForm />
        <ProviderList
          emptyLabel="No active service providers yet."
          providers={activeProviders}
          title="Active providers"
        />
        <ProviderList
          emptyLabel="No archived service providers."
          providers={archivedProviders}
          title="Archived providers"
        />
      </section>
    </main>
  );
}
