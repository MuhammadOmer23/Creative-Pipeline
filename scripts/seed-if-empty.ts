import pg from "pg";
import { seedFixtures } from "../src/server/fixtures";

async function main() {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  if (url === "") {
    console.log("seed: nothing to do");
    return;
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED?.trim() || url });
  await client.connect();
  try {
    const existing = await client.query("select count(*)::int as n from accounts");
    if (existing.rows[0].n > 0) {
      console.log("seed: accounts already present");
    } else if (!process.env.FIXTURE_PASSWORD?.trim()) {
      console.log("seed: skipped, fixture password is not configured");
    } else {
      await seedFixtures(client);
      console.log("seed: fixture accounts added");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
