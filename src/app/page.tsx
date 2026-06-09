import { LockKeyhole } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { WalletConnect } from "@/components/auth/wallet-connect";
import { TreasuryDashboard } from "@/components/treasury/treasury-dashboard";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import {
  createFailedTreasuryBalanceSnapshot,
  getTreasuryBalanceSnapshot,
} from "@/lib/treasury/balances";
import type { TreasuryBalanceSnapshot } from "@/lib/treasury/types";
import { listPublishedQuarters, type QuarterSummary } from "@/lib/quarters";

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

type SessionState = Awaited<ReturnType<typeof getSessionState>>;

function AppNavLink({ children, href }: { children: string; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium text-scroll-200 transition-all hover:bg-scroll-100/10 hover:text-scroll-100"
    >
      {children}
    </Link>
  );
}

function PublicHome({ session }: { session: SessionState }) {
  return (
    <main className="min-h-screen bg-moloch-800 text-scroll-100">
      <section className="container-custom flex min-h-screen items-center py-10">
        <div className="grid w-full items-center gap-10 lg:grid-cols-[1fr_0.8fr]">
          <div className="max-w-3xl">
            {/* Keep the complementary dimension auto when className controls logo width. */}
            <Image
              src="/raidguild-full-logo.svg"
              alt="RaidGuild"
              width={420}
              height={110}
              priority
              className="h-auto w-64 max-w-full"
              style={{ height: "auto" }}
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
              <WalletConnect initialSession={session} />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function MemberHome({
  publishedQuarters,
  session,
  snapshot,
}: {
  publishedQuarters: QuarterSummary[];
  session: SessionState;
  snapshot: TreasuryBalanceSnapshot;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-moloch-800 bg-moloch-800 text-scroll-100">
        <div className="container-custom grid min-h-18 gap-3 py-3 lg:grid-cols-[auto_1fr] lg:items-center">
          <div className="flex min-w-0 items-center gap-3">
            {/* Keep the complementary dimension auto when className controls logo height. */}
            <Image
              src="/raidguild-full-logo.svg"
              alt="RaidGuild"
              width={120}
              height={32}
              className="h-8 w-auto shrink-0"
              style={{ width: "auto" }}
            />
            <div className="min-w-0">
              <p className="type-label-sm text-scroll-200">RaidGuild</p>
              <h1 className="text-base font-semibold leading-none">
                Accounting
              </h1>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-3 lg:justify-end">
            {session.permissions?.canWriteRaidAccounting ||
            session.permissions?.canAdmin ? (
              <nav
                className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-scroll-300/20 bg-moloch-900/35 p-1 shadow-inner shadow-black/10"
                aria-label="Accounting sections"
              >
                {session.permissions.canWriteRaidAccounting ? (
                  <AppNavLink href="/raids">Raids</AppNavLink>
                ) : null}
                {session.permissions.canAdmin ? (
                  <AppNavLink href="/admin/providers">Providers</AppNavLink>
                ) : null}
                {session.permissions.canAdmin ? (
                  <>
                    <AppNavLink href="/admin/quarters">Quarters</AppNavLink>
                    <AppNavLink href="/admin/treasury-accounts">
                      Accounts
                    </AppNavLink>
                  </>
                ) : null}
              </nav>
            ) : null}
            <WalletConnect initialSession={session} />
          </div>
        </div>
      </header>

      <TreasuryDashboard
        initialSnapshot={snapshot}
        publishedQuarters={publishedQuarters}
      />
    </main>
  );
}

export default async function Home() {
  const session = await getSessionState();

  if (!session.authenticated) {
    return <PublicHome session={session} />;
  }

  let snapshot: TreasuryBalanceSnapshot;
  let publishedQuarters: QuarterSummary[] = [];

  try {
    snapshot = await getTreasuryBalanceSnapshot();
  } catch (error) {
    console.error("Failed to load treasury balance snapshot", error);
    snapshot = createFailedTreasuryBalanceSnapshot(
      "Treasury balance cache unavailable",
    );
  }

  try {
    publishedQuarters = await listPublishedQuarters();
  } catch (error) {
    console.error("Failed to load published quarters", error);
  }

  return (
    <MemberHome
      publishedQuarters={publishedQuarters}
      session={session}
      snapshot={snapshot}
    />
  );
}
