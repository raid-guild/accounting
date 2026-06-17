import { LockKeyhole } from "lucide-react";
import Image from "next/image";

import { AppHeader } from "@/components/app-header";
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
              RaidGuild accounting, for members.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-scroll-200">
              Connect your wallet to view treasury balances and quarter reports.
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
              Use a RaidGuild wallet to continue.
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
      <AppHeader initialSession={session} />
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
