import {
  Archive,
  ArrowLeft,
  BadgeCheck,
  Building2,
  RotateCcw,
  Save,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import {
  listEditableTreasuryAccounts,
  SUPPORTED_OPERATOR_CHAINS,
  type EditableTreasuryAccountType,
  type TreasuryAccountView,
} from "@/lib/treasury/accounts";
import {
  archiveTreasuryAccount,
  createTreasuryAccount,
  restoreTreasuryAccount,
  updateTreasuryAccount,
} from "@/app/admin/treasury-accounts/actions";

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getAccountTypeLabel(type: EditableTreasuryAccountType) {
  return type === "side_vault" ? "Side vault" : "Operator";
}

function AccountTypeSelect({
  defaultValue = "side_vault",
}: {
  defaultValue?: EditableTreasuryAccountType;
}) {
  return (
    <select
      name="type"
      defaultValue={defaultValue}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      required
    >
      <option value="side_vault">Side vault</option>
      <option value="operator">Operator</option>
    </select>
  );
}

function ChainSelect({ defaultValue }: { defaultValue: number }) {
  return (
    <select
      name="chainId"
      defaultValue={String(defaultValue)}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      required
    >
      {SUPPORTED_OPERATOR_CHAINS.map((chain) => (
        <option key={chain.id} value={chain.id}>
          {chain.name}
        </option>
      ))}
    </select>
  );
}

function TextInput({
  defaultValue,
  label,
  name,
  placeholder,
  required,
}: {
  defaultValue?: string;
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
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
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

function CreateAccountForm() {
  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
          <Wallet className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="type-label-sm text-muted-foreground">New Account</p>
          <h2 className="text-lg font-semibold">Add treasury account</h2>
        </div>
      </div>

      <form action={createTreasuryAccount} className="mt-6 grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput label="Name" name="name" required />
          <TextInput label="Address" name="address" required />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            <span className="type-label-sm text-muted-foreground">Type</span>
            <AccountTypeSelect />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            <span className="type-label-sm text-muted-foreground">Chain</span>
            <ChainSelect defaultValue={100} />
          </label>
        </div>
        <NotesField />
        <div>
          <Button type="submit">
            <Save data-icon="inline-start" />
            Add Account
          </Button>
        </div>
      </form>
    </section>
  );
}

function StatusBadge({ account }: { account: TreasuryAccountView }) {
  if (account.archivedAt) {
    return (
      <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
        Archived
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-md border border-emerald-600/20 bg-emerald-600/10 px-2 py-1 text-xs font-medium text-emerald-800">
      Active
    </span>
  );
}

function AccountCard({ account }: { account: TreasuryAccountView }) {
  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            {account.type === "side_vault" ? (
              <Building2 className="size-5" aria-hidden="true" />
            ) : (
              <Wallet className="size-5" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <p className="type-label-sm text-muted-foreground">
              {getAccountTypeLabel(account.type as EditableTreasuryAccountType)}
            </p>
            <h3 className="truncate text-base font-semibold">{account.name}</h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {account.isDaoControlled ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="size-3" aria-hidden="true" />
              DAO-controlled
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              <BadgeCheck className="size-3" aria-hidden="true" />
              Operator
            </span>
          )}
          <StatusBadge account={account} />
        </div>
      </div>

      <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <dt className="type-label-sm text-muted-foreground">Chain</dt>
          <dd className="mt-1 text-sm font-medium">{account.chainName}</dd>
        </div>
        <div>
          <dt className="type-label-sm text-muted-foreground">Address</dt>
          <dd className="mt-1 truncate font-mono text-sm">
            {formatAddress(account.address)}
          </dd>
        </div>
      </dl>

      {account.notes ? (
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          {account.notes}
        </p>
      ) : null}

      <details className="mt-5 rounded-md border border-border bg-background">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Edit
        </summary>
        <form action={updateTreasuryAccount} className="grid gap-4 px-4 pb-4">
          <input type="hidden" name="id" value={account.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput
              label="Name"
              name="name"
              defaultValue={account.name}
              required
            />
            <TextInput
              label="Address"
              name="address"
              defaultValue={account.address}
              required
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              <span className="type-label-sm text-muted-foreground">Type</span>
              <AccountTypeSelect
                defaultValue={account.type as EditableTreasuryAccountType}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              <span className="type-label-sm text-muted-foreground">Chain</span>
              <ChainSelect defaultValue={account.chainId} />
            </label>
          </div>
          <NotesField defaultValue={account.notes} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit">
              <Save data-icon="inline-start" />
              Save
            </Button>
          </div>
        </form>
      </details>

      <form
        action={
          account.archivedAt ? restoreTreasuryAccount : archiveTreasuryAccount
        }
        className="mt-3"
      >
        <input type="hidden" name="id" value={account.id} />
        <Button
          type="submit"
          variant={account.archivedAt ? "outline" : "destructive"}
          size="sm"
        >
          {account.archivedAt ? (
            <RotateCcw data-icon="inline-start" />
          ) : (
            <Archive data-icon="inline-start" />
          )}
          {account.archivedAt ? "Restore" : "Archive"}
        </Button>
      </form>
    </article>
  );
}

function AccountList({
  accounts,
  emptyLabel,
  title,
}: {
  accounts: TreasuryAccountView[];
  emptyLabel: string;
  title: string;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="type-label-sm text-muted-foreground">
          {accounts.length} accounts
        </span>
      </div>
      {accounts.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
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

export default async function TreasuryAccountsPage() {
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

  const accounts = await listEditableTreasuryAccounts();
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const archivedAccounts = accounts.filter((account) => account.archivedAt);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-moloch-800 bg-moloch-800 text-scroll-100">
        <div className="container-custom flex h-16 items-center justify-between gap-4">
          <div>
            <p className="type-label-sm text-scroll-200">Admin</p>
            <h1 className="text-base font-semibold leading-none">
              Treasury Accounts
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
        <CreateAccountForm />
        <AccountList
          accounts={activeAccounts}
          emptyLabel="No active side vaults or operators."
          title="Active accounts"
        />
        <AccountList
          accounts={archivedAccounts}
          emptyLabel="No archived side vaults or operators."
          title="Archived accounts"
        />
      </section>
    </main>
  );
}
