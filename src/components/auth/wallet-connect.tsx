"use client";

import { LogOut, ShieldCheck, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { SiweMessage } from "siwe";
import { useEffect, useMemo, useState } from "react";
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
  chainId: number | null;
  permissions: AuthPermissions | null;
};

const emptySession: SessionResponse = {
  address: null,
  authenticated: false,
  chainId: null,
  permissions: null,
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

  if (lowerMessage.includes("gnosis_rpc_url")) {
    return "Gnosis RPC URL is missing.";
  }

  if (lowerMessage.includes("dao_contract_address")) {
    return "DAO contract address is missing.";
  }

  if (lowerMessage.includes("dao_share_token_address")) {
    return "DAO shares token address is missing.";
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

export function WalletConnect() {
  const account = useAccount();
  const router = useRouter();
  const { connectAsync, connectors, isPending: isConnecting } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const { showToast } = useToast();
  const [session, setSession] = useState<SessionResponse>(emptySession);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);

  const primaryConnector = useMemo(
    () =>
      connectors.find((connector) => connector.type === "injected") ??
      connectors[0],
    [connectors],
  );

  useEffect(() => {
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
  }, [showToast]);

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
    await fetch("/api/auth/logout", { method: "POST" });
    await disconnectAsync();
    setSession(emptySession);
    router.refresh();
  }

  if (session.authenticated && session.address) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="rounded-md border border-scroll-300/30 px-3 py-2 text-sm text-scroll-100">
          <span className="font-medium">{formatAddress(session.address)}</span>
          {session.permissions?.roles.length ? (
            <span className="ml-2 text-scroll-300">
              {session.permissions.roles.join(", ")}
            </span>
          ) : null}
        </div>
        <Button
          size="icon"
          variant="outline"
          className="border-scroll-300/30"
          onClick={signOut}
          aria-label="Sign out"
        >
          <LogOut className="size-4" aria-hidden="true" />
        </Button>
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
