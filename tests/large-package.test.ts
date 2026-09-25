import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import { parsePackage, extractPackage } from "../server/package";
import { validateRelease, type Catalog } from "../src/core";
const original = new Uint8Array(
  readFileSync("public/releases/focus-notes-1.0.0.zip"),
);
const files = extractPackage(original);
function catalog(
  release: Awaited<ReturnType<typeof parsePackage>>["release"],
): Catalog {
  return {
    extensionId: release.extensionId,
    key: release.key,
    name: release.name,
    latestVersion: release.version,
    versions: [release.version],
    storeOrigin: "http://localhost:5173",
  };
}
test("server and client accept 125 files and a 14 MiB WASM without regexp stack overflow", async () => {
  const extra: Record<string, Uint8Array> = {};
  for (let i = 0; i < 119; i++) extra[`asset-${i}.js`] = new Uint8Array([i]);
  const wasm = new Uint8Array(14 * 1024 * 1024);
  wasm[0] = 0;
  wasm[1] = 97;
  wasm[2] = 115;
  wasm[3] = 109;
  const parsed = await parsePackage(
    zipSync({ ...files, ...extra, "assets/large.wasm": wasm }, { level: 1 }),
  );
  expect(parsed.release.files).toHaveLength(125);
  const verified = await validateRelease(
    parsed.release,
    catalog(parsed.release),
  );
  expect(verified.data["assets/large.wasm"].byteLength).toBe(wasm.byteLength);
  expect(verified.data["assets/large.wasm"].slice(0, 4)).toEqual(
    wasm.slice(0, 4),
  );
}, 15000);
test("client rejects malformed base64, false length and excessive declared size before decoding", async () => {
  const { release } = await parsePackage(original),
    c = catalog(release);
  for (const [bytes, content] of [
    [1, "AA=A"],
    [1, "AAAA"],
    [2, "A==="],
    [1, "AA\n="],
    [0, "AAAA"],
    [24 * 1024 * 1024 + 1, ""],
  ] as const) {
    await expect(
      validateRelease(
        {
          ...release,
          files: [
            ...release.files,
            { path: "invalid.bin", bytes, content, sha256: "0".repeat(64) },
          ],
        },
        c,
      ),
    ).rejects.toThrow("大小或编码");
  }
});
test("ZIP file and entry bounds stay explicit", () => {
  const boundary: Record<string, Uint8Array> = {
    "manifest.json": files["manifest.json"],
  };
  for (let i = 0; i < 511; i++) boundary[`file-${i}`] = new Uint8Array();
  expect(Object.keys(extractPackage(zipSync(boundary)))).toHaveLength(512);
  boundary.extra = new Uint8Array();
  expect(() => extractPackage(zipSync(boundary))).toThrow("512");
  const dirs: Record<string, {}> = {};
  for (let i = 0; i < 1025; i++) dirs[`dir-${i}`] = {};
  expect(() => extractPackage(zipSync(dirs))).toThrow();
});
