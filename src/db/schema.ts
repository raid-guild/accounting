import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const quarterStatusEnum = pgEnum("quarter_status", [
  "draft",
  "ready_for_review",
  "published",
  "reopened",
]);

export const treasuryAccountTypeEnum = pgEnum("treasury_account_type", [
  "main_safe",
  "side_vault",
  "operator",
]);

export const entityTypeEnum = pgEnum("entity_type", [
  "client",
  "provider",
  "subcontractor",
]);

export const ledgerSourceEnum = pgEnum("ledger_source", [
  "main_safe",
  "side_vault",
  "operator",
  "manual",
  "bank_csv",
  "dao_proposal",
]);

export const ledgerCategoryEnum = pgEnum("ledger_category", [
  "raid_revenue",
  "subcontractor_payout",
  "provider_expense",
  "member_dues",
  "ragequit",
  "treasury_transfer",
  "uncategorized",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "verified",
  "unverified",
]);

export const treasurySnapshotStatusEnum = pgEnum("treasury_snapshot_status", [
  "pending_live_sync",
  "synced",
  "stale_syncing",
  "partial",
  "failed",
]);

export const treasuryTransferDirectionEnum = pgEnum(
  "treasury_transfer_direction",
  ["inflow", "outflow", "internal"],
);

export const auditActionEnum = pgEnum("audit_action", [
  "create",
  "update",
  "delete",
  "import",
  "classify",
  "publish",
  "reopen",
  "grant_role",
  "revoke_role",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdateFn(() => sql`now()`)
    .notNull(),
};

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    displayNameEncrypted: jsonb("display_name_encrypted"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("app_users_wallet_address_unique").on(
      sql`lower(${table.walletAddress})`,
    ),
  ],
);

export const clericRoles = pgTable(
  "cleric_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    grantedByUserId: uuid("granted_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    index("cleric_roles_wallet_address_idx").on(
      sql`lower(${table.walletAddress})`,
    ),
    index("cleric_roles_active_idx").on(
      sql`lower(${table.walletAddress})`,
      table.revokedAt,
    ),
  ],
);

export const quarters = pgTable(
  "quarters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    label: text("label").notNull(),
    year: integer("year").notNull(),
    quarter: integer("quarter").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    status: quarterStatusEnum("status").default("draft").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("quarters_year_quarter_unique").on(table.year, table.quarter),
    index("quarters_status_idx").on(table.status),
  ],
);

export const treasuryAccounts = pgTable(
  "treasury_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nameEncrypted: jsonb("name_encrypted").notNull(),
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    type: treasuryAccountTypeEnum("type").notNull(),
    isDaoControlled: boolean("is_dao_controlled").default(true).notNull(),
    notesEncrypted: jsonb("notes_encrypted"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("treasury_accounts_chain_address_unique").on(
      table.chainId,
      table.address,
    ),
    index("treasury_accounts_type_idx").on(table.type),
    index("treasury_accounts_archived_at_idx").on(table.archivedAt),
  ],
);

export const treasuryBalanceSnapshots = pgTable(
  "treasury_balance_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountAddress: text("account_address").notNull(),
    chainId: integer("chain_id").notNull(),
    status: treasurySnapshotStatusEnum("status").notNull(),
    totalUsd: numeric("total_usd", { precision: 18, scale: 2 }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    index("treasury_balance_snapshots_chain_account_synced_idx").on(
      table.chainId,
      table.accountAddress,
      table.syncedAt.desc(),
    ),
    index("treasury_balance_snapshots_synced_at_idx").on(table.syncedAt),
  ],
);

export const treasuryBalanceAssets = pgTable(
  "treasury_balance_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => treasuryBalanceSnapshots.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    decimals: integer("decimals").notNull(),
    rawAmount: numeric("raw_amount", { precision: 78, scale: 0 }).notNull(),
    balance: numeric("balance", { precision: 36, scale: 18 }).notNull(),
    usdPrice: numeric("usd_price", { precision: 18, scale: 8 }).notNull(),
    usdValue: numeric("usd_value", { precision: 18, scale: 2 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("treasury_balance_assets_snapshot_id_idx").on(table.snapshotId),
    uniqueIndex("treasury_balance_assets_snapshot_symbol_unique").on(
      table.snapshotId,
      table.symbol,
    ),
  ],
);

export const treasuryTransactions = pgTable(
  "treasury_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    treasuryAccountId: uuid("treasury_account_id").references(
      () => treasuryAccounts.id,
      { onDelete: "set null" },
    ),
    source: ledgerSourceEnum("source").notNull(),
    accountAddress: text("account_address").notNull(),
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull(),
    safeTransactionHash: text("safe_transaction_hash"),
    transactionType: text("transaction_type").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    blockNumber: integer("block_number"),
    rawMetadata: jsonb("raw_metadata"),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("treasury_transactions_chain_account_tx_unique").on(
      table.chainId,
      sql`lower(${table.accountAddress})`,
      sql`lower(${table.txHash})`,
    ),
    index("treasury_transactions_tx_hash_idx").on(table.txHash),
    index("treasury_transactions_account_executed_idx").on(
      table.chainId,
      table.accountAddress,
      table.executedAt.desc(),
    ),
    index("treasury_transactions_treasury_account_id_idx").on(
      table.treasuryAccountId,
    ),
  ],
);

export const treasuryTransactionTransfers = pgTable(
  "treasury_transaction_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    treasuryTransactionId: uuid("treasury_transaction_id")
      .notNull()
      .references(() => treasuryTransactions.id, { onDelete: "cascade" }),
    treasuryAccountId: uuid("treasury_account_id").references(
      () => treasuryAccounts.id,
      { onDelete: "set null" },
    ),
    transferId: text("transfer_id").notNull(),
    direction: treasuryTransferDirectionEnum("direction").notNull(),
    transferType: text("transfer_type").notNull(),
    accountAddress: text("account_address").notNull(),
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    tokenAddress: text("token_address"),
    assetSymbol: text("asset_symbol").notNull(),
    assetName: text("asset_name").notNull(),
    decimals: integer("decimals").notNull(),
    rawAmount: numeric("raw_amount", { precision: 78, scale: 0 }).notNull(),
    amount: numeric("amount", { precision: 36, scale: 18 }).notNull(),
    usdPrice: numeric("usd_price", { precision: 18, scale: 8 }),
    usdAmount: numeric("usd_amount", { precision: 18, scale: 2 }),
    rawMetadata: jsonb("raw_metadata"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("treasury_transaction_transfers_chain_transfer_unique").on(
      table.chainId,
      sql`lower(${table.accountAddress})`,
      table.transferId,
    ),
    index("treasury_transaction_transfers_transaction_id_idx").on(
      table.treasuryTransactionId,
    ),
    index("treasury_transaction_transfers_treasury_account_id_idx").on(
      table.treasuryAccountId,
    ),
    index("treasury_transaction_transfers_tx_hash_idx").on(table.txHash),
    index("treasury_transaction_transfers_executed_at_idx").on(
      table.executedAt,
    ),
  ],
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: entityTypeEnum("type").notNull(),
    nameEncrypted: jsonb("name_encrypted").notNull(),
    websiteEncrypted: jsonb("website_encrypted"),
    notesEncrypted: jsonb("notes_encrypted"),
    isMember: boolean("is_member").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("entities_type_idx").on(table.type),
    index("entities_archived_at_idx").on(table.archivedAt),
  ],
);

export const entityAddresses = pgTable(
  "entity_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    chainId: integer("chain_id"),
    labelEncrypted: jsonb("label_encrypted"),
    ...timestamps,
  },
  (table) => [
    index("entity_addresses_entity_id_idx").on(table.entityId),
    index("entity_addresses_address_idx").on(table.address),
    uniqueIndex("entity_addresses_chain_address_unique").on(
      sql`coalesce(${table.chainId}, -1)`,
      sql`lower(${table.address})`,
    ),
  ],
);

export const raids = pgTable(
  "raids",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientEntityId: uuid("client_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    nameEncrypted: jsonb("name_encrypted").notNull(),
    notesEncrypted: jsonb("notes_encrypted"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("raids_client_entity_id_idx").on(table.clientEntityId),
    index("raids_archived_at_idx").on(table.archivedAt),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quarterId: uuid("quarter_id").references(() => quarters.id, {
      onDelete: "set null",
    }),
    source: ledgerSourceEnum("source").notNull(),
    category: ledgerCategoryEnum("category").default("uncategorized").notNull(),
    verificationStatus: verificationStatusEnum("verification_status")
      .default("verified")
      .notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    chainId: integer("chain_id"),
    txHash: text("tx_hash"),
    treasuryAccountId: uuid("treasury_account_id").references(
      () => treasuryAccounts.id,
      { onDelete: "set null" },
    ),
    treasuryTransactionTransferId: uuid(
      "treasury_transaction_transfer_id",
    ).references(() => treasuryTransactionTransfers.id, {
      onDelete: "set null",
    }),
    assetSymbol: text("asset_symbol").notNull(),
    assetAmount: numeric("asset_amount", {
      precision: 36,
      scale: 18,
    }).notNull(),
    usdAmount: numeric("usd_amount", { precision: 18, scale: 2 }).notNull(),
    counterpartyEntityId: uuid("counterparty_entity_id").references(
      () => entities.id,
      { onDelete: "set null" },
    ),
    raidId: uuid("raid_id").references(() => raids.id, {
      onDelete: "set null",
    }),
    notesEncrypted: jsonb("notes_encrypted"),
    sourceMetadata: jsonb("source_metadata"),
    ...timestamps,
  },
  (table) => [
    index("ledger_entries_quarter_id_idx").on(table.quarterId),
    index("ledger_entries_category_idx").on(table.category),
    index("ledger_entries_tx_hash_idx").on(table.txHash),
    uniqueIndex("ledger_entries_treasury_transfer_unique").on(
      table.treasuryTransactionTransferId,
    ),
    index("ledger_entries_raid_id_idx").on(table.raidId),
    index("ledger_entries_occurred_at_idx").on(table.occurredAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    actorWalletAddress: text("actor_wallet_address"),
    action: auditActionEnum("action").notNull(),
    subjectTable: text("subject_table").notNull(),
    subjectId: uuid("subject_id"),
    quarterId: uuid("quarter_id").references(() => quarters.id, {
      onDelete: "set null",
    }),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_events_subject_idx").on(table.subjectTable, table.subjectId),
    index("audit_events_actor_user_id_idx").on(table.actorUserId),
    index("audit_events_quarter_id_idx").on(table.quarterId),
    index("audit_events_created_at_idx").on(table.createdAt),
  ],
);
