import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";

export class ReportAssistantRateLimitError extends Error {
  constructor() {
    super("Report assistant rate limit reached. Try again in a minute.");
    this.name = "ReportAssistantRateLimitError";
  }
}

export async function checkReportAssistantRateLimit({
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
    reset_at: Date;
  }>(sql`
    insert into report_assistant_rate_limits (key, count, reset_at)
    values (${key}, 1, ${resetAt})
    on conflict (key) do update
    set
      count = case
        when report_assistant_rate_limits.reset_at <= now() then 1
        else report_assistant_rate_limits.count + 1
      end,
      reset_at = case
        when report_assistant_rate_limits.reset_at <= now() then ${resetAt}
        else report_assistant_rate_limits.reset_at
      end,
      updated_at = now()
    returning count, reset_at
  `);
  const [row] = result.rows;

  if (Number(row?.count ?? 0) > maxRequests) {
    throw new ReportAssistantRateLimitError();
  }
}
