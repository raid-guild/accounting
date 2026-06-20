"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { getDb } from "@/db";
import { clericRoles } from "@/db/schema";
import { canUseAdminAccess, getAuthSession } from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/audit";

const MEMBERSHIP_PATH = "/membership";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getClericAddress(formData: FormData) {
  const walletAddress = getString(formData, "walletAddress");

  if (!isAddress(walletAddress)) {
    redirect(`${MEMBERSHIP_PATH}?cleric=invalid`);
  }

  return getAddress(walletAddress);
}

async function requireAdminSession() {
  const session = await getAuthSession();

  if (!canUseAdminAccess(session)) {
    throw new Error("Admin access required");
  }

  return session;
}

async function findActiveClericRole(walletAddress: string) {
  const db = getDb();

  return db
    .select({ id: clericRoles.id })
    .from(clericRoles)
    .where(
      and(
        sql`lower(${clericRoles.walletAddress}) = ${walletAddress.toLowerCase()}`,
        isNull(clericRoles.revokedAt),
      ),
    )
    .limit(1);
}

export async function grantClericRole(formData: FormData) {
  const session = await requireAdminSession();
  const walletAddress = getClericAddress(formData);
  const existing = await findActiveClericRole(walletAddress);

  if (existing.length > 0) {
    redirect(`${MEMBERSHIP_PATH}?cleric=exists`);
  }

  const db = getDb();
  const [role] = await db
    .insert(clericRoles)
    .values({ walletAddress })
    .returning();

  await writeAuditEvent({
    action: "grant_role",
    actorWalletAddress: session.address,
    metadata: { walletAddress, role: "cleric" },
    subjectId: role.id,
    subjectTable: "cleric_roles",
    summary: "Granted Cleric access",
  });

  revalidatePath(MEMBERSHIP_PATH);
  redirect(`${MEMBERSHIP_PATH}?cleric=granted`);
}

export async function revokeClericRole(formData: FormData) {
  const session = await requireAdminSession();
  const roleId = getString(formData, "roleId");

  if (!roleId) {
    redirect(`${MEMBERSHIP_PATH}?cleric=missing`);
  }

  const db = getDb();
  const [role] = await db
    .update(clericRoles)
    .set({ revokedAt: new Date() })
    .where(and(eq(clericRoles.id, roleId), isNull(clericRoles.revokedAt)))
    .returning();

  if (!role) {
    redirect(`${MEMBERSHIP_PATH}?cleric=missing`);
  }

  await writeAuditEvent({
    action: "revoke_role",
    actorWalletAddress: session.address,
    metadata: { role: "cleric", walletAddress: role.walletAddress },
    subjectId: role.id,
    subjectTable: "cleric_roles",
    summary: "Revoked Cleric access",
  });

  revalidatePath(MEMBERSHIP_PATH);
  redirect(`${MEMBERSHIP_PATH}?cleric=revoked`);
}
