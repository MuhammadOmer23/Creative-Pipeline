import { readFileSync } from "fs";
import { getPool } from "../src/server/db";
import { seedFixtures } from "../src/server/fixtures";

export function loadEnvFile() {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // The caller can set DATABASE_URL directly.
  }
}

export async function resetDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("creative_pipeline")) {
    throw new Error("Refusing to reset a database that is not a creative pipeline database.");
  }
  const pool = getPool();
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pool.query(readFileSync("sql/schema.sql", "utf8"));
  await seedFixtures(pool);
}

async function main() {
  loadEnvFile();
  const fromArg = process.argv.find((arg) => arg.startsWith("--database="));
  if (fromArg) process.env.DATABASE_URL = fromArg.slice("--database=".length);
  await resetDatabase();
  console.log(`Reset ${process.env.DATABASE_URL}`);
  await getPool().end();
}

if (process.argv[1]?.includes("setup-db")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
