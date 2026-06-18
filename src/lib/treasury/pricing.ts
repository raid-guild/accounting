import "server-only";

const STABLE_ASSET_SYMBOLS = new Set([
  "DAI",
  "DKUSD",
  "USDC",
  "XDAI",
  "WXDAI",
]);
const COINGECKO_ASSET_IDS_BY_SYMBOL = new Map([
  ["LPT", "livepeer"],
  ["WETH", "ethereum"],
]);

function normalizeAssetSymbol(assetSymbol: string) {
  return assetSymbol.trim().toUpperCase();
}

function getCoinGeckoHeaders() {
  const headers = new Headers();

  if (process.env.COINGECKO_API_KEY) {
    headers.set("x-cg-demo-api-key", process.env.COINGECKO_API_KEY);
  }

  return headers;
}

function formatUsd(value: number) {
  return value.toFixed(2);
}

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

async function fetchHistoricalCoinGeckoUsdPrice({
  coinId,
  executedAt,
}: {
  coinId: string;
  executedAt: Date;
}) {
  const timestampSeconds = Math.floor(executedAt.getTime() / 1000);
  const url = new URL(
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range`,
  );

  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("from", String(timestampSeconds - 60 * 60 * 12));
  url.searchParams.set("to", String(timestampSeconds + 60 * 60 * 12));

  const response = await fetch(url, {
    cache: "no-store",
    headers: getCoinGeckoHeaders(),
  });

  if (!response.ok) {
    throw new Error("CoinGecko historical price request failed");
  }

  const body = (await response.json()) as { prices?: [number, number][] };
  const prices = body.prices ?? [];
  let nearest: [number, number] | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const pricePoint of prices) {
    const [timestamp, price] = pricePoint;

    if (!isPositiveFinite(price)) {
      continue;
    }

    const distance = Math.abs(timestamp - executedAt.getTime());

    if (distance < nearestDistance) {
      nearest = pricePoint;
      nearestDistance = distance;
    }
  }

  if (!nearest) {
    throw new Error("CoinGecko historical price unavailable");
  }

  return nearest[1];
}

export async function getHistoricalUsdPricing({
  amount,
  assetSymbol,
  executedAt,
}: {
  amount: string;
  assetSymbol: string;
  executedAt: Date;
}) {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount < 0) {
    throw new Error("Asset amount is invalid");
  }

  const normalizedAssetSymbol = normalizeAssetSymbol(assetSymbol);

  if (STABLE_ASSET_SYMBOLS.has(normalizedAssetSymbol)) {
    return {
      priceSource: "stable_1_to_1",
      priceUsd: "1.00000000",
      usdAmount: formatUsd(numericAmount),
    };
  }

  const coinId = COINGECKO_ASSET_IDS_BY_SYMBOL.get(normalizedAssetSymbol);

  if (coinId) {
    const price = await fetchHistoricalCoinGeckoUsdPrice({
      coinId,
      executedAt,
    });

    return {
      priceSource: "coingecko",
      priceUsd: price.toFixed(8),
      usdAmount: formatUsd(numericAmount * price),
    };
  }

  throw new Error(`Historical pricing is not configured for ${assetSymbol}`);
}
