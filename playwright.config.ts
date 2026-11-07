import { readFileSync } from "fs";
import { defineConfig } from "@playwright/test";

function loadEnvFile() {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Local secrets stay outside the repository.
  }
}

loadEnvFile();

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      FIXTURE_PASSWORD: process.env.FIXTURE_PASSWORD ?? "",
    },
  },
});
