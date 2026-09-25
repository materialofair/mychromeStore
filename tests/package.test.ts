import { test, expect } from "vitest";
import { zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { extractPackage, parsePackage } from "../server/package";
const original = new Uint8Array(
  readFileSync("public/releases/focus-notes-1.0.0.zip"),
);
const files = extractPackage(original);
const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
function pack(
  patch: Record<string, unknown> = {},
  extra: Record<string, Uint8Array> = {},
) {
  return zipSync({
    ...files,
    "manifest.json": Buffer.from(JSON.stringify({ ...manifest, ...patch })),
    ...extra,
  });
}
function alterCentral(zip: Uint8Array, change: (b: Buffer, p: number) => void) {
  const b = Buffer.from(zip);
  let p = b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  change(b, p);
  return b;
}
test("valid demo ZIP produces matching stable identity and hashes", async () => {
  const result = await parsePackage(original);
  expect(result.release.extensionId).toBe("pmadfengihgmgkjenefbenhdclnibkbm");
  expect(result.permissions).toContain("permissions: storage");
  expect(result.permissions).toContain(
    "externally_connectable.matches: http://localhost/*",
  );
  expect(result.release.files).toHaveLength(5);
  expect((await parsePackage(result.zip)).release).toEqual(result.release);
});
test.each([
  "../escape.js",
  "/absolute.js",
  "Foo.js/child",
  "constructor",
  "CON.txt",
  "bad\\path",
])("rejects unsafe path %s", async (path) => {
  await expect(
    parsePackage(
      pack({}, { [path]: new Uint8Array([1]), "Foo.js": new Uint8Array([2]) }),
    ),
  ).rejects.toThrow();
});
test("rejects case collisions and duplicate archive names", async () => {
  await expect(
    parsePackage(pack({}, { "Popup.js": new Uint8Array([1]) })),
  ).rejects.toThrow();
  const b = zipSync({
    abc: new Uint8Array([1]),
    def: new Uint8Array([2]),
    "manifest.json": files["manifest.json"],
  });
  const text = Buffer.from(b);
  for (let p = 0; p < text.length - 2; p++)
    if (text.subarray(p, p + 3).toString() === "def") text.write("abc", p);
  await expect(parsePackage(text)).rejects.toThrow();
});
test.each([
  { version: "1.0" },
  { version: "01.0.0" },
  { version: "65536.0.0" },
  { version: "0.0.0" },
  { manifest_version: 2 },
  { key: "AAAA" },
  { permissions: [123] },
  { name: "__MSG_name__" },
])("rejects invalid manifest %j", async (patch) => {
  await expect(parsePackage(pack(patch))).rejects.toThrow();
});
test("rejects expanded limits and compressed archive limit", async () => {
  await expect(
    parsePackage(pack({}, { large: new Uint8Array(24 * 1024 * 1024 + 1) })),
  ).rejects.toThrow();
  await expect(
    parsePackage(new Uint8Array(32 * 1024 * 1024 + 1)),
  ).rejects.toThrow();
});
test("bounded inflate rejects forged small output size", async () => {
  const b = alterCentral(
    pack({}, { bomb: new Uint8Array(1024 * 1024) }),
    (buf, p) => {
      while (
        buf.subarray(p + 46, p + 46 + buf.readUInt16LE(p + 28)).toString() !==
        "bomb"
      )
        p +=
          46 +
          buf.readUInt16LE(p + 28) +
          buf.readUInt16LE(p + 30) +
          buf.readUInt16LE(p + 32);
      const local = buf.readUInt32LE(p + 42);
      buf.writeUInt32LE(1, p + 24);
      buf.writeUInt32LE(1, local + 22);
    },
  );
  await expect(parsePackage(b)).rejects.toThrow();
});
test("rejects header mismatches, symlinks and CRC damage", async () => {
  for (const mutate of [
    (b: Buffer, p: number) => b.writeUInt16LE(1, p + 8),
    (b: Buffer, p: number) => b.writeUInt32LE(0xa1ff0000, p + 38),
    (b: Buffer, p: number) => {
      b.writeUInt32LE(1, p + 16);
      b.writeUInt32LE(1, b.readUInt32LE(p + 42) + 14);
    },
  ])
    await expect(
      parsePackage(alterCentral(original, mutate)),
    ).rejects.toThrow();
});

test("reports content script access and rejects missing referenced code", async () => {
  const result = await parsePackage(
    pack({
      content_scripts: [
        { matches: ["https://example.com/*"], js: ["popup.js"] },
      ],
    }),
  );
  expect(result.permissions).toContain(
    "content_scripts.matches: https://example.com/*",
  );
  await expect(
    parsePackage(pack({ background: { service_worker: "missing.js" } })),
  ).rejects.toThrow("不存在");
});
test("accepts directory entries but rejects missing root manifest", async () => {
  const dir = zipSync({
    assets: {},
    "manifest.json": files["manifest.json"],
    "background.js": files["background.js"],
    "popup.html": files["popup.html"],
  });
  expect((await parsePackage(dir)).release.version).toBe("1.0.0");
  await expect(
    parsePackage(zipSync({ "nested/manifest.json": files["manifest.json"] })),
  ).rejects.toThrow("根目录");
});
test("rejects too many files and total expanded bytes", async () => {
  const extras: Record<string, Uint8Array> = {};
  for (let i = 0; i < 513; i++) extras[`file-${i}`] = new Uint8Array();
  await expect(parsePackage(pack({}, extras))).rejects.toThrow();
  for (const k of Object.keys(extras)) delete extras[k];
  for (let i = 0; i < 3; i++)
    extras[`large-${i}`] = new Uint8Array(24 * 1024 * 1024);
  await expect(parsePackage(pack({}, extras))).rejects.toThrow();
});
