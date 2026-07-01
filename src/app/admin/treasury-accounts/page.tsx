import {
  Archive,
  ArrowLeft,
  BadgeCheck,
  Building2,
  Landmark,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { CopyableAddress } from "@/components/copyable-address";
import { Button } from "@/components/ui/button";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import { getTreasuryBalanceSnapshot } from "@/lib/treasury/balances";
import {
  DEFAULT_TREASURY_ACCOUNT_CHAIN_ID,
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

type AccountModal = "add-account" | `account-${string}`;

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

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getAccountTypeLabel(type: EditableTreasuryAccountType) {
  if (type === "side_vault") {
    return "Side vault";
  }

  if (type === "bank") {
    return "Bank";
  }

  return "Operator";
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
      <option value="bank">Bank</option>
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
    <form action={createTreasuryAccount} className="grid gap-4">
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
          <ChainSelect defaultValue={DEFAULT_TREASURY_ACCOUNT_CHAIN_ID} />
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
  );
}

function getAccountModalHref(modal: AccountModal) {
  return `/admin/treasury-accounts?modal=${modal}`;
}

function parseAccountModal(value: string | string[] | undefined) {
  const modal = Array.isArray(value) ? value[0] : value;

  if (modal === "add-account" || modal?.startsWith("account-")) {
    return modal as AccountModal;
  }

  return null;
}

function AccountLauncher({ canManage }: { canManage: boolean }) {
  if (!canManage) {
    return null;
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="type-label-sm text-muted-foreground">
            Treasury Accounts
          </p>
          <h2 className="text-lg font-semibold">Manage accounts</h2>
        </div>
        <Link
          href={getAccountModalHref("add-account")}
          scroll={false}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-sm transition-all hover:border-primary/40 hover:bg-muted"
        >
          <Wallet className="size-5" aria-hidden="true" />
          Add Account
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
        href="/admin/treasury-accounts"
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
            href="/admin/treasury-accounts"
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

function getAccountBalanceLabel({
  linkedBalance,
}: {
  linkedBalance: string | undefined;
}) {
  if (linkedBalance) {
    return formatCurrency(linkedBalance);
  }

  return "Not synced";
}

function AccountDetails({
  account,
  canManage,
}: {
  account: TreasuryAccountView;
  canManage: boolean;
}) {
  return (
    <div>
      <div className="flex flex-wrap justify-end gap-2">
          {account.isDaoControlled ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="size-3" aria-hidden="true" />
              DAO-controlled
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {account.type === "bank" ? (
                <Landmark className="size-3" aria-hidden="true" />
              ) : (
                <BadgeCheck className="size-3" aria-hidden="true" />
              )}
              {getAccountTypeLabel(account.type as EditableTreasuryAccountType)}
            </span>
          )}
          <StatusBadge account={account} />
      </div>

      <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <dt className="type-label-sm text-muted-foreground">Chain</dt>
          <dd className="mt-1 text-sm font-medium">{account.chainName}</dd>
        </div>
        <div>
          <dt className="type-label-sm text-muted-foreground">Address</dt>
          <dd className="mt-1 text-sm">
            <CopyableAddress address={account.address} />
          </dd>
        </div>
      </dl>

      {account.notes ? (
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          {account.notes}
        </p>
      ) : null}

      {canManage ? (
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
                <span className="type-label-sm text-muted-foreground">
                  Type
                </span>
                <AccountTypeSelect
                  defaultValue={account.type as EditableTreasuryAccountType}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                <span className="type-label-sm text-muted-foreground">
                  Chain
                </span>
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
      ) : null}

      {canManage ? (
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
      ) : null}
    </div>
  );
}

function AccountRankingTable({
  accounts,
  balancesByAccountId,
  emptyLabel,
  title,
}: {
  accounts: TreasuryAccountView[];
  balancesByAccountId: Map<string, string>;
  emptyLabel: string;
  title: string;
}) {
  const rankedAccounts = [...accounts].sort((left, right) => {
    if (left.archivedAt && !right.archivedAt) {
      return 1;
    }

    if (!left.archivedAt && right.archivedAt) {
      return -1;
    }

    const balanceDifference =
      Number(balancesByAccountId.get(right.id) ?? 0) -
      Number(balancesByAccountId.get(left.id) ?? 0);

    return balanceDifference || (
      left.type.localeCompare(right.type) ||
      left.chainName.localeCompare(right.chainName) ||
      left.name.localeCompare(right.name)
    );
  });

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Wallet className="size-5" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <span className="type-label-sm text-muted-foreground">
          {accounts.length} accounts
        </span>
      </div>
      {accounts.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-3 lg:p-0">
          <table className="mobile-card-table-lg">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">Account</th>
                <th className="px-3 py-3 text-right font-medium">Balance</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Chain</th>
                <th className="px-3 py-3 font-medium">Address</th>
                <th className="px-3 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rankedAccounts.map((account) => {
                const href = getAccountModalHref(`account-${account.id}`);
                const linkedBalance = balancesByAccountId.get(account.id);

                return (
                  <tr
                    key={account.id}
                    className="transition-colors hover:bg-muted/50"
                  >
                    <td data-label="Account" data-full="true" className="p-0">
                      <span className="sr-only">Account: </span>
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3 font-medium"
                      >
                        {account.name}
                      </Link>
                    </td>
                    <td data-align="right" data-label="Balance" className="p-0">
                      <span className="sr-only">Balance: </span>
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3 text-right font-medium"
                      >
                        {getAccountBalanceLabel({ linkedBalance })}
                      </Link>
                    </td>
                    <td data-label="Type" className="p-0">
                      <span className="sr-only">Type: </span>
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3"
                      >
                        {getAccountTypeLabel(
                          account.type as EditableTreasuryAccountType,
                        )}
                      </Link>
                    </td>
                    <td data-label="Chain" className="p-0">
                      <span className="sr-only">Chain: </span>
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3"
                      >
                        {account.chainName}
                      </Link>
                    </td>
                    <td data-label="Address" className="p-0">
                      <span className="sr-only">Address: </span>
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3 font-mono text-muted-foreground"
                      >
                        {formatAddress(account.address)}
                      </Link>
                    </td>
                    <td data-label="Status" className="p-0">
                      <span className="sr-only">Status: </span>
                      <Link
                        href={href}
                        scroll={false}
                        className="block px-3 py-3"
                      >
                        <StatusBadge account={account} />
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

export default async function TreasuryAccountsPage({
  searchParams,
}: {
  searchParams?: Promise<{
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

  const accounts = await listEditableTreasuryAccounts();
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const archivedAccounts = accounts.filter((account) => account.archivedAt);
  const balanceSnapshot = await getTreasuryBalanceSnapshot();
  const balancesByAccountId = new Map(
    balanceSnapshot.accounts.map((account) => [account.id, account.totalUsd]),
  );
  const canManage = Boolean(sessionState.permissions.canAdmin);
  const params = await searchParams;
  const modal = parseAccountModal(params?.modal);
  const selectedAccount =
    modal?.startsWith("account-")
      ? accounts.find((account) => account.id === modal.slice(8))
      : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader initialSession={sessionState} />

      <section className="container-custom grid gap-8 py-8 md:py-12">
        <AccountLauncher canManage={canManage} />
        <AccountRankingTable
          accounts={[...activeAccounts, ...archivedAccounts]}
          balancesByAccountId={balancesByAccountId}
          emptyLabel="No treasury accounts yet."
          title="Treasury Accounts"
        />
      </section>
      {canManage && modal === "add-account" ? (
        <ModalShell
          eyebrow="Treasury Account"
          icon={<Wallet className="size-5" aria-hidden="true" />}
          title="Add Account"
        >
          <CreateAccountForm />
        </ModalShell>
      ) : null}
      {selectedAccount ? (
        <ModalShell
          eyebrow={getAccountTypeLabel(
            selectedAccount.type as EditableTreasuryAccountType,
          )}
          icon={
            selectedAccount.type === "side_vault" ? (
              <Building2 className="size-5" aria-hidden="true" />
            ) : selectedAccount.type === "bank" ? (
              <Landmark className="size-5" aria-hidden="true" />
            ) : (
              <Wallet className="size-5" aria-hidden="true" />
            )
          }
          title={selectedAccount.name}
        >
          <AccountDetails account={selectedAccount} canManage={canManage} />
        </ModalShell>
      ) : null}
    </main>
  );
}
