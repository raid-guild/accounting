import "server-only";

import { getDb } from "@/db";
import { auditActionEnum, auditEvents } from "@/db/schema";

type AuditAction = (typeof auditActionEnum.enumValues)[number];

type WriteAuditEventInput = {
  action: AuditAction;
  actorUserId?: string;
  actorWalletAddress?: string;
  metadata?: Record<string, unknown>;
  quarterId?: string;
  subjectId?: string;
  subjectTable: string;
  summary: string;
};

export async function writeAuditEvent(input: WriteAuditEventInput) {
  const db = getDb();

  await db.insert(auditEvents).values({
    action: input.action,
    actorUserId: input.actorUserId,
    actorWalletAddress: input.actorWalletAddress,
    metadata: input.metadata,
    quarterId: input.quarterId,
    subjectId: input.subjectId,
    subjectTable: input.subjectTable,
    summary: input.summary,
  });
}
