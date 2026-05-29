# RaidGuild Accounting

Wallet-gated accounting dashboard for RaidGuild treasury reporting.

The project plan and product specification live in [PROJECT_SPEC.md](./PROJECT_SPEC.md).

## Getting Started

Install dependencies:

```bash
pnpm install
```

Copy local environment placeholders:

```bash
cp .env.example .env.local
```

Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Scripts

- `pnpm dev`: start the local Next.js dev server.
- `pnpm build`: create a production build.
- `pnpm start`: run the production build.
- `pnpm lint`: run ESLint.
- `pnpm db:generate`: generate Drizzle SQL migrations from the schema.
- `pnpm db:migrate`: apply Drizzle migrations to `DATABASE_URL`.
- `pnpm db:reset:local`: drop and recreate the local `public` schema, then run migrations.
- `pnpm db:studio`: open Drizzle Studio for local database inspection.

## Stack

- Next.js App Router.
- TypeScript.
- Tailwind CSS.
- shadcn/ui.
- Neon Postgres.
- Drizzle ORM.
- RaidGuild brand color tokens.

## Security Notes

The repo is public. Do not commit real treasury addresses, DAO addresses, RPC URLs, API keys, bank data, or classified accounting records.

Use `.env.local` for local secrets. `.env.example` should contain only placeholder keys.
Drizzle CLI commands also load `.env`, with `.env.local` overriding it when present.
The app targets Neon in production. At runtime it uses Neon HTTP for Neon URLs and the standard `pg` driver for localhost database URLs, so local Postgres works in both the app and migrations.
`pnpm db:reset:local` refuses non-localhost database URLs and protected database names, but it is still destructive for the selected local database.

RaidGuild member access is checked with `DAO_SHARE_TOKEN_ADDRESS`, the DAOhaus/Baal ERC-20 shares token. `DAO_SHARE_THRESHOLD` is written as a human share amount such as `100`.
`ANGRY_DWARF_HAT_ID` can be provided as a decimal or hex string.

`ENCRYPTION_KEY` must be a base64-encoded 32-byte key. Multiple-key rotation requires stable `key-id:base64-key` entries. To generate a local development key:

```bash
openssl rand -base64 32
```

`SESSION_SECRET` must be at least 32 characters. To generate a local development value:

```bash
openssl rand -base64 32
```

## Database Deployment

The `Database` GitHub Actions workflow checks generated migrations on pull requests and applies committed migrations on pushes to `main`.

Production migrations require a GitHub Actions production environment secret named `DATABASE_URL`.

If Vercel is deployed through the Git integration, its production build may start at the same time as the migration workflow. For strict migration-before-deploy ordering, deploy Vercel from GitHub Actions after the migration job instead of using Vercel's automatic Git deployment.

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
