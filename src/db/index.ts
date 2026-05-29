import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";

let cachedDb: ReturnType<typeof createDb> | undefined;

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize the database");
  }

  return drizzle(neon(databaseUrl), { schema });
}

export function getDb() {
  cachedDb ??= createDb();
  return cachedDb;
}

export type Db = ReturnType<typeof getDb>;
