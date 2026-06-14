"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { ledgerEntries, rips } from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit";
import { getAuthSession } from "@/lib/auth/session";
import { encryptField } from "@/lib/encryption";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function normalizeRipUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

async function requireMemberSession() {
  const session = await getAuthSession();

  if (!session.address || !session.permissions?.canAccess) {
    throw new Error("Member access required");
  }

  return session;
}

export async function createRip(formData: FormData) {
  const session = await requireMemberSession();
  const title = getString(formData, "title");
  const url = normalizeRipUrl(getString(formData, "url"));

  if (!title || !url) {
    redirect("/rips?error=invalid");
  }

  const [rip] = await getDb()
    .insert(rips)
    .values({
      createdByWalletAddress: session.address,
      titleEncrypted: encryptField(title),
      urlEncrypted: encryptField(url),
    })
    .returning();

  await writeAuditEvent({
    action: "create",
    actorWalletAddress: session.address,
    metadata: {},
    subjectId: rip.id,
    subjectTable: "rips",
    summary: "Created RIP",
  });

  revalidatePath("/rips");
  redirect("/rips?created=1");
}

export async function updateRip(formData: FormData) {
  const session = await requireMemberSession();
  const ripId = getString(formData, "ripId");
  const title = getString(formData, "title");
  const url = normalizeRipUrl(getString(formData, "url"));

  if (!ripId || !title || !url) {
    redirect("/rips?error=invalid");
  }

  const [rip] = await getDb()
    .update(rips)
    .set({
      titleEncrypted: encryptField(title),
      urlEncrypted: encryptField(url),
    })
    .where(eq(rips.id, ripId))
    .returning();

  if (!rip) {
    redirect("/rips?error=missing");
  }

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    metadata: {},
    subjectId: rip.id,
    subjectTable: "rips",
    summary: "Updated RIP",
  });

  revalidatePath("/rips");
  redirect("/rips?updated=1");
}

export async function deleteRip(formData: FormData) {
  const session = await requireMemberSession();
  const ripId = getString(formData, "ripId");

  if (!ripId) {
    redirect("/rips?error=missing");
  }

  const [linkedEntryCount] = await getDb()
    .select({ count: sql<string>`count(${ledgerEntries.id})` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.ripId, ripId));

  if (Number(linkedEntryCount?.count ?? 0) > 0) {
    redirect("/rips?error=linked");
  }

  const [rip] = await getDb()
    .delete(rips)
    .where(eq(rips.id, ripId))
    .returning();

  if (!rip) {
    redirect("/rips?error=missing");
  }

  await writeAuditEvent({
    action: "delete",
    actorWalletAddress: session.address,
    metadata: {},
    subjectId: rip.id,
    subjectTable: "rips",
    summary: "Deleted RIP",
  });

  revalidatePath("/rips");
  redirect("/rips?deleted=1");
}
