"use client";

import { Check, Copy } from "lucide-react";
import { type MouseEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function CopyableAddress({
  address,
  className,
  label,
}: {
  address: string;
  className?: string;
  label?: string;
}) {
  const [didCopy, setDidCopy] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (!didCopy) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDidCopy(false);
    }, 1600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [didCopy]);

  async function copyAddress(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard unavailable");
      }

      await navigator.clipboard.writeText(address);
      setDidCopy(true);
    } catch {
      setDidCopy(false);
      showToast("Could not copy address.");
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {label ? <span className="font-sans font-medium">{label}</span> : null}
      <span className="font-mono">{formatAddress(address)}</span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={copyAddress}
        aria-label={`Copy ${label ? `${label} ` : ""}address`}
        className="size-7 shrink-0"
      >
        {didCopy ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </Button>
    </span>
  );
}
