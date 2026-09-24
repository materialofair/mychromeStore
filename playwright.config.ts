import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
  },
  reporter: "list",
});
