"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

export function SyncStatusBadge() {
  const [isAnimating, setIsAnimating] = useState(true);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsAnimating(false);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800">
      <RefreshCw
        className={`size-3.5 ${isAnimating ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      Pending live Safe sync
    </div>
  );
}
