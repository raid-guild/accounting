import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";

let cachedDb: ReturnType<typeof createDb> | undefined;

function isLocalDatabaseUrl(databaseUrl: string) {
  const hostname = new URL(databaseUrl).hostname.replace(/^\[(.*)\]$/, "$1");

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize the database");
  }

  if (isLocalDatabaseUrl(databaseUrl)) {
    return drizzleNode(databaseUrl, { schema });
  }

  return drizzle(neon(databaseUrl), { schema });
}

export function getDb() {
  cachedDb ??= createDb();
  return cachedDb;
}

export type Db = ReturnType<typeof getDb>;
