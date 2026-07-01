import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3131);
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  outputDir: "test-results/e2e",
  reporter: [["list"], ["html", { open: "never" }]],
  testDir: "./tests/e2e",
  timeout: 45_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `E2E_AUTH_ENABLED=true COREPACK_HOME=/tmp/corepack corepack pnpm exec next dev -H ${host} -p ${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
  projects: [
    {
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        viewport: { height: 844, width: 390 },
      },
    },
    {
      name: "small-mobile",
      use: {
        ...devices["Pixel 5"],
        viewport: { height: 740, width: 360 },
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["iPad (gen 7)"],
        browserName: "chromium",
        viewport: { height: 1024, width: 768 },
      },
    },
    {
      name: "desktop",
      use: {
        viewport: { height: 900, width: 1440 },
      },
    },
  ],
});
