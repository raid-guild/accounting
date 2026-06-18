import "server-only";

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  auditEvents,
  ledgerEntries,
  quarterStatusEnum,
  quarters,
  treasuryTransactionTransfers,
} from "@/db/schema";
import {
  buildQuarterWorkflowSteps,
  getQuarterSyncStatusMap,
  type QuarterSyncStatus,
  type QuarterWorkflowStep,
} from "@/lib/quarter-sync";
import {
  getQuarterBalanceValidationMap,
  type QuarterBalanceValidation,
} from "@/lib/quarter-balance-validation";

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

export type QuarterClassificationSummary = {
  classifiedTransfers: number;
  totalTransfers: number;
  unclassifiedTransfers: number;
};

export type QuarterReportingPeriod = QuarterSummary & {
  classificationSummary: QuarterClassificationSummary;
  history: QuarterHistoryEvent[];
  syncStatus: QuarterSyncStatus | null;
  balanceValidation: QuarterBalanceValidation | null;
  workflowSteps: QuarterWorkflowStep[];
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

function getQuarterBounds({
  endsOn,
  startsOn,
}: {
  endsOn: string;
  startsOn: string;
}) {
  const startsAt = new Date(`${startsOn}T00:00:00.000Z`);
  const endsAtExclusive = new Date(`${endsOn}T00:00:00.000Z`);
  endsAtExclusive.setUTCDate(endsAtExclusive.getUTCDate() + 1);

  return { endsAtExclusive, startsAt };
}

export async function getQuarterClassificationSummary({
  endsOn,
  startsOn,
}: {
  endsOn: string;
  startsOn: string;
}): Promise<QuarterClassificationSummary> {
  const { endsAtExclusive, startsAt } = getQuarterBounds({ endsOn, startsOn });
  const [transferSummary, ledgerSummary] = await Promise.all([
    getDb()
      .select({
        classifiedTransfers: count(ledgerEntries.id),
        totalTransfers: count(treasuryTransactionTransfers.id),
      })
      .from(treasuryTransactionTransfers)
      .leftJoin(
        ledgerEntries,
        eq(
          ledgerEntries.treasuryTransactionTransferId,
          treasuryTransactionTransfers.id,
        ),
      )
      .where(
        and(
          sql`${treasuryTransactionTransfers.executedAt} >= ${startsAt}`,
          sql`${treasuryTransactionTransfers.executedAt} < ${endsAtExclusive}`,
        ),
      ),
    getDb()
      .select({
        classifiedEntries: sql<number>`count(${ledgerEntries.id}) filter (where ${ledgerEntries.category} <> 'uncategorized')`,
        totalEntries: count(ledgerEntries.id),
      })
      .from(ledgerEntries)
      .where(
        and(
          inArray(ledgerEntries.source, ["bank_csv", "manual"]),
          sql`${ledgerEntries.occurredAt} >= ${startsAt}`,
          sql`${ledgerEntries.occurredAt} < ${endsAtExclusive}`,
        ),
      ),
  ]);
  const totalTransfers =
    (transferSummary[0]?.totalTransfers ?? 0) +
    (ledgerSummary[0]?.totalEntries ?? 0);
  const classifiedTransfers =
    (transferSummary[0]?.classifiedTransfers ?? 0) +
    Number(ledgerSummary[0]?.classifiedEntries ?? 0);

  return {
    classifiedTransfers,
    totalTransfers,
    unclassifiedTransfers: totalTransfers - classifiedTransfers,
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

  const summaries = await Promise.all(
    quarterRows.map((quarter) =>
      getQuarterClassificationSummary({
        endsOn: quarter.endsOn,
        startsOn: quarter.startsOn,
      }),
    ),
  );
  const syncStatusByQuarter = await getQuarterSyncStatusMap(
    quarterRows.map((quarter) => quarter.id),
  );
  const validationByQuarter = await getQuarterBalanceValidationMap(
    quarterRows.map((quarter) => quarter.id),
  );

  return quarterRows.map((quarter, index) => ({
    ...quarter,
    balanceValidation: validationByQuarter.get(quarter.id) ?? null,
    classificationSummary: summaries[index],
    history: historyByQuarter.get(quarter.id) ?? [],
    syncStatus: syncStatusByQuarter.get(quarter.id) ?? null,
    workflowSteps: buildQuarterWorkflowSteps({
      classificationSummary: summaries[index],
      quarter,
      syncStatus: syncStatusByQuarter.get(quarter.id) ?? null,
      validation: validationByQuarter.get(quarter.id) ?? null,
    }),
  }));
}
