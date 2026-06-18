"use client";

import { ChevronDown, LogOut, ShieldCheck, UserCircle, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { SiweMessage } from "siwe";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignMessage,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { AuthPermissions } from "@/lib/auth/types";

type SessionResponse = {
  address: string | null;
  authenticated: boolean;
  canUseMemberView?: boolean;
  chainId: number | null;
  permissions: AuthPermissions | null;
  viewMode?: "admin" | "member";
};

type WalletConnectProps = {
  initialSession?: SessionResponse;
};

const emptySession: SessionResponse = {
  address: null,
  authenticated: false,
  canUseMemberView: false,
  chainId: null,
  permissions: null,
  viewMode: "admin",
};

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getFriendlyError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Wallet sign-in failed";
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("user rejected") ||
    lowerMessage.includes("user denied") ||
    lowerMessage.includes("rejected the request")
  ) {
    return "Request cancelled.";
  }

  if (lowerMessage.includes("no wallet connector")) {
    return "No injected wallet found.";
  }

  if (lowerMessage.includes("chain id")) {
    return "Could not detect the connected chain.";
  }

  if (lowerMessage.includes("session configuration")) {
    return "Session setup is missing.";
  }

  if (lowerMessage.includes("session lookup")) {
    return "Session lookup failed.";
  }

  if (lowerMessage.includes("nonce generation")) {
    return "Could not start wallet sign-in.";
  }

  if (lowerMessage.includes("logout")) {
    return "Sign out failed.";
  }

  if (lowerMessage.includes("gnosis_rpc_url")) {
    return "Gnosis RPC URL is missing.";
  }

  if (lowerMessage.includes("dao_contract_address")) {
    return "DAO contract address is missing.";
  }

  if (lowerMessage.includes("dao_share_token_address")) {
    return "DAO shares token address is missing.";
  }

  if (lowerMessage.includes("dao_share_threshold")) {
    return "DAO share threshold is missing.";
  }

  if (lowerMessage.includes("hats_contract_address")) {
    return "Hats contract address is invalid.";
  }

  if (lowerMessage.includes("does not have raidguild accounting access")) {
    return "This wallet does not have access.";
  }

  if (lowerMessage.includes("execution reverted")) {
    return "Permission contract read failed.";
  }

  if (lowerMessage.includes("signature")) {
    return "Signature verification failed.";
  }

  return "Wallet sign-in failed.";
}

export function WalletConnect({ initialSession }: WalletConnectProps) {
  const account = useAccount();
  const router = useRouter();
  const { connectAsync, connectors, isPending: isConnecting } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const { showToast } = useToast();
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<SessionResponse>(
    initialSession ?? emptySession,
  );
  const [isLoadingSession, setIsLoadingSession] = useState(!initialSession);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const primaryConnector = useMemo(
    () =>
      connectors.find((connector) => connector.type === "injected") ??
      connectors[0],
    [connectors],
  );

  useEffect(() => {
    if (initialSession) {
      return;
    }

    let isMounted = true;

    fetch("/api/auth/session")
      .then(async (response) => {
        const payload = (await response.json()) as
          | SessionResponse
          | { error: string };

        if (!response.ok || "error" in payload) {
          throw new Error(
            "error" in payload ? payload.error : "Session lookup failed",
          );
        }

        return payload;
      })
      .then((nextSession) => {
        if (isMounted) {
          setSession(nextSession);
        }
      })
      .catch(() => {
        if (isMounted) {
          showToast("Session setup is missing.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingSession(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [initialSession, showToast]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (
        profileMenuRef.current &&
        event.target instanceof Node &&
        !profileMenuRef.current.contains(event.target)
      ) {
        setIsProfileMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  async function signIn() {
    setIsVerifying(true);

    try {
      if (!primaryConnector) {
        throw new Error("No wallet connector is available");
      }

      if (!account.address && !("ethereum" in window)) {
        throw new Error("No injected wallet found");
      }

      const connectedAccount = account.address
        ? { address: account.address, chainId: account.chainId }
        : await connectAsync({ connector: primaryConnector });
      const address =
        "address" in connectedAccount
          ? connectedAccount.address
          : connectedAccount.accounts[0];
      const chainId = connectedAccount.chainId;

      if (!chainId) {
        throw new Error("Wallet chain ID is unavailable");
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      const domain = appUrl ? new URL(appUrl).host : window.location.host;
      const uri = appUrl ?? window.location.origin;
      const nonceResponse = await fetch("/api/auth/nonce");
      const noncePayload = (await nonceResponse.json().catch(() => ({
        error: "Could not start wallet sign-in",
      }))) as
        | { nonce: string }
        | { error: string };

      if (!nonceResponse.ok || "error" in noncePayload) {
        throw new Error(
          "error" in noncePayload
            ? noncePayload.error
            : "Could not start wallet sign-in",
        );
      }

      const { nonce } = noncePayload;
      const message = new SiweMessage({
        address,
        chainId,
        domain,
        nonce,
        statement: "Sign in to RaidGuild Accounting.",
        uri,
        version: "1",
      }).prepareMessage();
      const signature = await signMessageAsync({ message });
      const verifyResponse = await fetch("/api/auth/verify", {
        body: JSON.stringify({ message, signature }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const nextSession = (await verifyResponse.json().catch(() => ({
        error: "Wallet verification failed",
      }))) as SessionResponse | { error: string };

      if (!verifyResponse.ok || "error" in nextSession) {
        throw new Error(
          "error" in nextSession
            ? nextSession.error
            : "Wallet verification failed",
        );
      }

      setSession(nextSession);
      setIsProfileMenuOpen(false);
      router.refresh();
    } catch (nextError) {
      showToast(
        "ethereum" in window
          ? getFriendlyError(nextError)
          : "No injected wallet found.",
      );
    } finally {
      setIsVerifying(false);
    }
  }

  async function signOut() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });

      if (!response.ok) {
        throw new Error("Logout failed");
      }
    } catch (error) {
      showToast(getFriendlyError(error));
    }

    try {
      await disconnectAsync();
    } catch (error) {
      console.warn("Wallet disconnect failed", error);
    } finally {
      setSession(emptySession);
      router.refresh();
    }
  }

  async function toggleViewMode() {
    const nextMode = session.viewMode === "member" ? "admin" : "member";

    try {
      const response = await fetch("/api/auth/view-mode", {
        body: JSON.stringify({ mode: nextMode }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const nextSession = (await response.json()) as SessionResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(nextSession.error ?? "View mode update failed");
      }

      setSession(nextSession);
      router.refresh();
    } catch (error) {
      showToast(getFriendlyError(error));
    }
  }

  if (session.authenticated && session.address) {
    const roleLabel = session.permissions?.roles.join(", ") ?? "member";
    const isMemberPreview = session.viewMode === "member";
    const viewLabel = isMemberPreview ? "member" : "admin";

    return (
      <div className="relative" ref={profileMenuRef}>
        <button
          type="button"
          aria-expanded={isProfileMenuOpen}
          onClick={() => setIsProfileMenuOpen((open) => !open)}
          className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-scroll-300/20 bg-moloch-900/35 px-3 text-sm text-scroll-100 shadow-inner shadow-black/10 transition-colors hover:bg-scroll-100/10"
        >
          <UserCircle className="size-4 shrink-0 text-scroll-200" aria-hidden="true" />
          <span className="font-medium">{formatAddress(session.address)}</span>
          <span className="hidden max-w-24 truncate text-scroll-300 sm:inline">
            {viewLabel}
          </span>
          <ChevronDown
            className={`size-3.5 shrink-0 transition-transform ${isProfileMenuOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>

        {isProfileMenuOpen ? (
          <div className="absolute right-0 top-12 z-30 grid w-72 gap-1 rounded-lg border border-scroll-300/25 bg-moloch-800 p-1 text-scroll-100 shadow-xl shadow-black/35">
            <div className="px-3 py-2">
              <p className="font-mono text-sm font-medium">
                {formatAddress(session.address)}
              </p>
              <p className="mt-1 text-xs text-scroll-300">
                {isMemberPreview
                  ? "Viewing the app as a member"
                  : `Signed in as ${roleLabel}`}
              </p>
            </div>
            {session.canUseMemberView ? (
              <button
                type="button"
                onClick={toggleViewMode}
                className="flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm font-medium transition-colors hover:bg-scroll-100/10"
              >
                <span>{isMemberPreview ? "View as admin" : "View as member"}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={signOut}
              className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium text-scroll-200 transition-colors hover:bg-scroll-100/10 hover:text-scroll-100"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end">
      <Button
        size="sm"
        className="border-scroll-300/30"
        onClick={signIn}
        disabled={
          isLoadingSession ||
          isConnecting ||
          isSigning ||
          isVerifying ||
          !primaryConnector
        }
      >
        {isVerifying || isSigning ? (
          <ShieldCheck data-icon="inline-start" />
        ) : (
          <Wallet data-icon="inline-start" />
        )}
        {isVerifying || isSigning ? "Verify Wallet" : "Connect Wallet"}
      </Button>
    </div>
  );
}
