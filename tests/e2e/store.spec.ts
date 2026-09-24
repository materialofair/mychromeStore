import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, mkdir, cp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
test("store navigation, download, responsive layout and cancel", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("bind")).toBeEnabled();
  await page.screenshot({
    path: "test-results/store-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "安装指南", exact: false })
    .first()
    .click();
  await expect(page.getByText("edge://extensions").first()).toBeVisible();
  await page
    .getByRole("button", { name: "发现扩展", exact: false })
    .first()
    .click();
  const download = page.waitForEvent("download");
  await page
    .locator('a[href="/releases/focus-notes-1.0.0.zip"]')
    .first()
    .click();
  expect((await download).suggestedFilename()).toContain("1.0.0");
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      value: () => Promise.reject(new DOMException("cancelled", "AbortError")),
    });
  });
  await page.reload();
  await page.getByTestId("bind").click();
  await expect(page.getByText("已取消，未开始新的更新。")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/store-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("real installed demo reloads to 1.1 and retains note", async () => {
  test.setTimeout(45000);
  const root = await mkdtemp(join(tmpdir(), "space-e2e-"));
  const extension = join(root, "extension");
  await cp(resolve("demo/focus-notes-1.0.0"), extension, { recursive: true });
  await mkdir(join(root, "profile", "Default"), { recursive: true });
  await writeFile(
    join(root, "profile", "Default", "Preferences"),
    JSON.stringify({ extensions: { ui: { developer_mode: true } } }),
  );
  const context = await chromium.launchPersistentContext(
    join(root, "profile"),
    {
      headless: true,
      channel: "chromium",
      executablePath: process.env.CHROMIUM_PATH,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  try {
    const manager = await context.newPage();
    await manager.goto("chrome://extensions");
    await manager.locator("#devMode").click();
    const id = JSON.parse(await readFile("demo/identity.json", "utf8")).id;
    let popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator("#note").fill("更新后，这条笔记仍然在。");
    await expect(popup.locator("#saved")).toHaveText("已保存在此浏览器");
    const page = await context.newPage();
    await page.goto("http://localhost:5173");
    const ping = () =>
      page.evaluate(async (id) => {
        const c = (window as any).chrome;
        return c.runtime.sendMessage(id, {
          scope: "space-store/v1",
          type: "PING",
        });
      }, id);
    expect((await ping()).version).toBe("1.0.0");
    console.log("runtime 1.0 verified");
    // A copied directory shares identity but isn't loaded: never report its update as running.
    expect(
      await page.evaluate(async () => {
        const core = await import(String("/src/core.ts"));
        const store = await import(String("/src/storage.ts"));
        const bridge = await import(String("/src/bridge.ts"));
        const c = await (await fetch("/releases/catalog.json")).json(),
          old = await (await fetch("/releases/1.0.0.json")).json(),
          next = await (await fetch("/releases/1.1.0.json")).json();
        const dir = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle("copy", { create: true });
        for (const [path, bytes] of Object.entries(
          (await core.validateRelease(old, c)).data,
        )) {
          const w = await (
            await dir.getFileHandle(path, { create: true })
          ).createWritable();
          await w.write(bytes as any);
          await w.close();
        }
        await core.install(dir, old, next, c, store.journal);
        return bridge.reloadAndVerify(c.extensionId, "1.1.0");
      }),
    ).toBe(false);
    expect((await ping()).version).toBe("1.0.0");
    console.log("runtime 1.0 verified");
    // This test validates real reload/storage. Browser FSA transaction is separately tested with OPFS.
    await cp(resolve("demo/focus-notes-1.1.0"), extension, { recursive: true });
    await page.evaluate(
      async (id) =>
        (window as any).chrome.runtime.sendMessage(id, {
          scope: "space-store/v1",
          type: "RELOAD",
          version: "1.1.0",
        }),
      id,
    );
    await expect
      .poll(async () => {
        try {
          return (await ping()).version;
        } catch {
          return null;
        }
      })
      .toBe("1.1.0");
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(popup.locator("#note")).toHaveValue(
      "更新后，这条笔记仍然在。",
    );
    await expect(popup.locator("#new-feature")).toBeVisible();
    await popup.locator("#theme").click();
    await expect(popup.locator("body")).toHaveClass("rose");
    await popup.screenshot({ path: "test-results/demo-1.1.png" });
    const wrong = await context.newPage();
    await wrong.goto("http://localhost:5173");
    expect(
      await wrong.evaluate(async (id) => {
        try {
          return (
            (await (window as any).chrome.runtime.sendMessage(id, {
              scope: "wrong",
              type: "RELOAD",
              version: "1.1.0",
            })) ?? null
          );
        } catch {
          return null;
        }
      }, id),
    ).toBeNull();
    console.log("updated runtime and note verified");
    const other = createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>untrusted port</title>");
    });
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    try {
      const address = other.address() as { port: number };
      await wrong.goto(`http://localhost:${address.port}`);
      expect(
        await wrong.evaluate(async (id) => {
          try {
            return (
              (await (window as any).chrome.runtime.sendMessage(id, {
                scope: "space-store/v1",
                type: "RELOAD",
                version: "1.1.0",
              })) ?? null
            );
          } catch {
            return null;
          }
        }, id),
      ).toBeNull();
      expect((await ping()).version).toBe("1.1.0");
    } finally {
      other.closeAllConnections();
      await new Promise<void>((r, j) => other.close((e) => (e ? j(e) : r())));
    }
  } finally {
    await context.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("browser filesystem transaction persists backup, applies and restores", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const core = await import(/* @vite-ignore */ String("/src/core.ts"));
    const storage = await import(/* @vite-ignore */ String("/src/storage.ts"));
    const dir = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("demo", { create: true });
    const c = await (await fetch("/releases/catalog.json")).json(),
      old = await (await fetch("/releases/1.0.0.json")).json(),
      next = await (await fetch("/releases/1.1.0.json")).json();
    for (const [path, bytes] of Object.entries(
      (await core.validateRelease(old, c)).data,
    )) {
      const w = await (
        await dir.getFileHandle(path, { create: true })
      ).createWritable();
      await w.write(bytes as any);
      await w.close();
    }
    await storage.exclusive(() =>
      core.install(dir as any, old, next, c, storage.journal),
    );
    return {
      version: await core.inspect(dir as any, c),
      backup: (await storage.journal.get())?.status,
    };
  });
  expect(result).toEqual({ version: "1.1.0", backup: "applied" });
  await page.reload();
  expect(
    await page.evaluate(async () => {
      const { journal } = await import(
        /* @vite-ignore */ String("/src/storage.ts")
      );
      return (await journal.get())?.status;
    }),
  ).toBe("applied");
  await page.evaluate(async () => {
    const { restore } = await import(/* @vite-ignore */ String("/src/core.ts"));
    const { journal } = await import(
      /* @vite-ignore */ String("/src/storage.ts")
    );
    await restore(journal);
  });
  expect(
    await page.evaluate(async () => {
      const { journal } = await import(
        /* @vite-ignore */ String("/src/storage.ts")
      );
      return (await journal.get())?.status;
    }),
  ).toBe("restored");
});
test("pending recovery survives reload and blocks new updates; concurrent tab cannot write", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { journal } = await import(String("/src/storage.ts"));
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("interrupted", { create: true });
    await journal.put({
      directory,
      status: "pending",
      from: "1.0.0",
      to: "1.1.0",
      createdAt: new Date().toISOString(),
      before: {},
      after: {},
    });
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("尚未完成");
  await expect(page.getByTestId("bind")).toBeDisabled();
  await page.evaluate(() => {
    (window as any).locked = navigator.locks.request(
      "space-store-update",
      () =>
        new Promise<void>((r) => {
          (window as any).releaseLock = r;
        }),
    );
  });
  await page.waitForFunction(() => !!(window as any).releaseLock);
  const second = await context.newPage();
  await second.goto("/");
  expect(
    await second.evaluate(async () => {
      const { exclusive } = await import(String("/src/storage.ts"));
      try {
        await exclusive(async () => true);
        return "unexpected success";
      } catch (e) {
        return (e as Error).message;
      }
    }),
  ).toContain("另一个");
  await page.evaluate(() => (window as any).releaseLock());
});
