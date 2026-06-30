import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";

export class MachineApiRateLimitError extends Error {
  constructor() {
    super("Machine API rate limit reached. Try again later.");
    this.name = "MachineApiRateLimitError";
  }
}

export async function checkMachineApiRateLimit({
  key,
  maxRequests,
  windowMs,
}: {
  key: string;
  maxRequests: number;
  windowMs: number;
}) {
  const resetAt = new Date(Date.now() + windowMs);
  const result = await getDb().execute<{
    count: number;
  }>(sql`
    insert into machine_api_rate_limits (key, count, reset_at)
    values (${key}, 1, ${resetAt})
    on conflict (key) do update
    set
      count = case
        when machine_api_rate_limits.reset_at <= now() then 1
        else machine_api_rate_limits.count + 1
      end,
      reset_at = case
        when machine_api_rate_limits.reset_at <= now() then ${resetAt}
        else machine_api_rate_limits.reset_at
      end,
      updated_at = now()
    returning count
  `);
  const [row] = result.rows;

  if (Number(row?.count ?? 0) > maxRequests) {
    throw new MachineApiRateLimitError();
  }
}
