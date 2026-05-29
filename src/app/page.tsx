import {
  ArrowRight,
  Coins,
  FileSpreadsheet,
  Landmark,
  LockKeyhole,
} from "lucide-react";
import Image from "next/image";

import { WalletConnect } from "@/components/auth/wallet-connect";
import { Button } from "@/components/ui/button";
import { getAuthSession, serializeSession } from "@/lib/auth/session";

const assets = [
  { symbol: "USDC", balance: "$0.00", tone: "bg-moloch-500" },
  { symbol: "xDAI", balance: "$0.00", tone: "bg-scroll-600" },
  { symbol: "wxDAI", balance: "$0.00", tone: "bg-neutral-600" },
  { symbol: "wETH", balance: "$0.00", tone: "bg-scroll-700" },
];

const milestones = [
  "Main Safe balances",
  "Quarter workspaces",
  "Manual raid flows",
  "Q1 XLSX export",
];

async function getSessionState() {
  try {
    const session = await getAuthSession();
    return serializeSession(session);
  } catch {
    return {
      address: null,
      authenticated: false,
      chainId: null,
      permissions: null,
    };
  }
}

function PublicHome() {
  return (
    <main className="min-h-screen bg-moloch-800 text-scroll-100">
      <section className="container-custom flex min-h-screen items-center py-10">
        <div className="grid w-full items-center gap-10 lg:grid-cols-[1fr_0.8fr]">
          <div className="max-w-3xl">
            <Image
              src="/raidguild-full-logo.svg"
              alt="RaidGuild"
              width={420}
              height={110}
              priority
              className="h-auto w-64 max-w-full"
            />
            <p className="mt-10 type-label text-scroll-300">
              Accounting Dashboard
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-normal text-scroll-100 md:text-6xl">
              Member access for treasury reporting.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-scroll-200">
              Connect a RaidGuild member wallet to view treasury balances and
              export-ready accounting records.
            </p>
          </div>

          <div className="rounded-lg border border-scroll-300/20 bg-moloch-700/60 p-6 shadow-2xl shadow-black/20">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <LockKeyhole className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="type-label-sm text-scroll-300">
                  Wallet Required
                </p>
                <h2 className="text-xl font-semibold text-scroll-100">
                  Sign in with Ethereum
                </h2>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-scroll-200">
              Access is checked against DAO shares, Angry Dwarf Hats, and
              database-managed Cleric permissions.
            </p>
            <div className="mt-6 flex justify-start">
              <WalletConnect />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function MemberHome() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-moloch-800 bg-moloch-800 text-scroll-100">
        <div className="container-custom flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Landmark className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="type-label-sm text-scroll-200">RaidGuild</p>
              <h1 className="text-base font-semibold leading-none">
                Accounting
              </h1>
            </div>
          </div>
          <WalletConnect />
        </div>
      </header>

      <section className="container-custom py-8 md:py-12">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="type-label text-muted-foreground">
                  Current Treasury Balance
                </p>
                <p className="mt-3 text-5xl font-semibold tracking-normal">
                  $0.00
                </p>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Member-visible balance breakdown for the main Safe and future
                  side-vaults. Real treasury data lands in the next ingestion
                  PRs.
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                Q1 2026 setup
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {assets.map((asset) => (
                <div
                  key={asset.symbol}
                  className="rounded-md border border-border bg-background p-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-2.5 rounded-full ${asset.tone}`}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium">{asset.symbol}</span>
                  </div>
                  <p className="mt-3 text-lg font-semibold">{asset.balance}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <LockKeyhole className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="type-label-sm text-muted-foreground">
                  Access Model
                </p>
                <h2 className="text-lg font-semibold">Wallet gated</h2>
              </div>
            </div>
            <div className="mt-6 space-y-4 text-sm leading-6 text-muted-foreground">
              <p>
                Members get read/export access after the DAO share check.
                Angry Dwarfs manage quarter publishing and admin settings.
              </p>
              <p>
                Clerics can add manual raid revenue, raid payouts, and spoils
                links once granted by an Angry Dwarf.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <Coins className="size-5 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold">Build sequence</h2>
            </div>
            <ol className="mt-5 space-y-3">
              {milestones.map((milestone, index) => (
                <li key={milestone} className="flex items-center gap-3">
                  <span className="flex size-7 items-center justify-center rounded-md border border-border bg-background text-sm font-medium">
                    {index + 1}
                  </span>
                  <span className="text-sm">{milestone}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <FileSpreadsheet
                  className="size-5 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <p className="type-label-sm text-muted-foreground">
                    First Export Target
                  </p>
                  <h2 className="text-lg font-semibold">Q1 2026 workbook</h2>
                </div>
              </div>
              <Button variant="outline" size="sm">
                View Spec
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {["Taxable Revenue", "P&L", "Full Ledger"].map((label) => (
                <div
                  key={label}
                  className="rounded-md border border-border bg-background px-4 py-3 text-sm font-medium"
                >
                  {label}
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

export default async function Home() {
  const session = await getSessionState();

  if (!session.authenticated) {
    return <PublicHome />;
  }

  return <MemberHome />;
}
