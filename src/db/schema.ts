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
  "bank",
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
  "raid_spoils",
  "subcontractor_payout",
  "rip_expense",
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

export const membershipActivityTypeEnum = pgEnum("membership_activity_type", [
  "join",
  "ragequit",
]);

export const quarterSyncStepEnum = pgEnum("quarter_sync_step", [
  "transactions",
  "proposals",
  "membership",
  "balances",
  "finalize",
]);

export const quarterSyncStepStatusEnum = pgEnum("quarter_sync_step_status", [
  "pending",
  "running",
  "success",
  "failed",
]);

export const quarterSyncOverallStatusEnum = pgEnum(
  "quarter_sync_overall_status",
  ["idle", "running", "success", "partial", "failed"],
);

export const quarterBalanceBoundaryEnum = pgEnum("quarter_balance_boundary", [
  "opening",
  "closing",
]);

export const quarterBalanceValidationStatusEnum = pgEnum(
  "quarter_balance_validation_status",
  ["not_ready", "needs_review", "validated", "acknowledged"],
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

export const reportAssistantRateLimits = pgTable(
  "report_assistant_rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").default(0).notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("report_assistant_rate_limits_reset_at_idx").on(table.resetAt),
  ],
);

export const machineApiRateLimits = pgTable(
  "machine_api_rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").default(0).notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("machine_api_rate_limits_reset_at_idx").on(table.resetAt)],
);

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

export const machineApiRequestNonces = pgTable(
  "machine_api_request_nonces",
  {
    nonce: text("nonce").primaryKey(),
    agentAddress: text("agent_address").notNull(),
    delegatorAddress: text("delegator_address").notNull(),
    quarterId: uuid("quarter_id").references(() => quarters.id, {
      onDelete: "set null",
    }),
    reportSlice: text("report_slice").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("machine_api_request_nonces_agent_idx").on(
      sql`lower(${table.agentAddress})`,
    ),
    index("machine_api_request_nonces_delegator_idx").on(
      sql`lower(${table.delegatorAddress})`,
    ),
    index("machine_api_request_nonces_expires_at_idx").on(table.expiresAt),
  ],
);

export const quarterSyncStatuses = pgTable(
  "quarter_sync_statuses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quarterId: uuid("quarter_id")
      .notNull()
      .references(() => quarters.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    overallStatus: quarterSyncOverallStatusEnum("overall_status")
      .default("idle")
      .notNull(),
    currentStep: quarterSyncStepEnum("current_step"),
    transactionsStatus: quarterSyncStepStatusEnum("transactions_status")
      .default("pending")
      .notNull(),
    proposalsStatus: quarterSyncStepStatusEnum("proposals_status")
      .default("pending")
      .notNull(),
    membershipStatus: quarterSyncStepStatusEnum("membership_status")
      .default("pending")
      .notNull(),
    balancesStatus: quarterSyncStepStatusEnum("balances_status")
      .default("pending")
      .notNull(),
    finalizeStatus: quarterSyncStepStatusEnum("finalize_status")
      .default("pending")
      .notNull(),
    transactionsStartedAt: timestamp("transactions_started_at", {
      withTimezone: true,
    }),
    transactionsCompletedAt: timestamp("transactions_completed_at", {
      withTimezone: true,
    }),
    proposalsStartedAt: timestamp("proposals_started_at", {
      withTimezone: true,
    }),
    proposalsCompletedAt: timestamp("proposals_completed_at", {
      withTimezone: true,
    }),
    membershipStartedAt: timestamp("membership_started_at", {
      withTimezone: true,
    }),
    membershipCompletedAt: timestamp("membership_completed_at", {
      withTimezone: true,
    }),
    balancesStartedAt: timestamp("balances_started_at", {
      withTimezone: true,
    }),
    balancesCompletedAt: timestamp("balances_completed_at", {
      withTimezone: true,
    }),
    finalizeStartedAt: timestamp("finalize_started_at", {
      withTimezone: true,
    }),
    finalizeCompletedAt: timestamp("finalize_completed_at", {
      withTimezone: true,
    }),
    transactionsError: text("transactions_error"),
    proposalsError: text("proposals_error"),
    membershipError: text("membership_error"),
    balancesError: text("balances_error"),
    finalizeError: text("finalize_error"),
    importedTransactions: integer("imported_transactions")
      .default(0)
      .notNull(),
    importedTransfers: integer("imported_transfers").default(0).notNull(),
    scannedTransfers: integer("scanned_transfers").default(0).notNull(),
    syncErrorCount: integer("sync_error_count").default(0).notNull(),
    proposalLinkedTransactions: integer("proposal_linked_transactions")
      .default(0)
      .notNull(),
    proposalMatches: integer("proposal_matches").default(0).notNull(),
    membershipActivities: integer("membership_activities")
      .default(0)
      .notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("quarter_sync_statuses_quarter_id_unique").on(
      table.quarterId,
    ),
    index("quarter_sync_statuses_overall_status_idx").on(table.overallStatus),
    index("quarter_sync_statuses_last_synced_at_idx").on(table.lastSyncedAt),
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

export const quarterBalanceSnapshots = pgTable(
  "quarter_balance_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quarterId: uuid("quarter_id")
      .notNull()
      .references(() => quarters.id, { onDelete: "cascade" }),
    treasuryAccountId: uuid("treasury_account_id").references(
      () => treasuryAccounts.id,
      { onDelete: "set null" },
    ),
    boundary: quarterBalanceBoundaryEnum("boundary").notNull(),
    accountAddress: text("account_address").notNull(),
    chainId: integer("chain_id").notNull(),
    blockNumber: integer("block_number").notNull(),
    blockTimestamp: timestamp("block_timestamp", { withTimezone: true })
      .notNull(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    decimals: integer("decimals").notNull(),
    rawAmount: numeric("raw_amount", { precision: 78, scale: 0 }).notNull(),
    balance: numeric("balance", { precision: 36, scale: 18 }).notNull(),
    usdPrice: numeric("usd_price", { precision: 18, scale: 8 }).notNull(),
    usdValue: numeric("usd_value", { precision: 18, scale: 2 }).notNull(),
    priceSource: text("price_source").notNull(),
    ...timestamps,
  },
  (table) => [
    index("quarter_balance_snapshots_quarter_boundary_idx").on(
      table.quarterId,
      table.boundary,
    ),
    uniqueIndex("quarter_balance_snapshots_unique").on(
      table.quarterId,
      table.boundary,
      table.chainId,
      sql`lower(${table.accountAddress})`,
      table.symbol,
    ),
  ],
);

export const quarterBalanceValidations = pgTable(
  "quarter_balance_validations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quarterId: uuid("quarter_id")
      .notNull()
      .references(() => quarters.id, { onDelete: "cascade" }),
    status: quarterBalanceValidationStatusEnum("status").notNull(),
    checkedCount: integer("checked_count").default(0).notNull(),
    varianceCount: integer("variance_count").default(0).notNull(),
    excludedCount: integer("excluded_count").default(0).notNull(),
    totalVarianceUsd: numeric("total_variance_usd", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    details: jsonb("details").notNull(),
    acknowledgementNoteEncrypted: jsonb("acknowledgement_note_encrypted"),
    acknowledgedByWalletAddress: text("acknowledged_by_wallet_address"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    sourceSyncRunId: text("source_sync_run_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("quarter_balance_validations_quarter_id_unique").on(
      table.quarterId,
    ),
    index("quarter_balance_validations_status_idx").on(table.status),
  ],
);

export const treasuryTransactions = pgTable(
  "treasury_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    daoProposalId: uuid("dao_proposal_id").references(() => daoProposals.id, {
      onDelete: "set null",
    }),
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
    index("treasury_transactions_dao_proposal_id_idx").on(table.daoProposalId),
  ],
);

export const daoProposals = pgTable(
  "dao_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    daoAddress: text("dao_address").notNull(),
    chainId: integer("chain_id").notNull(),
    proposalId: text("proposal_id").notNull(),
    proposalNumber: text("proposal_number"),
    title: text("title").notNull(),
    status: text("status"),
    executionTxHash: text("execution_tx_hash").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    daohausUrl: text("daohaus_url").notNull(),
    rawMetadata: jsonb("raw_metadata"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("dao_proposals_chain_dao_proposal_unique").on(
      table.chainId,
      sql`lower(${table.daoAddress})`,
      table.proposalId,
    ),
    uniqueIndex("dao_proposals_chain_execution_tx_unique").on(
      table.chainId,
      sql`lower(${table.executionTxHash})`,
    ),
    index("dao_proposals_executed_at_idx").on(table.executedAt),
    index("dao_proposals_status_idx").on(table.status),
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

export const rips = pgTable(
  "rips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    titleEncrypted: jsonb("title_encrypted").notNull(),
    urlEncrypted: jsonb("url_encrypted").notNull(),
    createdByWalletAddress: text("created_by_wallet_address"),
    ...timestamps,
  },
  (table) => [
    index("rips_created_at_idx").on(table.createdAt),
    index("rips_created_by_wallet_address_idx").on(
      sql`lower(${table.createdByWalletAddress})`,
    ),
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
    sourceExternalId: text("source_external_id"),
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
    ripId: uuid("rip_id").references(() => rips.id, {
      onDelete: "set null",
    }),
    notesEncrypted: jsonb("notes_encrypted"),
    sourceMetadata: jsonb("source_metadata"),
    ...timestamps,
  },
  (table) => [
    index("ledger_entries_quarter_id_idx").on(table.quarterId),
    index("ledger_entries_category_idx").on(table.category),
    uniqueIndex("ledger_entries_source_external_id_unique").on(
      table.sourceExternalId,
    ),
    index("ledger_entries_tx_hash_idx").on(table.txHash),
    uniqueIndex("ledger_entries_treasury_transfer_unique").on(
      table.treasuryTransactionTransferId,
    ),
    index("ledger_entries_raid_id_idx").on(table.raidId),
    index("ledger_entries_rip_id_idx").on(table.ripId),
    index("ledger_entries_occurred_at_idx").on(table.occurredAt),
  ],
);

export const membershipActivities = pgTable(
  "membership_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quarterId: uuid("quarter_id").references(() => quarters.id, {
      onDelete: "set null",
    }),
    daoProposalId: uuid("dao_proposal_id").references(() => daoProposals.id, {
      onDelete: "set null",
    }),
    type: membershipActivityTypeEnum("type").notNull(),
    daoAddress: text("dao_address").notNull(),
    chainId: integer("chain_id").notNull(),
    memberAddress: text("member_address").notNull(),
    recipientAddress: text("recipient_address"),
    txHash: text("tx_hash").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    proposalId: text("proposal_id"),
    proposalTitle: text("proposal_title"),
    assetAddress: text("asset_address"),
    assetSymbol: text("asset_symbol"),
    assetAmount: numeric("asset_amount", { precision: 36, scale: 18 }),
    usdAmount: numeric("usd_amount", { precision: 18, scale: 2 }),
    shares: numeric("shares", { precision: 36, scale: 18 }),
    loot: numeric("loot", { precision: 36, scale: 18 }),
    rawMetadata: jsonb("raw_metadata"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("membership_activities_chain_tx_type_member_unique").on(
      table.chainId,
      sql`lower(${table.txHash})`,
      table.type,
      sql`lower(${table.memberAddress})`,
    ),
    index("membership_activities_quarter_id_idx").on(table.quarterId),
    index("membership_activities_dao_proposal_id_idx").on(table.daoProposalId),
    index("membership_activities_executed_at_idx").on(table.executedAt),
    index("membership_activities_type_idx").on(table.type),
    index("membership_activities_member_address_idx").on(table.memberAddress),
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
