// Isolated acceptance harness: native directory picker is driven manually, never mocked.
import { chromium } from "playwright";
import { mkdtemp, cp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = await mkdtemp(join(tmpdir(), "space-native-")),
  extension = join(root, "focus-notes");
await cp(resolve("demo/focus-notes-1.0.0"), extension, { recursive: true });
console.log("SELECT THIS TEST DIRECTORY:", extension);
const c = await chromium.launchPersistentContext(join(root, "profile"), {
  headless: false,
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: { width: 1440, height: 1000 },
});
try {
  const manager = await c.newPage();
  await manager.goto("chrome://extensions");
  if (!(await manager.locator("#devMode").evaluate((e) => e.checked)))
    await manager.locator("#devMode").click();
  const id = JSON.parse(await readFile("demo/identity.json", "utf8")).id;
  let popup = await c.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator("#note").fill("原生目录更新后保留这条便签");
  await popup.waitForFunction(
    () => document.querySelector("#saved").textContent === "已保存在此浏览器",
  );
  const page = await c.newPage();
  await page.goto("http://localhost:5173");
  await page.getByTestId("bind").click();
  console.log(
    "Native picker open: select directory and grant edit permission.",
  );
  await page
    .getByTestId("disk-version")
    .filter({ hasText: "v1.0.0" })
    .waitFor({ timeout: 180000 });
  console.log("BOUND real directory; updating from website");
  await page.getByTestId("update").click();
  await page
    .getByTestId("runtime-version")
    .filter({ hasText: "v1.1.0" })
    .waitFor({ timeout: 60000 });
  await mkdir("docs/qa", { recursive: true });
  await page.screenshot({
    path: "docs/qa/native-update-success.png",
    fullPage: true,
  });
  popup = await c.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator("#note").filter({}).waitFor();
  if (
    (await popup.locator("#note").inputValue()) !== "原生目录更新后保留这条便签"
  )
    throw new Error("Note not preserved");
  console.log(
    "PASS: real external directory -> durable backup -> website write -> native reload -> version 1.1.0 -> note preserved",
  );
  await page.reload();
  await page
    .getByTestId("disk-version")
    .filter({ hasText: "v1.1.0" })
    .waitFor({ timeout: 10000 });
  console.log("PASS: directory handle and backup survive page reload");
  await page.getByTestId("restore").click();
  await page
    .getByTestId("runtime-version")
    .filter({ hasText: "v1.0.0" })
    .waitFor({ timeout: 60000 });
  console.log("PASS: website restore returns running 1.0.0");
} finally {
  await c.close();
  await rm(root, { recursive: true, force: true });
}
