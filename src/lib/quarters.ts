import "server-only";

import { asc, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { auditEvents, quarterStatusEnum, quarters } from "@/db/schema";

export type QuarterStatus = (typeof quarterStatusEnum.enumValues)[number];

export type QuarterSummary = {
  id: string;
  label: string;
  year: number;
  quarter: number;
  startsOn: string;
  endsOn: string;
  status: QuarterStatus;
  publishedAt: string | null;
  reopenedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuarterHistoryEvent = {
  id: string;
  action: string;
  actorWalletAddress: string | null;
  createdAt: string;
  summary: string;
  metadata: Record<string, unknown> | null;
};

export type QuarterReportingPeriod = QuarterSummary & {
  history: QuarterHistoryEvent[];
};

const Q1_2026 = {
  endsOn: "2026-03-31",
  label: "Q1 2026",
  quarter: 1,
  startsOn: "2026-01-01",
  year: 2026,
} as const;

export function getQ1_2026Definition() {
  return Q1_2026;
}

function toIsoDate(value: string | Date) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value;
}

function toIsoDateTime(value: Date | null) {
  return value?.toISOString() ?? null;
}

function mapQuarter(quarter: typeof quarters.$inferSelect): QuarterSummary {
  return {
    id: quarter.id,
    label: quarter.label,
    year: quarter.year,
    quarter: quarter.quarter,
    startsOn: toIsoDate(quarter.startsOn),
    endsOn: toIsoDate(quarter.endsOn),
    status: quarter.status,
    publishedAt: toIsoDateTime(quarter.publishedAt),
    reopenedAt: toIsoDateTime(quarter.reopenedAt),
    createdAt: quarter.createdAt.toISOString(),
    updatedAt: quarter.updatedAt.toISOString(),
  };
}

function mapHistoryEvent(
  event: typeof auditEvents.$inferSelect,
): QuarterHistoryEvent {
  return {
    id: event.id,
    action: event.action,
    actorWalletAddress: event.actorWalletAddress,
    createdAt: event.createdAt.toISOString(),
    summary: event.summary,
    metadata: event.metadata as Record<string, unknown> | null,
  };
}

export async function listQuarters(): Promise<QuarterSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(quarters)
    .orderBy(desc(quarters.year), desc(quarters.quarter));

  return rows.map(mapQuarter);
}

export async function listPublishedQuarters(): Promise<QuarterSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(quarters)
    .where(eq(quarters.status, "published"))
    .orderBy(desc(quarters.year), desc(quarters.quarter));

  return rows.map(mapQuarter);
}

export async function getQuarterHistory(
  quarterId: string,
): Promise<QuarterHistoryEvent[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.quarterId, quarterId))
    .orderBy(asc(auditEvents.createdAt));

  return rows.map(mapHistoryEvent);
}

export async function listQuarterReportingPeriods(): Promise<
  QuarterReportingPeriod[]
> {
  const quarterRows = await listQuarters();

  if (quarterRows.length === 0) {
    return [];
  }

  const db = getDb();
  const events = await db
    .select()
    .from(auditEvents)
    .where(inArray(auditEvents.quarterId, quarterRows.map((quarter) => quarter.id)))
    .orderBy(asc(auditEvents.createdAt));
  const historyByQuarter = new Map<string, QuarterHistoryEvent[]>();

  for (const event of events) {
    if (!event.quarterId) {
      continue;
    }

    const history = historyByQuarter.get(event.quarterId) ?? [];
    history.push(mapHistoryEvent(event));
    historyByQuarter.set(event.quarterId, history);
  }

  return quarterRows.map((quarter) => ({
    ...quarter,
    history: historyByQuarter.get(quarter.id) ?? [],
  }));
}
