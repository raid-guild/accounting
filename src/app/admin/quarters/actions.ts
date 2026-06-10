"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { quarters } from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit";
import { getAuthSession } from "@/lib/auth/session";
import {
  getQuarterClassificationSummary,
  getQ1_2026Definition,
  type QuarterStatus,
} from "@/lib/quarters";
import { getQuarterSyncStatus, isQuarterSyncFresh } from "@/lib/quarter-sync";

const QUARTERS_PATH = "/admin/quarters";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getTargetStatus(value: string): QuarterStatus {
  if (
    value === "draft" ||
    value === "ready_for_review" ||
    value === "published" ||
    value === "reopened"
  ) {
    return value;
  }

  throw new Error("Unsupported quarter status");
}

async function requireAdminSession() {
  const session = await getAuthSession();

  if (!session.address || !session.permissions?.canAdmin) {
    throw new Error("Admin access required");
  }

  return session;
}

async function getQuarterById(id: string) {
  const db = getDb();
  const [quarter] = await db
    .select()
    .from(quarters)
    .where(eq(quarters.id, id))
    .limit(1);

  if (!quarter) {
    throw new Error("Quarter not found");
  }

  return quarter;
}

function getStatusSummary(status: QuarterStatus) {
  switch (status) {
    case "draft":
      return "Moved quarter to draft";
    case "ready_for_review":
      return "Marked quarter ready for review";
    case "published":
      return "Published quarter";
    case "reopened":
      return "Reopened quarter";
  }
}

function assertAllowedTransition({
  currentStatus,
  reason,
  targetStatus,
}: {
  currentStatus: QuarterStatus;
  reason: string;
  targetStatus: QuarterStatus;
}) {
  if (currentStatus === targetStatus) {
    throw new Error("Quarter is already in that status");
  }

  if (targetStatus === "reopened") {
    if (currentStatus !== "published") {
      throw new Error("Only published quarters can be reopened");
    }

    if (!reason) {
      throw new Error("Reopen reason is required");
    }
  }

  if (currentStatus === "published" && targetStatus !== "reopened") {
    throw new Error("Published quarters must be reopened before editing");
  }

  if (targetStatus === "published" && currentStatus !== "ready_for_review") {
    throw new Error("Mark the quarter ready before publishing");
  }
}

export async function createQ1ReportingPeriod() {
  const session = await requireAdminSession();
  const db = getDb();
  const q1 = getQ1_2026Definition();
  const [quarter] = await db
    .insert(quarters)
    .values({
      endsOn: q1.endsOn,
      label: q1.label,
      quarter: q1.quarter,
      startsOn: q1.startsOn,
      status: "draft",
      year: q1.year,
    })
    .onConflictDoNothing({
      target: [quarters.year, quarters.quarter],
    })
    .returning();

  if (!quarter) {
    revalidatePath(QUARTERS_PATH);
    return;
  }

  await writeAuditEvent({
    action: "create",
    actorWalletAddress: session.address,
    quarterId: quarter.id,
    subjectId: quarter.id,
    subjectTable: "quarters",
    summary: "Created Q1 2026 reporting period",
  });

  revalidatePath("/");
  revalidatePath(QUARTERS_PATH);
}

export async function updateQuarterStatus(formData: FormData) {
  const session = await requireAdminSession();
  const id = getString(formData, "id");
  const targetStatus = getTargetStatus(getString(formData, "status"));
  const reason = getString(formData, "reason");

  if (!id) {
    throw new Error("Quarter is required");
  }

  const quarter = await getQuarterById(id);

  assertAllowedTransition({
    currentStatus: quarter.status,
    reason,
    targetStatus,
  });

  if (targetStatus === "ready_for_review" || targetStatus === "published") {
    const syncStatus = await getQuarterSyncStatus(id);
    if (!isQuarterSyncFresh({ quarter, syncStatus })) {
      throw new Error(
        targetStatus === "published"
          ? "Sync quarter activity after the quarter has ended before publishing"
          : "Sync quarter activity after the quarter has ended before marking it ready",
      );
    }

    const summary = await getQuarterClassificationSummary({
      endsOn: quarter.endsOn,
      startsOn: quarter.startsOn,
    });

    if (summary.unclassifiedTransfers > 0) {
      throw new Error(
        targetStatus === "published"
          ? "Classify all imported transactions before publishing this quarter"
          : "Classify all imported transactions before marking this quarter ready",
      );
    }
  }

  const now = new Date();
  const updates = {
    publishedAt:
      targetStatus === "published" ? now : quarter.publishedAt,
    reopenedAt: targetStatus === "reopened" ? now : quarter.reopenedAt,
    status: targetStatus,
  };
  const db = getDb();

  const [updatedQuarter] = await db
    .update(quarters)
    .set(updates)
    .where(and(eq(quarters.id, id), eq(quarters.status, quarter.status)))
    .returning();

  if (!updatedQuarter) {
    throw new Error("Quarter status changed. Refresh and try again.");
  }

  await writeAuditEvent({
    action:
      targetStatus === "published"
        ? "publish"
        : targetStatus === "reopened"
          ? "reopen"
          : "update",
    actorWalletAddress: session.address,
    metadata: {
      fromStatus: quarter.status,
      reason: reason || null,
      toStatus: targetStatus,
    },
    quarterId: id,
    subjectId: id,
    subjectTable: "quarters",
    summary: getStatusSummary(targetStatus),
  });

  revalidatePath("/");
  revalidatePath(QUARTERS_PATH);
}
