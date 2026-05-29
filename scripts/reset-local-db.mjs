import { spawn } from "node:child_process";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PROTECTED_DATABASES = new Set(["postgres", "template0", "template1"]);
const isDryRun = process.argv.includes("--dry-run");

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to reset the local database");
  }

  return new URL(databaseUrl);
}

function validateLocalDatabase(url) {
  const databaseName = url.pathname.replace(/^\//, "");

  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      "Refusing to reset a non-local database. Use a localhost DATABASE_URL.",
    );
  }

  if (!databaseName || PROTECTED_DATABASES.has(databaseName)) {
    throw new Error(`Refusing to reset protected database "${databaseName}"`);
  }

  return databaseName;
}

function runMigration() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["db:migrate"], {
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`pnpm db:migrate exited with code ${code}`));
    });
  });
}

let client;

try {
  const databaseUrl = getDatabaseUrl();
  const databaseName = validateLocalDatabase(databaseUrl);

  if (isDryRun) {
    console.log(
      `Would reset local database "${databaseName}" at ${databaseUrl.host}`,
    );
    process.exit(0);
  }

  client = new Client({ connectionString: databaseUrl.toString() });

  console.log(`Resetting local database "${databaseName}"...`);
  await client.connect();
  await client.query("drop schema if exists public cascade");
  await client.query("create schema public");
  await client.query("grant all on schema public to public");
  await client.end();
  await runMigration();
  console.log(`Local database "${databaseName}" reset successfully.`);
} catch (error) {
  await client?.end().catch(() => {});
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
