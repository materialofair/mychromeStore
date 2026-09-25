import { test, expect, type Page } from "@playwright/test";
import { createApp, bootstrap } from "../../server/app";
import { generateKeyPairSync } from "node:crypto";
import { zipSync } from "fflate";
import { resolve } from "node:path";

const origin = "http://localhost:8791";
let app: ReturnType<typeof createApp>;
const password = "only-for-isolated-tests-2026";
const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .publicKey.export({ format: "der", type: "spki" })
  .toString("base64");
function archive(version: string) {
  return Buffer.from(
    zipSync({
      "manifest.json": Buffer.from(
        JSON.stringify({
          manifest_version: 3,
          name: "Portal QA Tool",
          version,
          key,
          description: "真实上传审核测试",
          permissions: ["storage"],
        }),
      ),
      "popup.html": Buffer.from("<!doctype html><title>QA</title>"),
    }),
  );
}
async function login(page: Page, username: string) {
  await page.locator("#login-form [name=username]").fill(username);
  await page.locator("#login-form [name=password]").fill(password);
  await page.locator("#login-form button[type=submit]").click();
  await expect(page.locator("#logout")).toBeVisible();
}
async function logout(page: Page) {
  await page.locator("#logout").click();
  await expect(page.locator("#login-form")).toBeVisible();
}
test.beforeAll(async () => {
  app = createApp({ dbPath: ":memory:", origin, staticDir: resolve("dist") });
  await bootstrap(app.db, "qa_admin", password);
  await new Promise<void>((done, reject) => {
    app.server.once("error", reject);
    app.server.listen(8791, "127.0.0.1", done);
  });
});
test.afterAll(async () => {
  await app?.close();
});
test("admin creates roles, developer submits, reviewer publishes, public downloads, admin unpublishes", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/publish.html`);
  await login(page, "qa_admin");
  await page.locator("[data-page=users]").click();
  for (const [username, role] of [
    ["qa_dev", "developer"],
    ["qa_reviewer", "reviewer"],
  ]) {
    const form = page.locator("#create-user-form");
    await form.locator("[name=username]").fill(username);
    await form.locator("[name=password]").fill(password);
    await form.locator("[name=role]").selectOption(role);
    await form.locator("button[type=submit]").click();
    await expect(
      page
        .locator(".user-card")
        .filter({
          has: page.getByRole("heading", { name: username, exact: true }),
        }),
    ).toBeVisible();
  }
  await logout(page);
  await login(page, "qa_dev");
  await page.locator("[data-page=submissions]").click();
  await page
    .locator("#zip-file")
    .setInputFiles({
      name: "qa-1.0.0.zip",
      mimeType: "application/zip",
      buffer: archive("1.0.0"),
    });
  await page.locator("#upload-form button[type=submit]").click();
  await expect(page.locator(".submission-row")).toHaveCount(1);
  await expect(page.locator(".submission-row")).toContainText("待审核");
  const visitor = await browser.newContext();
  try {
    const publicPage = await visitor.newPage();
    await publicPage.goto(`${origin}/publish.html`);
    await expect(publicPage.locator(".portal-extension")).toHaveCount(0);
    await logout(page);
    await login(page, "qa_reviewer");
    await page.locator("[data-page=submissions]").click();
    await page.locator(".submission-row").click();
    await expect(page.locator(".permission.added")).toContainText("storage");
    await page
      .locator("#review-form textarea")
      .fill("已检查源码与权限，批准发布");
    await page.locator("#review-form button[value=approved]").click();
    await expect(page.locator(".submission-row")).toContainText("已发布");
    await publicPage.reload();
    await expect(publicPage.locator(".portal-extension")).toContainText(
      "Portal QA Tool",
    );
    const link = publicPage.locator(".portal-extension a[download]");
    const url = await link.getAttribute("href");
    expect(url).toMatch(
      /^\/api\/extensions\/[a-p]{32}\/releases\/1\.0\.0\.zip$/,
    );
    const downloaded = publicPage.waitForEvent("download");
    await link.click();
    expect((await downloaded).suggestedFilename()).toContain("1.0.0");
    await publicPage.screenshot({
      path: "test-results/publishing-desktop.png",
      fullPage: true,
    });
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await publicPage.screenshot({
      path: "test-results/publishing-mobile.png",
      fullPage: true,
    });
    expect(
      await publicPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await logout(page);
    await login(page, "qa_dev");
    await page.locator("[data-page=submissions]").click();
    await page
      .locator("#zip-file")
      .setInputFiles({
        name: "qa-1.1.0.zip",
        mimeType: "application/zip",
        buffer: archive("1.1.0"),
      });
    await page.locator("#upload-form button[type=submit]").click();
    await expect(page.locator(".submission-row")).toHaveCount(2);
    await publicPage.reload();
    await expect(publicPage.locator(".portal-extension")).toContainText(
      "v1.0.0",
    );
    expect(
      (
        await publicPage.request.get(
          `${origin}${url!.replace("1.0.0", "1.1.0")}`,
        )
      ).status(),
    ).toBe(404);
    await logout(page);
    await login(page, "qa_admin");
    await page.locator("[data-page=submissions]").click();
    await page.locator(".submission-row").filter({ hasText: "v1.0.0" }).click();
    await page.locator("#unpublish-form textarea").fill("QA 验证下架");
    await page.locator("#unpublish-form button[type=submit]").click();
    await expect(
      page.locator(".submission-row").filter({ hasText: "v1.0.0" }),
    ).toContainText("已下架");
    expect((await publicPage.request.get(`${origin}${url}`)).status()).toBe(
      404,
    );
    await publicPage.reload();
    await expect(publicPage.locator(".portal-extension")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await visitor.close();
  }
});
