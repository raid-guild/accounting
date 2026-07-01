import {
  ArrowLeft,
  ExternalLink,
  Link as LinkIcon,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { createRip, deleteRip, updateRip } from "@/app/rips/actions";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import { listRipsWithTotals, type RipView } from "@/lib/rips";

type SearchParams = Promise<{
  created?: string;
  deleted?: string;
  error?: string;
  modal?: string;
  updated?: string;
}>;
type RipModal = "add-rip" | `rip-${string}`;

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCurrency(value: string) {
  const number = Number(value);

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

function getRipModalHref(modal: RipModal) {
  return `/rips?modal=${modal}`;
}

function parseRipModal(value: string | undefined) {
  if (value === "add-rip" || value?.startsWith("rip-")) {
    return value as RipModal;
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
        href="/rips"
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
            href="/rips"
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

function RipLauncher() {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="type-label-sm text-muted-foreground">RIPs</p>
          <h2 className="text-lg font-semibold">Track improvement proposals</h2>
        </div>
        <Link
          href={getRipModalHref("add-rip")}
          scroll={false}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-sm transition-all hover:border-primary/40 hover:bg-muted"
        >
          <LinkIcon className="size-5" aria-hidden="true" />
          Add RIP
          <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function CreateRipForm() {
  return (
    <form action={createRip} className="grid gap-4">
      <label className="grid gap-2 text-sm font-medium">
        <span className="type-label-sm text-muted-foreground">Title</span>
        <input
          name="title"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        <span className="type-label-sm text-muted-foreground">RIP URL</span>
        <input
          name="url"
          type="url"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          placeholder="https://..."
          required
        />
      </label>
      <div>
        <Button type="submit">
          <LinkIcon data-icon="inline-start" />
          Add RIP
        </Button>
      </div>
    </form>
  );
}

function RipEditForm({ rip }: { rip: RipView }) {
  return (
    <div>
      <form action={updateRip} className="grid gap-4">
        <input type="hidden" name="ripId" value={rip.id} />
        <label className="grid gap-2 text-sm font-medium">
          <span className="type-label-sm text-muted-foreground">Title</span>
          <input
            name="title"
            defaultValue={rip.title}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            required
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          <span className="type-label-sm text-muted-foreground">RIP URL</span>
          <input
            name="url"
            type="url"
            defaultValue={rip.url}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            required
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">
            <Save data-icon="inline-start" />
            Save RIP
          </Button>
          <a
            href={rip.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-all hover:bg-muted"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Open
          </a>
        </div>
      </form>
      <form action={deleteRip} className="mt-4 border-t border-border pt-4">
        <input type="hidden" name="ripId" value={rip.id} />
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={rip.entryCount > 0}
        >
          <Trash2 data-icon="inline-start" />
          Delete
        </Button>
      </form>
    </div>
  );
}

function RipTable({ rips }: { rips: RipView[] }) {
  if (rips.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
        No RIPs have been tracked yet.
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <LinkIcon className="size-5" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold">RIPs By Linked Spend</h2>
        </div>
        <span className="type-label-sm text-muted-foreground">
          {rips.length} RIP{rips.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="md:overflow-x-auto">
        <table className="mobile-card-table">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium">RIP</th>
              <th className="px-3 py-3 font-medium">Created</th>
              <th className="px-3 py-3 text-right font-medium">
                Linked Spend
              </th>
              <th className="px-3 py-3 text-right font-medium">Entries</th>
              <th className="px-3 py-3 text-right font-medium">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rips.map((rip) => {
              const href = getRipModalHref(`rip-${rip.id}`);

              return (
                <tr key={rip.id} className="transition-colors hover:bg-muted/50">
                  <td data-label="RIP" data-full="true" className="p-0">
                    <span className="sr-only">RIP: </span>
                    <Link
                      href={href}
                      scroll={false}
                      className="block font-medium md:px-3 md:py-3"
                    >
                      {rip.title}
                    </Link>
                  </td>
                  <td data-label="Created" className="p-0">
                    <span className="sr-only">Created: </span>
                    <Link
                      href={href}
                      scroll={false}
                      className="block text-muted-foreground md:px-3 md:py-3"
                    >
                      {formatTimestamp(rip.createdAt)}
                    </Link>
                  </td>
                  <td data-align="right" data-label="Linked Spend" className="p-0">
                    <span className="sr-only">Linked Spend: </span>
                    <Link
                      href={href}
                      scroll={false}
                      className="block md:px-3 md:py-3 md:text-right"
                    >
                      {formatCurrency(rip.totalUsd)}
                    </Link>
                  </td>
                  <td data-align="right" data-label="Entries" className="p-0">
                    <span className="sr-only">Entries: </span>
                    <Link
                      href={href}
                      scroll={false}
                      className="block text-muted-foreground md:px-3 md:py-3 md:text-right"
                    >
                      {rip.entryCount}
                    </Link>
                  </td>
                  <td data-align="right" data-label="Edit" className="p-0">
                    <span className="sr-only">Edit: </span>
                    <Link
                      href={href}
                      scroll={false}
                      className="flex justify-end md:px-3 md:py-3"
                    >
                      <span className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-all hover:bg-muted">
                        <Pencil className="size-3.5" aria-hidden="true" />
                        Edit
                      </span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function RipsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = serializeSession(await getAuthSession());
  const query = await searchParams;

  if (!session.authenticated || !session.permissions?.canAccess) {
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
            <p className="type-label-sm text-muted-foreground">RIPs</p>
            <h1 className="mt-2 text-2xl font-semibold">
              Member access required
            </h1>
          </div>
        </section>
      </main>
    );
  }

  const rips = await listRipsWithTotals();
  const modal = parseRipModal(query.modal);
  const selectedRip =
    modal?.startsWith("rip-")
      ? rips.find((rip) => rip.id === modal.slice(4))
      : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader initialSession={session} />

      <section className="container-custom py-8 md:py-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="type-label-sm text-muted-foreground">
              Member-created records
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              RIP links and tracked spend
            </h2>
          </div>
          <span className="type-label-sm text-muted-foreground">
            {rips.length} RIP{rips.length === 1 ? "" : "s"}
          </span>
        </div>

        {query.created === "1" ? (
          <div className="mb-5 rounded-lg border border-emerald-600/20 bg-emerald-600/10 p-4 text-sm font-medium text-emerald-800">
            RIP added.
          </div>
        ) : null}
        {query.updated === "1" ? (
          <div className="mb-5 rounded-lg border border-emerald-600/20 bg-emerald-600/10 p-4 text-sm font-medium text-emerald-800">
            RIP updated.
          </div>
        ) : null}
        {query.deleted === "1" ? (
          <div className="mb-5 rounded-lg border border-emerald-600/20 bg-emerald-600/10 p-4 text-sm font-medium text-emerald-800">
            RIP deleted.
          </div>
        ) : null}
        {query.error === "invalid" ? (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive">
            Add a title and a valid RIP URL.
          </div>
        ) : null}
        {query.error === "linked" ? (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive">
            RIPs with linked ledger entries cannot be deleted.
          </div>
        ) : null}
        {query.error === "missing" ? (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive">
            RIP not found.
          </div>
        ) : null}

        <div className="grid gap-8">
          <RipLauncher />
          <RipTable rips={rips} />
        </div>
      </section>
      {modal === "add-rip" ? (
        <ModalShell
          eyebrow="RIP"
          icon={<LinkIcon className="size-5" aria-hidden="true" />}
          title="Add RIP"
        >
          <CreateRipForm />
        </ModalShell>
      ) : null}
      {selectedRip ? (
        <ModalShell
          eyebrow="RIP"
          icon={<LinkIcon className="size-5" aria-hidden="true" />}
          title={selectedRip.title}
        >
          <RipEditForm rip={selectedRip} />
        </ModalShell>
      ) : null}
    </main>
  );
}
