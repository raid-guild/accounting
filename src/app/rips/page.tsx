import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import { createRip, deleteRip, updateRip } from "@/app/rips/actions";
import { Button } from "@/components/ui/button";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import { listRipsWithTotals, type RipView } from "@/lib/rips";

type SearchParams = Promise<{
  created?: string;
  deleted?: string;
  error?: string;
  updated?: string;
}>;

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

function RipTable({ rips }: { rips: RipView[] }) {
  if (rips.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
        No RIPs have been tracked yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card text-sm shadow-sm">
      <div className="grid grid-cols-[1.4fr_1fr_1fr_0.5fr_1fr] gap-4 border-b border-border px-4 py-3 text-xs uppercase text-muted-foreground">
        <span className="font-medium">RIP</span>
        <span className="font-medium">Created</span>
        <span className="text-right font-medium">Linked Spend</span>
        <span className="text-right font-medium">Entries</span>
        <span className="text-right font-medium">Actions</span>
      </div>
      <div className="divide-y divide-border">
        {rips.map((rip) => (
          <details key={rip.id} className="group">
            <summary className="grid cursor-pointer list-none grid-cols-[1.4fr_1fr_1fr_0.5fr_1fr] items-center gap-4 px-4 py-4 marker:hidden">
              <span className="truncate font-medium">{rip.title}</span>
              <span className="text-muted-foreground">
                {formatTimestamp(rip.createdAt)}
              </span>
              <span className="text-right font-medium">
                {formatCurrency(rip.totalUsd)}
              </span>
              <span className="text-right text-muted-foreground">
                {rip.entryCount}
              </span>
              <span className="flex justify-end">
                <span className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all group-hover:bg-muted group-open:bg-muted">
                  <Pencil className="size-3.5" aria-hidden="true" />
                  Edit
                </span>
              </span>
            </summary>
            <div className="border-t border-border bg-background/60 px-4 py-4">
              <form
                action={updateRip}
                className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto]"
              >
                <input type="hidden" name="ripId" value={rip.id} />
                <label className="grid gap-2 text-sm font-medium">
                  <span className="type-label-sm text-muted-foreground">
                    Title
                  </span>
                  <input
                    name="title"
                    defaultValue={rip.title}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  <span className="type-label-sm text-muted-foreground">
                    RIP URL
                  </span>
                  <input
                    name="url"
                    type="url"
                    defaultValue={rip.url}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    required
                  />
                </label>
                <div className="flex items-end gap-2">
                  <Button type="submit" size="sm">
                    <Save data-icon="inline-start" />
                    Save RIP
                  </Button>
                  <a
                    href={rip.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    Open
                  </a>
                </div>
              </form>
              <form action={deleteRip} className="mt-3">
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
          </details>
        ))}
      </div>
    </div>
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-moloch-800 bg-moloch-800 text-scroll-100">
        <div className="container-custom flex min-h-16 items-center justify-between gap-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-scroll-100/10 text-scroll-100">
              <FileText className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="type-label-sm text-scroll-200">RIP Tracking</p>
              <h1 className="text-base font-semibold leading-none">
                Raid Improvement Proposals
              </h1>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-scroll-300/20 bg-scroll-100 px-2.5 text-sm font-medium text-moloch-800 transition-all hover:bg-scroll-200"
          >
            <ArrowLeft data-icon="inline-start" />
            Home
          </Link>
        </div>
      </header>

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

        <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <form
            action={createRip}
            className="self-start rounded-lg border border-border bg-card p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <Plus className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="type-label-sm text-muted-foreground">New RIP</p>
                <h3 className="text-lg font-semibold">Add RIP</h3>
              </div>
            </div>
            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm font-medium">
                <span className="type-label-sm text-muted-foreground">
                  Title
                </span>
                <input
                  name="title"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                <span className="type-label-sm text-muted-foreground">
                  RIP URL
                </span>
                <input
                  name="url"
                  type="url"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="https://..."
                  required
                />
              </label>
              <Button type="submit">
                <LinkIcon data-icon="inline-start" />
                Add RIP
              </Button>
            </div>
          </form>

          <RipTable rips={rips} />
        </div>
      </section>
    </main>
  );
}
