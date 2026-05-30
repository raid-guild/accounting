"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export function CopyAddressButton({ address }: { address: string }) {
  const [didCopy, setDidCopy] = useState(false);

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

  async function copyAddress() {
    await navigator.clipboard.writeText(address);
    setDidCopy(true);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      onClick={copyAddress}
      aria-label="Copy Treasury address"
    >
      {didCopy ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </Button>
  );
}
