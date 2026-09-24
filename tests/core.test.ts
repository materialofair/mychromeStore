import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  hash,
  install,
  inspect,
  restore,
  validateRelease,
  validPath,
  type Backup,
  type Catalog,
  type Directory,
  type Journal,
  type Release,
} from "../src/core";
const catalog: Catalog = JSON.parse(
  readFileSync("public/releases/catalog.json", "utf8"),
);
const old: Release = JSON.parse(
  readFileSync("public/releases/1.0.0.json", "utf8"),
);
const next: Release = JSON.parse(
  readFileSync("public/releases/1.1.0.json", "utf8"),
);
class Disk implements Directory {
  name = "demo";
  files = new Map<string, Uint8Array>();
  writes = 0;
  failAt = 0;
  failAlways = false;
  async queryPermission() {
    return "granted" as const;
  }
  async requestPermission() {
    return "granted" as const;
  }
  async getDirectoryHandle(): Promise<Directory> {
    throw new Error("unused in flat demo");
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create)
      throw new DOMException("missing", "NotFoundError");
    return {
      getFile: async () => ({
        arrayBuffer: async () => new Uint8Array(this.files.get(name)!).buffer,
      }),
      createWritable: async () => {
        let staged: Uint8Array;
        return {
          write: async (data: Uint8Array) => {
            this.writes++;
            if (this.failAlways || this.writes === this.failAt)
              throw new Error("disk write failed");
            staged = new Uint8Array(data);
          },
          close: async () => {
            this.files.set(name, staged);
          },
          abort: async () => {},
        };
      },
    };
  }
  async removeEntry(name: string) {
    this.files.delete(name);
  }
}
async function setup() {
  const d = new Disk();
  for (const [p, v] of Object.entries(
    (await validateRelease(old, catalog)).data,
  ))
    d.files.set(p, v);
  let backup: Backup | undefined;
  const j: Journal = {
    get: async () => backup,
    put: async (b) => {
      backup = structuredClone({ ...b, directory: null }) as unknown as Backup;
      backup.directory = d;
    },
  };
  return { d, j };
}
describe("release validation", () => {
  test.each([
    "../a",
    "/a",
    "a/../b",
    "a\\b",
    "a//b",
    "a:evil",
    "CON.txt",
    "a/aux",
    "a.",
    "__proto__",
    "constructor",
    "toString",
  ])("rejects unsafe path %s", (p) => expect(() => validPath(p)).toThrow());
  test("rejects corrupt payload before writes", async () => {
    const r = structuredClone(next);
    r.files[0].sha256 = "bad";
    await expect(validateRelease(r, catalog)).rejects.toThrow("完整性");
  });
  test("rejects case collisions and identity mismatch", async () => {
    const r = structuredClone(next);
    r.files.push({ ...r.files[0], path: "MANIFEST.json" });
    await expect(validateRelease(r, catalog)).rejects.toThrow("重复");
    await expect(
      validateRelease({ ...next, key: "bad" }, catalog),
    ).rejects.toThrow("身份");
  });
  test("rejects oversized encoding and mismatched manifest", async () => {
    const r = structuredClone(next);
    r.files[0].bytes = 3 * 1024 * 1024;
    await expect(validateRelease(r, catalog)).rejects.toThrow("大小");
    await expect(
      validateRelease({ ...next, version: "1.0.0" }, catalog),
    ).rejects.toThrow("清单");
  });
});
describe("safe directory update", () => {
  test("updates 1.0 to 1.1, keeps unrelated file, backups then restores", async () => {
    const { d, j } = await setup();
    d.files.set("personal.txt", new Uint8Array([42]));
    await install(d, old, next, catalog, j);
    expect(await inspect(d, catalog)).toBe("1.1.0");
    expect(d.files.get("personal.txt")).toEqual(new Uint8Array([42]));
    expect((await j.get())?.status).toBe("applied");
    await restore(j);
    expect(await inspect(d, catalog)).toBe("1.0.0");
  });
  test("wrong directory and local edits produce zero writes", async () => {
    const { d, j } = await setup();
    d.files.set("popup.js", new Uint8Array([42]));
    await expect(install(d, old, next, catalog, j)).rejects.toThrow("已被修改");
    expect(d.writes).toBe(0);
    d.files.delete("manifest.json");
    await expect(inspect(d, catalog)).rejects.toThrow("请选择");
  });
  test("new path collision does not overwrite personal file", async () => {
    const { d, j } = await setup();
    const bytes = new Uint8Array([42]);
    d.files.set("personal.txt", bytes);
    const r = structuredClone(next);
    r.files.push({
      path: "personal.txt",
      bytes: 1,
      content: "Kg==",
      sha256: await hash(bytes),
    });
    await expect(install(d, old, r, catalog, j)).rejects.toThrow("冲突");
    expect(d.writes).toBe(0);
  });
  test("backup persistence must precede first write", async () => {
    const { d } = await setup();
    await expect(
      install(d, old, next, catalog, {
        get: async () => undefined,
        put: async () => {
          throw new Error("quota");
        },
      }),
    ).rejects.toThrow("quota");
    expect(d.writes).toBe(0);
  });
  test("midway error rolls back all managed files", async () => {
    const { d, j } = await setup();
    d.failAt = 3;
    await expect(install(d, old, next, catalog, j)).rejects.toThrow(
      "原文件已恢复",
    );
    expect(await inspect(d, catalog)).toBe("1.0.0");
    expect((await j.get())?.status).toBe("restored");
    for (const [p, v] of Object.entries(
      (await validateRelease(old, catalog)).data,
    ))
      expect(d.files.get(p)).toEqual(v);
  });
  test("failed rollback persists pending and blocks updates until restored", async () => {
    const { d, j } = await setup();
    d.failAlways = true;
    await expect(install(d, old, next, catalog, j)).rejects.toThrow(
      "自动恢复未完成",
    );
    expect((await j.get())?.status).toBe("pending");
    await expect(install(d, old, next, catalog, j)).rejects.toThrow("未完成");
    d.failAlways = false;
    await restore(j);
    expect((await j.get())?.status).toBe("restored");
  });
  test("rollback protects edits made after successful update", async () => {
    const { d, j } = await setup();
    await install(d, old, next, catalog, j);
    d.files.set("popup.js", new Uint8Array([21]));
    await expect(restore(j)).rejects.toThrow("已被修改");
  });
  test("downgrade is rejected", async () => {
    const { d, j } = await setup();
    await expect(install(d, next, old, catalog, j)).rejects.toThrow("必须高于");
  });
});
