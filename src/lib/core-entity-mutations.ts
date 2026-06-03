import "server-only";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { getDb } from "@/db";
import { entities, entityAddresses, raids } from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit";
import { getAuthSession } from "@/lib/auth/session";
import { encryptField } from "@/lib/encryption";
import type {
  CoreEntityType,
  RaidRelatedEntityType,
} from "@/lib/core-entities";

type EntityMutationAccess = "provider" | "raid-related";

type EntityInput = {
  isMember: boolean;
  name: string;
  notes: string;
  type: CoreEntityType;
  website: string;
};

export type CoreEntityValidationCode =
  | "client_has_raids"
  | "duplicate_address"
  | "invalid_address"
  | "invalid_chain"
  | "missing_address";

export class CoreEntityValidationError extends Error {
  code: CoreEntityValidationCode;

  constructor(code: CoreEntityValidationCode, message: string) {
    super(message);
    this.name = "CoreEntityValidationError";
    this.code = code;
  }
}

const RAID_RELATED_ENTITY_TYPES: RaidRelatedEntityType[] = [
  "client",
  "subcontractor",
];

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function getEncryptedNullable(value: string) {
  return value ? encryptField(value) : null;
}

function assertUuid(value: string, label: string) {
  if (!value) {
    throw new Error(`${label} is required`);
  }

  return value;
}

function parseEntityType(value: string): CoreEntityType {
  if (
    value === "client" ||
    value === "provider" ||
    value === "subcontractor"
  ) {
    return value;
  }

  throw new Error("Entity type is required");
}

function assertRaidRelatedEntityType(
  type: CoreEntityType,
): RaidRelatedEntityType {
  if (type === "client" || type === "subcontractor") {
    return type;
  }

  throw new Error("Clerics can only manage raid-related entities");
}

function parseEntityInput(formData: FormData): EntityInput {
  const name = getString(formData, "name");

  if (!name) {
    throw new Error("Name is required");
  }

  return {
    isMember: getBoolean(formData, "isMember"),
    name,
    notes: getString(formData, "notes"),
    type: parseEntityType(getString(formData, "type")),
    website: getString(formData, "website"),
  };
}

function parseOptionalAddress(formData: FormData) {
  const rawAddress = getString(formData, "address");

  if (!rawAddress) {
    return null;
  }

  if (!isAddress(rawAddress)) {
    throw new CoreEntityValidationError(
      "invalid_address",
      "Address must be a valid EVM address",
    );
  }

  const rawChainId = getString(formData, "chainId");
  const chainId = rawChainId ? Number(rawChainId) : null;

  if (chainId !== null && (!Number.isInteger(chainId) || chainId <= 0)) {
    throw new CoreEntityValidationError(
      "invalid_chain",
      "Chain ID must be a positive whole number",
    );
  }

  return {
    address: getAddress(rawAddress),
    chainId,
    label: getString(formData, "addressLabel"),
  };
}

async function requireEntityAccess(access: EntityMutationAccess) {
  const session = await getAuthSession();

  if (!session.address) {
    throw new Error("Wallet session required");
  }

  if (access === "provider" && !session.permissions?.canAdmin) {
    throw new Error("Admin access required");
  }

  if (
    access === "raid-related" &&
    !session.permissions?.canWriteRaidAccounting
  ) {
    throw new Error("Raid accounting access required");
  }

  return session;
}

async function assertEditableEntity(
  id: string,
  access: EntityMutationAccess,
) {
  const db = getDb();
  const allowedTypes: CoreEntityType[] =
    access === "provider" ? ["provider"] : RAID_RELATED_ENTITY_TYPES;
  const [entity] = await db
    .select({ id: entities.id, type: entities.type })
    .from(entities)
    .where(and(eq(entities.id, id), inArray(entities.type, allowedTypes)))
    .limit(1);

  if (!entity) {
    throw new Error("Entity not found");
  }

  return entity;
}

async function assertArchivedEntity(
  id: string,
  access: EntityMutationAccess,
) {
  const db = getDb();
  const allowedTypes: CoreEntityType[] =
    access === "provider" ? ["provider"] : RAID_RELATED_ENTITY_TYPES;
  const [entity] = await db
    .select({
      archivedAt: entities.archivedAt,
      id: entities.id,
      type: entities.type,
    })
    .from(entities)
    .where(and(eq(entities.id, id), inArray(entities.type, allowedTypes)))
    .limit(1);

  if (!entity) {
    throw new Error("Entity not found");
  }

  if (!entity.archivedAt) {
    throw new Error("Archive this record before permanently deleting it");
  }

  return entity;
}

async function assertEditableRaid(id: string) {
  const db = getDb();
  const [raid] = await db
    .select({ id: raids.id })
    .from(raids)
    .where(eq(raids.id, id))
    .limit(1);

  if (!raid) {
    throw new Error("Raid not found");
  }
}

async function assertArchivedRaid(id: string) {
  const db = getDb();
  const [raid] = await db
    .select({ archivedAt: raids.archivedAt, id: raids.id })
    .from(raids)
    .where(eq(raids.id, id))
    .limit(1);

  if (!raid) {
    throw new Error("Raid not found");
  }

  if (!raid.archivedAt) {
    throw new Error("Archive this raid before permanently deleting it");
  }

  return raid;
}

async function assertUniqueAddress({
  address,
  chainId,
}: {
  address: `0x${string}`;
  chainId: number | null;
}) {
  const db = getDb();
  const normalizedAddress = address.toLowerCase();
  const [existingAddress] = await db
    .select({ id: entityAddresses.id })
    .from(entityAddresses)
    .where(
      and(
        sql`lower(${entityAddresses.address}) = ${normalizedAddress}`,
        chainId === null
          ? isNull(entityAddresses.chainId)
          : eq(entityAddresses.chainId, chainId),
      ),
    )
    .limit(1);

  if (existingAddress) {
    throw new CoreEntityValidationError(
      "duplicate_address",
      "That address is already assigned to an entity",
    );
  }
}

function isUniqueAddressViolation(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("entity_addresses_chain_address_unique")
  );
}

function getEntityAddressValues(
  entityId: string,
  address: NonNullable<ReturnType<typeof parseOptionalAddress>>,
) {
  return {
    address: address.address,
    chainId: address.chainId,
    entityId,
    labelEncrypted: getEncryptedNullable(address.label),
  };
}

function revalidateEntityPaths() {
  revalidatePath("/raids");
  revalidatePath("/admin/providers");
}

export async function createEntityForAccess(
  formData: FormData,
  access: EntityMutationAccess,
) {
  const session = await requireEntityAccess(access);
  const input = parseEntityInput(formData);

  if (access === "provider") {
    if (input.type !== "provider") {
      throw new Error("Provider records must use the provider type");
    }
  } else {
    assertRaidRelatedEntityType(input.type);
  }

  const address = parseOptionalAddress(formData);
  const entityId = randomUUID();
  const db = getDb();
  const entityValues = {
    id: entityId,
    isMember: input.isMember,
    nameEncrypted: encryptField(input.name),
    notesEncrypted: getEncryptedNullable(input.notes),
    type: input.type,
    websiteEncrypted: getEncryptedNullable(input.website),
  };

  try {
    if (address) {
      await assertUniqueAddress(address);

      if ("batch" in db) {
        await db.batch([
          db.insert(entities).values(entityValues),
          db.insert(entityAddresses).values(
            getEntityAddressValues(entityId, address),
          ),
        ]);
      } else {
        await db.transaction(async (tx) => {
          await tx.insert(entities).values(entityValues);
          await tx
            .insert(entityAddresses)
            .values(getEntityAddressValues(entityId, address));
        });
      }
    } else {
      await db.insert(entities).values(entityValues);
    }
  } catch (error) {
    if (isUniqueAddressViolation(error)) {
      throw new CoreEntityValidationError(
        "duplicate_address",
        "That address is already assigned to an entity",
      );
    }

    throw error;
  }

  await writeAuditEvent({
    action: "create",
    actorWalletAddress: session.address,
    metadata: { type: input.type },
    subjectId: entityId,
    subjectTable: "entities",
    summary: `Created ${input.type} record`,
  });

  revalidateEntityPaths();
}

export async function updateEntityForAccess(
  formData: FormData,
  access: EntityMutationAccess,
) {
  const session = await requireEntityAccess(access);
  const id = assertUuid(getString(formData, "id"), "Entity");
  const input = parseEntityInput(formData);
  const entity = await assertEditableEntity(id, access);

  if (input.type !== entity.type) {
    throw new Error("Entity type cannot be changed");
  }

  await getDb()
    .update(entities)
    .set({
      isMember: input.isMember,
      nameEncrypted: encryptField(input.name),
      notesEncrypted: getEncryptedNullable(input.notes),
      websiteEncrypted: getEncryptedNullable(input.website),
    })
    .where(eq(entities.id, id));

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    metadata: { type: entity.type },
    subjectId: id,
    subjectTable: "entities",
    summary: `Updated ${entity.type} record`,
  });

  revalidateEntityPaths();
}

export async function archiveEntityForAccess(
  formData: FormData,
  access: EntityMutationAccess,
) {
  const session = await requireEntityAccess(access);
  const id = assertUuid(getString(formData, "id"), "Entity");
  const entity = await assertEditableEntity(id, access);

  await getDb()
    .update(entities)
    .set({ archivedAt: new Date() })
    .where(eq(entities.id, id));

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    metadata: { type: entity.type },
    subjectId: id,
    subjectTable: "entities",
    summary: `Archived ${entity.type} record`,
  });

  revalidateEntityPaths();
}

export async function restoreEntityForAccess(
  formData: FormData,
  access: EntityMutationAccess,
) {
  const session = await requireEntityAccess(access);
  const id = assertUuid(getString(formData, "id"), "Entity");
  const entity = await assertEditableEntity(id, access);

  await getDb()
    .update(entities)
    .set({ archivedAt: null })
    .where(eq(entities.id, id));

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    metadata: { type: entity.type },
    subjectId: id,
    subjectTable: "entities",
    summary: `Restored ${entity.type} record`,
  });

  revalidateEntityPaths();
}

export async function deleteEntityForAccess(
  formData: FormData,
  access: EntityMutationAccess,
) {
  const session = await requireEntityAccess(access);
  const id = assertUuid(getString(formData, "id"), "Entity");
  const entity = await assertArchivedEntity(id, access);

  if (entity.type === "client") {
    const [dependentRaid] = await getDb()
      .select({ id: raids.id })
      .from(raids)
      .where(eq(raids.clientEntityId, id))
      .limit(1);

    if (dependentRaid) {
      throw new CoreEntityValidationError(
        "client_has_raids",
        "Client cannot be permanently deleted while raids reference it",
      );
    }
  }

  await getDb().delete(entities).where(eq(entities.id, id));

  await writeAuditEvent({
    action: "delete",
    actorWalletAddress: session.address,
    metadata: { type: entity.type },
    subjectId: id,
    subjectTable: "entities",
    summary: `Permanently deleted ${entity.type} record`,
  });

  revalidateEntityPaths();
}

export async function addAddressForAccess(
  formData: FormData,
  access: EntityMutationAccess,
) {
  const session = await requireEntityAccess(access);
  const entityId = assertUuid(getString(formData, "entityId"), "Entity");
  await assertEditableEntity(entityId, access);

  const address = parseOptionalAddress(formData);

  if (!address) {
    throw new CoreEntityValidationError(
      "missing_address",
      "Address is required",
    );
  }

  await assertUniqueAddress(address);

  let createdAddress: typeof entityAddresses.$inferSelect;

  try {
    [createdAddress] = await getDb()
      .insert(entityAddresses)
      .values(getEntityAddressValues(entityId, address))
      .returning();
  } catch (error) {
    if (isUniqueAddressViolation(error)) {
      throw new CoreEntityValidationError(
        "duplicate_address",
        "That address is already assigned to an entity",
      );
    }

    throw error;
  }

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    metadata: { address: address.address, chainId: address.chainId },
    subjectId: createdAddress.id,
    subjectTable: "entity_addresses",
    summary: "Added entity address",
  });

  revalidateEntityPaths();
}

export async function removeAddressForAccess(
  formData: FormData,
  access: EntityMutationAccess,
) {
  const session = await requireEntityAccess(access);
  const id = assertUuid(getString(formData, "id"), "Address");
  const db = getDb();
  const [address] = await db
    .select({ entityId: entityAddresses.entityId, id: entityAddresses.id })
    .from(entityAddresses)
    .innerJoin(entities, eq(entityAddresses.entityId, entities.id))
    .where(
      and(
        eq(entityAddresses.id, id),
        inArray(
          entities.type,
          access === "provider" ? ["provider"] : RAID_RELATED_ENTITY_TYPES,
        ),
      ),
    )
    .limit(1);

  if (!address) {
    throw new Error("Address not found");
  }

  await db.delete(entityAddresses).where(eq(entityAddresses.id, id));

  await writeAuditEvent({
    action: "delete",
    actorWalletAddress: session.address,
    subjectId: id,
    subjectTable: "entity_addresses",
    summary: "Removed entity address",
  });

  revalidateEntityPaths();
}

export async function createRaidForAccess(formData: FormData) {
  const session = await requireEntityAccess("raid-related");
  const name = getString(formData, "name");
  const clientEntityId = assertUuid(getString(formData, "clientEntityId"), "Client");
  const notes = getString(formData, "notes");

  if (!name) {
    throw new Error("Raid name is required");
  }

  const db = getDb();
  const [client] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.id, clientEntityId),
        eq(entities.type, "client"),
        isNull(entities.archivedAt),
      ),
    )
    .limit(1);

  if (!client) {
    throw new Error("Active client is required");
  }

  const [raid] = await db
    .insert(raids)
    .values({
      clientEntityId,
      nameEncrypted: encryptField(name),
      notesEncrypted: getEncryptedNullable(notes),
    })
    .returning();

  await writeAuditEvent({
    action: "create",
    actorWalletAddress: session.address,
    subjectId: raid.id,
    subjectTable: "raids",
    summary: "Created raid",
  });

  revalidatePath("/raids");
}

export async function updateRaidForAccess(formData: FormData) {
  const session = await requireEntityAccess("raid-related");
  const id = assertUuid(getString(formData, "id"), "Raid");
  const name = getString(formData, "name");
  const clientEntityId = assertUuid(getString(formData, "clientEntityId"), "Client");
  const notes = getString(formData, "notes");

  if (!name) {
    throw new Error("Raid name is required");
  }

  await assertEditableRaid(id);

  const db = getDb();
  const [client] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.id, clientEntityId),
        eq(entities.type, "client"),
        isNull(entities.archivedAt),
      ),
    )
    .limit(1);

  if (!client) {
    throw new Error("Active client is required");
  }

  await db
    .update(raids)
    .set({
      clientEntityId,
      nameEncrypted: encryptField(name),
      notesEncrypted: getEncryptedNullable(notes),
    })
    .where(eq(raids.id, id));

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    subjectId: id,
    subjectTable: "raids",
    summary: "Updated raid",
  });

  revalidatePath("/raids");
}

export async function archiveRaidForAccess(formData: FormData) {
  const session = await requireEntityAccess("raid-related");
  const id = assertUuid(getString(formData, "id"), "Raid");

  await assertEditableRaid(id);

  await getDb()
    .update(raids)
    .set({ archivedAt: new Date() })
    .where(eq(raids.id, id));

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    subjectId: id,
    subjectTable: "raids",
    summary: "Archived raid",
  });

  revalidatePath("/raids");
}

export async function restoreRaidForAccess(formData: FormData) {
  const session = await requireEntityAccess("raid-related");
  const id = assertUuid(getString(formData, "id"), "Raid");

  await assertEditableRaid(id);

  await getDb()
    .update(raids)
    .set({ archivedAt: null })
    .where(eq(raids.id, id));

  await writeAuditEvent({
    action: "update",
    actorWalletAddress: session.address,
    subjectId: id,
    subjectTable: "raids",
    summary: "Restored raid",
  });

  revalidatePath("/raids");
}

export async function deleteRaidForAccess(formData: FormData) {
  const session = await requireEntityAccess("raid-related");
  const id = assertUuid(getString(formData, "id"), "Raid");

  await assertArchivedRaid(id);

  await getDb().delete(raids).where(eq(raids.id, id));

  await writeAuditEvent({
    action: "delete",
    actorWalletAddress: session.address,
    subjectId: id,
    subjectTable: "raids",
    summary: "Permanently deleted raid",
  });

  revalidatePath("/raids");
}
