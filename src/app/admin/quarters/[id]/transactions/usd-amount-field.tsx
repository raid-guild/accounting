"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function UsdAmountField({
  defaultValue,
  transferId,
}: {
  defaultValue: string;
  transferId: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [isFetching, setIsFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function fetchPrice() {
    setIsFetching(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/treasury/transfers/${transferId}/price`);
      const body = (await response.json()) as {
        error?: string;
        priceSource?: string;
        priceUsd?: string;
        usdAmount?: string;
      };

      if (!response.ok || !body.usdAmount) {
        throw new Error(body.error ?? "Historical price unavailable");
      }

      setValue(body.usdAmount);
      setMessage(
        body.priceSource === "coingecko"
          ? `Fetched CoinGecko price: $${body.priceUsd}`
          : "Filled from 1:1 stablecoin pricing",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Historical price unavailable",
      );
    } finally {
      setIsFetching(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          name="usdAmount"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setMessage(null);
          }}
          inputMode="decimal"
          placeholder="0.00"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          required
        />
        <Button
          type="button"
          variant="outline"
          onClick={fetchPrice}
          disabled={isFetching}
          aria-busy={isFetching}
        >
          <RefreshCw
            data-icon="inline-start"
            className={isFetching ? "animate-spin" : ""}
            aria-hidden="true"
          />
          {isFetching ? "Fetching..." : "Fetch Price"}
        </Button>
      </div>
      {message ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
