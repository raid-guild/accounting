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

## Stack

- Next.js App Router.
- TypeScript.
- Tailwind CSS.
- shadcn/ui.
- RaidGuild brand color tokens.

## Security Notes

The repo is public. Do not commit real treasury addresses, DAO addresses, RPC URLs, API keys, bank data, or classified accounting records.

Use `.env.local` for local secrets. `.env.example` should contain only placeholder keys.

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
