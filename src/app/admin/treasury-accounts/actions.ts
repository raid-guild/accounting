"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";

import { getDb } from "@/db";
import { treasuryAccounts } from "@/db/schema";
import { getAuthSession } from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/audit";
import { encryptField } from "@/lib/encryption";
import {
  normalizeTreasuryAccountInput,
  type EditableTreasuryAccountType,
} from "@/lib/treasury/accounts";

const TREASURY_ACCOUNTS_PATH = "/admin/treasury-accounts";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getAccountType(value: string): EditableTreasuryAccountType {
  if (value === "side_vault" || value === "operator" || value === "bank") {
    return value;
  }

  throw new Error("Account type must be side vault, operator, or bank");
}

function getChainId(value: string) {
  if (!value) {
    throw new Error("Chain is required");
  }

  const chainId = Number(value);

  if (!Number.isInteger(chainId)) {
    throw new Error("Chain is required");
  }

  return chainId;
}

async function requireAdminSession() {
  const session = await getAuthSession();

  if (!session.address || !session.permissions?.canAdmin) {
    throw new Error("Admin access required");
  }

  return session;
}

async function assertUniqueAccount({
  address,
  chainId,
  ignoredId,
}: {
  address: `0x${string}`;
  chainId: number;
  ignoredId?: string;
}) {
  const db = getDb();
  const rows = await db
    .select({ id: treasuryAccounts.id })
    .from(treasuryAccounts)
    .where(
      ignoredId
        ? and(
            eq(treasuryAccounts.address, address),
            eq(treasuryAccounts.chainId, chainId),
            ne(treasuryAccounts.id, ignoredId),
          )
        : and(
            eq(treasuryAccounts.address, address),
            eq(treasuryAccounts.chainId, chainId),
          ),
    )
    .limit(1);

  if (rows.length > 0) {
    throw new Error(
      "A treasury account already exists for that address on this chain",
    );
  }
}

async function assertEditableTreasuryAccount(id: string) {
  const db = getDb();
  const rows = await db
    .select({ id: treasuryAccounts.id })
    .from(treasuryAccounts)
    .where(
      and(
        eq(treasuryAccounts.id, id),
        inArray(treasuryAccounts.type, ["side_vault", "operator", "bank"]),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new Error("Editable treasury account not found");
  }
}

function getEncryptedNotes(notes: string) {
  return notes ? encryptField(notes) : null;
}

export async function createTreasuryAccount(formData: FormData) {
  const session = await requireAdminSession();
  const name = getString(formData, "name");
  const notes = getString(formData, "notes");
  const type = getAccountType(getString(formData, "type"));
  const chainId = getChainId(getString(formData, "chainId"));
  const address = getString(formData, "address");

  if (!name) {
    throw new Error("Name is required");
  }

  const normalized = normalizeTreasuryAccountInput({ address, chainId, type });
  await assertUniqueAccount({
    address: normalized.address,
    chainId: normalized.chainId,
  });

  const db = getDb();
  const [account] = await db
    .insert(treasuryAccounts)
    .values({
      address: normalized.address,
      chainId: normalized.chainId,
      isDaoControlled: normalized.isDaoControlled,
      nameEncrypted: encryptField(name),
      notesEncrypted: getEncryptedNotes(notes),
      type: normalized.type,
    })
    .returning();

  await writeAuditEvent({
    action: "create",
    actorWalletAddress: session.address,
    metadata: {
      chainId: normalized.chainId,
      type: normalized.type,
    },
    subjectId: account.id,
    subjectTable: "treasury_accounts",
    summary: `Created ${normalized.type} treasury account`,
  });

  revalidatePath(TREASURY_ACCOUNTS_PATH);
  redirect(TREASURY_ACCOUNTS_PATH);
}

export async function updateTreasuryAccount(formData: FormData) {
  const session = await requireAdminSession();
  const id = getString(formData, "id");
  const name = getString(formData, "name");
  const notes = getString(formData, "notes");
  const type = getAccountType(getString(formData, "type"));
  const chainId = getChainId(getString(formData, "chainId"));
  const address = getString(formData, "address");

  if (!id) {
    throw new Error("Treasury account is required");
  }

  if (!name) {
    throw new Error("Name is required");
  }

  await assertEditableTreasuryAccount(id);

  const normalized = normalizeTreasuryAccountInput({ address, chainId, type });
  await assertUniqueAccount({
    address: normalized.address,
    chainId: normalized.chainId,
    ignoredId: id,
  });

  const db = getDb();
  await db
    .update(treasuryAccounts)
    .set({
      address: normalized.address,
      chainId: normalized.chainId,
      isDaoControlled: normalized.isDaoControlled,
      nameEncrypted: encryptField(name),
      notesEncrypted: getEncryptedNotes(notes),
      type: normalized.type,
    })
    .where(eq(treasuryAccounts.id, id));

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    metadata: {
      chainId: normalized.chainId,
      type: normalized.type,
    },
    subjectId: id,
    subjectTable: "treasury_accounts",
    summary: `Updated ${normalized.type} treasury account`,
  });

  revalidatePath(TREASURY_ACCOUNTS_PATH);
}

export async function archiveTreasuryAccount(formData: FormData) {
  const session = await requireAdminSession();
  const id = getString(formData, "id");

  if (!id) {
    throw new Error("Treasury account is required");
  }

  await assertEditableTreasuryAccount(id);

  const db = getDb();
  await db
    .update(treasuryAccounts)
    .set({ archivedAt: new Date() })
    .where(eq(treasuryAccounts.id, id));

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    subjectId: id,
    subjectTable: "treasury_accounts",
    summary: "Archived treasury account",
  });

  revalidatePath(TREASURY_ACCOUNTS_PATH);
}

export async function restoreTreasuryAccount(formData: FormData) {
  const session = await requireAdminSession();
  const id = getString(formData, "id");

  if (!id) {
    throw new Error("Treasury account is required");
  }

  await assertEditableTreasuryAccount(id);

  const db = getDb();
  await db
    .update(treasuryAccounts)
    .set({ archivedAt: null })
    .where(eq(treasuryAccounts.id, id));

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    subjectId: id,
    subjectTable: "treasury_accounts",
    summary: "Restored treasury account",
  });

  revalidatePath(TREASURY_ACCOUNTS_PATH);
}
