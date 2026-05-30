# Accounting Dashboard Project Spec

## 1. Goal

Build a wallet-gated accounting dashboard for RaidGuild that links onchain treasury activity, manually entered raid accounting activity, DAO proposal data, RIPs, and eventually bank CSV imports into clean quarterly and annual financial reports.

The first implementation target is a complete Q1 2026 export.

The most important reporting output is taxable revenue. RaidGuild taxes are based on gross revenue, not profit, so the dashboard must clearly and accurately report full client payments as taxable revenue.

The app should also provide a P&L summary for internal records, track expenses and revenue sources, support raid/project accounting, and produce accountant-friendly exports.

## 2. Non-Goals For V1

- Invoice tracking.
- Accrual accounting.
- Storing uploaded bank CSV files permanently.
- Storing sensitive contractor tax documents.
- Mobile-specific workflows beyond responsive web layout.
- Hardcoding treasury addresses, DAO addresses, RPC URLs, API keys, or real financial data in the public repo.

## 3. Core Accounting Rules

The app uses cash-basis accounting only. Money counts when it actually moves.

For raids:

- Full client payment is taxable revenue.
- Spoils are always 10% of gross raid revenue.
- The remaining 90% is the expected subcontractor/team payout pool.
- Subcontractor payouts are expenses for P&L and raid accounting.
- Spoils are expected to land in a treasury or old side-vault and can be tracked as their own treasury inflow.

Example:

- Client pays $10,000.
- Taxable revenue: $10,000.
- Expected spoils: $1,000.
- Expected subcontractor pool: $9,000.

Stablecoin valuation:

- USDC, xDAI, and wxDAI are treated as 1:1 USD.

Volatile asset valuation:

- wETH is valued in USD at transaction time.
- CoinGecko is the preferred historical pricing source.

## 4. Supported Assets And Chains

Automated treasury scanning in V1 starts on Gnosis only.

Supported Gnosis assets:

- USDC
- xDAI
- wxDAI
- wETH

Manual transaction lookup should support:

- Gnosis
- Arbitrum
- Optimism
- Ethereum mainnet
- Base

## 5. Users And Permissions

Authentication is wallet-based using SIWE.

Read access:

- Any wallet with at least 100 current RaidGuild DAO shares.

Admin/write access:

- Wallets wearing the Angry Dwarf Hat, checked through Hats Protocol data.

Cleric access:

- Wallets assigned the Cleric role by an Angry Dwarf admin can manually add raid revenue, raid payouts, and spoils links.
- Clerics are narrower than Angry Dwarf admins.
- Clerics should not be able to manage quarter publishing, bank imports, side-vault configuration, global classifications, or unrelated entity/address book data unless separately granted admin access.
- Cleric roles are stored in the database and can be granted or revoked by Angry Dwarf admins.
- Cleric role changes should be audit logged.

Configuration:

- DAO contract address, share threshold, Hats IDs, Safe addresses, RPC URLs, and API keys must be environment-configured.
- No sensitive values should be committed to source control.

Member permissions:

- View current treasury balance homepage.
- View published/locked quarters.
- Generate/export reports for published quarters.
- View full audit/change history in an uncluttered history area.

Cleric permissions:

- Add manual raid revenue entries.
- Add manual raid payout entries.
- Link spoils inflows to raids.
- Use transaction lookup for Gnosis, Arbitrum, Optimism, Ethereum mainnet, and Base.
- Create flagged unverified manual entries when no transaction hash exists.
- View raids and related clients/subcontractors needed for their accounting workflow.

Angry Dwarf admin permissions:

- Fetch/import data.
- Classify transactions.
- Create and edit clients, raids, providers, subcontractors, RIPs, and address book records.
- Grant and revoke Cleric roles.
- Add side-vaults.
- Import bank CSVs.
- Manage quarter workflow states.
- Lock, publish, reopen, and republish quarters.

## 6. Quarter Workflow

Quarter data is prepared by Angry Dwarf admins before members can inspect or export it.

Quarter statuses:

- Draft: admins are importing and classifying data.
- Ready for Review: admins believe the quarter is complete.
- Published/Locked: members can view/export; data is read-only.
- Reopened: a previously published quarter has been reopened for correction.

Published quarters should have:

- Published timestamp.
- Last updated timestamp.
- Status history.
- Audit history.
- User-facing export label based on date, such as "Q1 2026, last published April 12, 2026".

Reopening a quarter:

- Requires Angry Dwarf admin access.
- Records who reopened it, when, and why.
- Makes the quarter editable again.
- Should visibly mark the quarter as reopened until republished.

## 7. Homepage

The homepage should always be visible to members who pass wallet access control, even before any quarter is published.

Homepage content:

- Current total treasury balance in USD.
- Asset breakdown.
- Account breakdown.
- Published quarter cards.
- Export buttons for published quarters.

The homepage should not include a recent activity feed in V1.

Balance refresh behavior:

- The homepage serves the latest cached treasury balance immediately.
- Any authenticated member may trigger a background refresh when cached balance data is missing or older than one hour.
- Stale data should remain readable and dated, with clear sync timing and subtle refreshing/updated UI states.

## 8. Data Sources

### Main Safe

The first automated onchain source is the main RaidGuild Safe on Gnosis.

The main Safe address is environment-configured.

The app should fetch current balances for USDC, xDAI, wxDAI, and wETH through the configured Gnosis RPC. Stable assets are valued 1:1 with USD. wETH uses CoinGecko pricing when available, with the API key optional.

Later main Safe ingestion should fetch:

- Native transfers.
- ERC-20 transfers.
- Safe transaction metadata where useful.
- Transaction hashes and timestamps.

### Side-Vaults

Side-vaults come after main Safe support.

Side-vault records are admin-managed address book entries.

Fields:

- Name.
- Address.
- Network/type.
- Notes.
- Whether DAO-controlled or independent multisig.

Side-vault behavior:

- Queried alongside the main treasury.
- Included in balances and reports.
- Labeled by source account.
- Some side-vaults are controlled by DAO proposals.
- Some are separate multisigs and will not have DAO proposal links.

### DAO Proposals

The app should fetch DAO proposals that moved money during execution.

Proposal linking rule:

- Proposal execution transaction hash should match the treasury transaction hash.
- This link should be inferred automatically.

The proposals page should show proposal-associated expenses and other money-moving proposal activity.

### Manual Raid Activity

Treasury scanning is not enough to capture all raid activity.

Common workflow:

- A Cleric/account manager may receive raid revenue outside the tracked treasury accounts.
- The Cleric may pay the team/subcontractors separately.
- Only the 10% spoils may later reach the treasury or old side-vault.

The app therefore needs manual accounting flows that can still be verified by tx hash where possible.

Manual raid revenue flow:

- Cleric or admin pastes a transaction hash and selects or infers chain.
- App fetches transaction details and native/ERC-20 transfers.
- Cleric or admin selects relevant transfer(s).
- Cleric or admin links revenue to client and raid.
- Cleric or admin can split one payment across multiple raids, though this is rare.
- If no tx hash exists, Cleric or admin can create an unverified manual entry that is clearly flagged.

Manual raid payout flow:

- Cleric or admin pastes a transaction hash and selects or infers chain.
- App fetches transaction details and transfer lines.
- Cleric or admin selects relevant transfer(s).
- Cleric or admin allocates payout lines to raid and subcontractors.
- One transaction can pay multiple subcontractors.
- If no tx hash exists, Cleric or admin can create an unverified manual entry that is clearly flagged.

Spoils linking flow:

- Cleric or admin links a spoils inflow to a raid.
- Spoils inflow usually appears as a treasury or old side-vault transaction.
- The app should compare linked spoils against the expected 10% of gross raid revenue.
- Underpaid, overpaid, or missing spoils should be visible in raid accounting views and exports.

Manual entry verification states:

- Verified: backed by fetched onchain transaction/transfer.
- Unverified: hand-entered and clearly flagged in dashboard and exports.

### Bank CSVs

Bank CSV support comes later in V1.

Rules:

- Upload CSV through dashboard.
- Parse into normalized bank transaction rows.
- Discard the original uploaded file after import.
- Store only necessary imported fields.
- Encrypt sensitive stored fields.
- Support duplicate detection across imports.

## 9. Domain Objects

### Member

Represents a DAO member or wallet with relevant access/accounting activity.

Fields may include:

- Wallet address.
- Current share count.
- Access role derived from DAO shares and Hats Protocol.
- Membership dues/join activity.
- Ragequit activity.

### Client

Fields:

- Name.
- Optional website.
- Optional wallet/address list.
- Optional notes.
- Associated raids/projects.

### Raid

Raid means project/client engagement.

Fields:

- Client.
- Raid/project name.
- Optional notes.
- Gross revenue allocations.
- Expected 10% spoils.
- Expected 90% subcontractor pool.
- Actual subcontractor payouts.
- Remaining/unpaid payout balance.

### Subcontractor

Lightweight non-sensitive address book record.

Fields:

- Display name.
- Wallet address.
- Optional notes.
- Optional member marker.

No legal identity fields or tax documents in V1.

### Provider

Service provider profile for non-raid expenses.

Fields:

- Provider name.
- Wallet/address list.
- Category, such as software, legal, accounting, or ops.
- Optional notes.

### Treasury Account

Represents main Safe or side-vault.

Fields:

- Name.
- Address.
- Chain.
- Account type.
- DAO-controlled flag.
- Notes.

### Proposal

Only money-moving proposals are in scope for V1 proposal pages.

Fields:

- Proposal ID.
- Title.
- Status.
- Execution transaction hash.
- Processed/executed date.
- Linked treasury transaction(s).
- Amounts and assets moved.

### RIP

RIPs are paid through proposals or side-vault transactions and usually have an external ticket link.

Fields:

- Title.
- External link, such as a GitHub issue.
- Optional notes.
- Status.
- Linked proposal or transaction(s).
- Linked subcontractor/payee records.
- Total amount paid.

RIP page requirements:

- List RIPs.
- Show total paid.
- Link payees/subcontractors.
- Rank most expensive and least expensive RIPs.

### Transaction / Ledger Entry

The system should distinguish observed transactions from manual accounting events.

Observed transaction sources:

- Main Safe.
- Side-vaults.
- DAO proposal executions.
- Bank CSV imports.

Manual accounting event sources:

- Manual raid revenue entries.
- Manual raid payout entries.
- Unverified hand-entered entries.

Starter classification categories:

- Raid revenue.
- Subcontractor payout.
- Provider expense.
- Member dues.
- Ragequit.
- Transfer between treasury accounts.
- Uncategorized.

## 10. Reporting And Export

First target:

- Complete Q1 2026 export.

Primary format:

- XLSX workbook.

Q1 definition:

- Calendar Q1: January 1 through March 31, 2026.

Workbook tabs:

- Summary.
- Taxable Revenue.
- P&L.
- Raid Revenue & Spoils.
- Subcontractor Payouts.
- Provider Expenses.
- Proposals.
- RIPs.
- Membership Activity.
- Full Ledger.

Exports should include:

- Source transaction hashes where available.
- Source account.
- Chain.
- Asset.
- USD value.
- Classification.
- Linked client/raid/provider/subcontractor/RIP/proposal where applicable.
- Verification flag.
- Quarter status.
- Last published/updated date.

Membership activity should also be available as its own report/export:

- Member dues / joins.
- Ragequits.
- Transaction hashes.
- Wallet/member.
- Asset and USD value.
- Date/quarter/year.

## 11. Security And Privacy

The repo is public.

Never commit:

- Safe addresses.
- DAO contract addresses.
- Hat IDs.
- RPC URLs.
- API keys.
- Bank CSV samples.
- Real transaction classification data.
- Real client/provider/subcontractor data.

Use environment variables or secret manager values for all sensitive configuration.

Database:

- Hosted Postgres using Neon.
- App-level authorization based on wallet session, DAO shares, and Hats admin status.
- Audit logs for sensitive actions and quarter workflow changes.

Application-layer encryption:

- Sensitive fields should be encrypted before storage, in addition to provider-level database encryption.
- Encryption key should come from environment/secret manager.

Fields to encrypt:

- Bank memo/description.
- Notes.
- Client/provider/subcontractor optional notes.
- Private external links.
- Entity display names if relationships are considered sensitive.

Fields that do not require app-layer encryption by default:

- Public transaction hashes.
- Dates.
- Amounts.
- Token symbols.
- Public addresses.

## 12. Tech Stack

Core app:

- Next.js.
- TypeScript.
- Tailwind CSS.
- shadcn/ui customized to RaidGuild brand guidelines.

Auth and EVM:

- SIWE for wallet login.
- viem/wagmi for EVM reads and wallet integration.

Database:

- Neon Postgres.
- Drizzle ORM.

Hosting:

- Vercel.
- Target subdomain: accounting.raidguild.org.

Data integrations:

- Safe/Gnosis APIs plus RPC fallback.
- DAOhaus/Moloch DAO reads.
- Hats Protocol data for Angry Dwarf admin checks.
- CoinGecko historical pricing for wETH.

Exports:

- Server-side XLSX generation.

## 13. PR-Sized Implementation Plan

Each step should be its own PR.

1. Project scaffold
   - Next.js, TypeScript, Tailwind, shadcn/ui, linting, env conventions, base layout.

2. Database foundation
   - Neon/Drizzle setup, migrations, core tables, encrypted-field utility, audit-log table.

3. Wallet auth + permissions
   - SIWE login, session handling, DAO share read gate, Hats admin gate, database-managed Cleric role gate.

4. Member homepage
   - Current treasury balance UI with mocked/configured data shape, asset/account breakdown.

5. Main Safe ingestion
   - Gnosis Safe/RPC integration, import balances/transactions from env-configured main Safe.

6. Quarter workspace model
   - Q1 workspace, statuses, draft/review/published/reopened flow, quarter audit history.

7. Core entity management
   - Clients, raids, providers, subcontractors, address book CRUD with admin-only writes.

8. Transaction classification
   - Classify imported transactions, link to entities, categories, notes, verification/source metadata.

9. Raid accounting views
   - Raid revenue, 10% spoils calculation, subcontractor payout summaries, unpaid/remaining views.

10. DAO proposal linking
    - Fetch money-moving proposals, link by execution tx hash, proposal expense page.

11. Membership activity reports
    - Member dues/joins and ragequit classification/report pages.

12. Side-vault address book
    - Admin-managed Gnosis side-vaults, source account labeling.

13. Side-vault ingestion
    - Balance/transaction scan for side-vaults, included in homepage and quarter workspaces.

14. Manual transaction lookup
    - Paste tx hash, support Gnosis/Arbitrum/Optimism/Ethereum/Base, fetch native/ERC-20 transfers.

15. Manual raid revenue flow
    - Cleric/admin flow to select transfer(s), allocate revenue to client/raid, support split revenue and flagged unverified entries.

16. Manual raid payout flow
    - Cleric/admin flow to select transfer(s), allocate payout lines to raid/subcontractors, support split payouts and flagged unverified entries.

17. Spoils linking flow
    - Cleric/admin flow to link spoils inflows to raids and compare actual spoils against expected 10%.

18. RIP tracking
    - RIP CRUD, external links, linked tx/proposals/payees, most/least expensive views.

19. Bank CSV import
    - Upload, parse, normalize rows, discard original file, encrypted sensitive fields, duplicate detection.

20. Bank transaction classification
    - Classify imported bank rows, link to quarter/entities/reports.

21. XLSX export
    - Q1 workbook with all required tabs, source hashes, verification flags, last published/updated date.

22. Publish/export polish
    - Member-facing published quarter view, export buttons, read-only locked state, final UI/security pass.

## 14. Open Questions

- Exact DAOhaus/Moloch contracts and read methods for shares, joins, ragequits, and proposal data.
- Exact Hats Protocol source and Hat ID for Angry Dwarf admin access.
- Whether CoinGecko free tier is sufficient for historical pricing volume.
- Exact bank CSV formats to support first.
- Whether side-vaults are all Gnosis in V1 or some side-vault scanning needs other chains.
- How much entity naming should be encrypted versus visible as normal app data.
- Whether published quarter exports should include internal audit history or only source/verification fields.
