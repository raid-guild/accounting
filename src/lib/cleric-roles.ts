import "server-only";

import { asc, desc, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { clericRoles } from "@/db/schema";

export type ClericRoleRow = {
  id: string;
  walletAddress: string;
  createdAt: Date;
  revokedAt: Date | null;
};

export async function listClericRoles() {
  const db = getDb();

  return db
    .select({
      createdAt: clericRoles.createdAt,
      id: clericRoles.id,
      revokedAt: clericRoles.revokedAt,
      walletAddress: clericRoles.walletAddress,
    })
    .from(clericRoles)
    .orderBy(
      asc(sql`case when ${clericRoles.revokedAt} is null then 0 else 1 end`),
      desc(clericRoles.createdAt),
    );
}
