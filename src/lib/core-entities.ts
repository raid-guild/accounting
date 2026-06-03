import "server-only";

import { asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import {
  entities,
  entityAddresses,
  entityTypeEnum,
  raids,
} from "@/db/schema";
import { decryptField, type EncryptedField } from "@/lib/encryption";

export type CoreEntityType = (typeof entityTypeEnum.enumValues)[number];
export type RaidRelatedEntityType = "client" | "subcontractor";

export type EntityAddressView = {
  address: string;
  chainId: number | null;
  id: string;
  label: string | null;
};

export type CoreEntityView = {
  addresses: EntityAddressView[];
  archivedAt: string | null;
  id: string;
  isMember: boolean;
  name: string;
  notes: string | null;
  type: CoreEntityType;
  website: string | null;
};

export type RaidView = {
  archivedAt: string | null;
  client: Pick<CoreEntityView, "archivedAt" | "id" | "name">;
  clientEntityId: string;
  id: string;
  name: string;
  notes: string | null;
};

function decryptNullableField(value: unknown) {
  return value ? decryptField(value as EncryptedField) : null;
}

function mapEntity(
  entity: typeof entities.$inferSelect,
  addresses: EntityAddressView[] = [],
): CoreEntityView {
  return {
    addresses,
    archivedAt: entity.archivedAt?.toISOString() ?? null,
    id: entity.id,
    isMember: entity.isMember,
    name: decryptField(entity.nameEncrypted as EncryptedField),
    notes: decryptNullableField(entity.notesEncrypted),
    type: entity.type,
    website: decryptNullableField(entity.websiteEncrypted),
  };
}

function mapAddress(
  address: typeof entityAddresses.$inferSelect,
): EntityAddressView {
  return {
    address: address.address,
    chainId: address.chainId,
    id: address.id,
    label: decryptNullableField(address.labelEncrypted),
  };
}

function mapRaid({
  client,
  raid,
}: {
  client: typeof entities.$inferSelect;
  raid: typeof raids.$inferSelect;
}): RaidView {
  return {
    archivedAt: raid.archivedAt?.toISOString() ?? null,
    client: {
      archivedAt: client.archivedAt?.toISOString() ?? null,
      id: client.id,
      name: decryptField(client.nameEncrypted as EncryptedField),
    },
    clientEntityId: raid.clientEntityId,
    id: raid.id,
    name: decryptField(raid.nameEncrypted as EncryptedField),
    notes: decryptNullableField(raid.notesEncrypted),
  };
}

export async function listEntitiesByTypes(
  types: CoreEntityType[],
): Promise<CoreEntityView[]> {
  if (types.length === 0) {
    return [];
  }

  const db = getDb();
  const entityRows = await db
    .select()
    .from(entities)
    .where(inArray(entities.type, types))
    .orderBy(asc(entities.type), asc(entities.createdAt));

  if (entityRows.length === 0) {
    return [];
  }

  const addressRows = await db
    .select()
    .from(entityAddresses)
    .where(
      inArray(
        entityAddresses.entityId,
        entityRows.map((entity) => entity.id),
      ),
    )
    .orderBy(asc(entityAddresses.createdAt));

  const addressesByEntity = new Map<string, EntityAddressView[]>();

  for (const address of addressRows) {
    const addresses = addressesByEntity.get(address.entityId) ?? [];
    addresses.push(mapAddress(address));
    addressesByEntity.set(address.entityId, addresses);
  }

  return entityRows.map((entity) =>
    mapEntity(entity, addressesByEntity.get(entity.id) ?? []),
  );
}

export async function listRaids(): Promise<RaidView[]> {
  const db = getDb();
  const rows = await db
    .select({ client: entities, raid: raids })
    .from(raids)
    .innerJoin(entities, eq(raids.clientEntityId, entities.id))
    .orderBy(asc(raids.createdAt));

  return rows.map(mapRaid);
}
