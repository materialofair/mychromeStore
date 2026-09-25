export interface Catalog {
  extensionId: string;
  key: string;
  name: string;
  latestVersion: string;
  versions: string[];
  storeOrigin: string;
}
export interface ReleaseFile {
  path: string;
  bytes: number;
  sha256: string;
  content: string;
}
export interface Release {
  schema: 1;
  extensionId: string;
  key: string;
  name: string;
  version: string;
  files: ReleaseFile[];
}
export interface FileHandle {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}
export interface Directory {
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<Directory>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
}
export interface Backup {
  directory: Directory;
  status: "pending" | "applied" | "restored";
  from: string;
  to: string;
  createdAt: string;
  before: Record<string, Uint8Array | null>;
  after: Record<string, Uint8Array | null>;
}
export interface Journal {
  get(): Promise<Backup | undefined>;
  put(backup: Backup): Promise<void>;
}
export const MAX_FILE_BYTES = 24 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_RELEASE_FILES = 512;
export const decoder = new TextDecoder("utf-8", { fatal: true });
export function validPath(path: unknown): asserts path is string {
  if (
    typeof path !== "string" ||
    path.length > 160 ||
    !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*(?:\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)*$/.test(
      path,
    )
  )
    throw new Error("更新包包含不安全的文件路径");
  if (
    path
      .split("/")
      .some((part) =>
        Object.getOwnPropertyNames(Object.prototype).includes(part),
      )
  )
    throw new Error("更新包包含保留文件名");
  if (
    path
      .split("/")
      .some((part) =>
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error("更新包包含保留文件名");
}
// Decode bounded chunks into one output buffer; avoid a recursive regexp or a
// full-size decoded string for WASM and other large extension resources.
function decodeBase64(content: string, byteLength: number): Uint8Array {
  const padding = byteLength === 0 ? 0 : (3 - (byteLength % 3)) % 3;
  const end = content.length - padding;
  for (let i = 0; i < end; i++) {
    const c = content.charCodeAt(i);
    if (
      !(
        (c >= 65 && c <= 90) ||
        (c >= 97 && c <= 122) ||
        (c >= 48 && c <= 57) ||
        c === 43 ||
        c === 47
      )
    )
      throw new Error("更新文件大小或编码无效");
  }
  for (let i = end; i < content.length; i++)
    if (content[i] !== "=") throw new Error("更新文件大小或编码无效");
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (let i = 0; i < content.length; i += 32768) {
    const chunk = atob(content.slice(i, i + 32768));
    for (let j = 0; j < chunk.length; j++)
      bytes[offset++] = chunk.charCodeAt(j);
  }
  if (offset !== byteLength) throw new Error("更新包完整性校验失败");
  return bytes;
}
export async function hash(data: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(data)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function compareVersion(a: string, b: string) {
  for (let i = 0; i < 3; i++) {
    const diff = Number(a.split(".")[i]) - Number(b.split(".")[i]);
    if (diff) return diff;
  }
  return 0;
}
export async function validateRelease(
  input: unknown,
  catalog: Catalog,
): Promise<{ release: Release; data: Record<string, Uint8Array> }> {
  const r = input as Release;
  if (
    !r ||
    r.schema !== 1 ||
    r.extensionId !== catalog.extensionId ||
    r.key !== catalog.key ||
    r.name !== catalog.name ||
    !catalog.versions.includes(r.version) ||
    !/^\d+\.\d+\.\d+$/.test(r.version) ||
    !Array.isArray(r.files) ||
    !r.files.length ||
    r.files.length > MAX_RELEASE_FILES
  )
    throw new Error("更新包身份或版本不匹配");
  const names = new Set<string>();
  const data: Record<string, Uint8Array> = Object.create(null);
  let total = 0;
  for (const f of r.files) {
    if (!f) throw new Error("更新包文件无效");
    validPath(f.path);
    const key = f.path.toLowerCase();
    if (
      names.has(key) ||
      [...names].some((n) => n.startsWith(key + "/") || key.startsWith(n + "/"))
    )
      throw new Error("更新包包含重复或冲突路径");
    names.add(key);
    if (
      !Number.isInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > MAX_FILE_BYTES ||
      typeof f.content !== "string" ||
      f.content.length !== Math.ceil(f.bytes / 3) * 4
    )
      throw new Error("更新文件大小或编码无效");
    total += f.bytes;
    if (total > MAX_TOTAL_BYTES) throw new Error("更新包超过大小限制");
    const bytes = decodeBase64(f.content, f.bytes);
    if (bytes.length !== f.bytes || (await hash(bytes)) !== f.sha256)
      throw new Error("更新包完整性校验失败");
    data[f.path] = bytes;
  }
  if (!data["manifest.json"]) throw new Error("缺少 manifest.json");
  const m = JSON.parse(decoder.decode(data["manifest.json"]));
  if (
    m.manifest_version !== 3 ||
    m.key !== catalog.key ||
    m.name !== catalog.name ||
    m.version !== r.version
  )
    throw new Error("扩展清单与更新版本不一致");
  return { release: r, data };
}
async function parent(
  dir: Directory,
  path: string,
  create = false,
): Promise<[Directory, string]> {
  validPath(path);
  const parts = path.split("/");
  const name = parts.pop()!;
  for (const part of parts)
    dir = await dir.getDirectoryHandle(part, { create });
  return [dir, name];
}
export async function read(
  dir: Directory,
  path: string,
): Promise<Uint8Array | null> {
  try {
    const [p, n] = await parent(dir, path);
    return new Uint8Array(
      await (await (await p.getFileHandle(n)).getFile()).arrayBuffer(),
    );
  } catch (e) {
    if ((e as Error).name === "NotFoundError") return null;
    throw e;
  }
}
async function write(dir: Directory, path: string, data: Uint8Array | null) {
  if (data === null) {
    try {
      const [p, n] = await parent(dir, path);
      await p.removeEntry(n);
    } catch (e) {
      if ((e as Error).name !== "NotFoundError") throw e;
    }
    return;
  }
  const [p, n] = await parent(dir, path, true);
  const stream = await (
    await p.getFileHandle(n, { create: true })
  ).createWritable();
  try {
    await stream.write(new Uint8Array(data));
    await stream.close();
  } catch (e) {
    await stream.abort().catch(() => {});
    throw e;
  }
}
export async function permission(dir: Directory) {
  if (
    (await dir.queryPermission({ mode: "readwrite" })) !== "granted" &&
    (await dir.requestPermission({ mode: "readwrite" })) !== "granted"
  )
    throw new Error("需要授予所选扩展目录读写权限，未修改任何文件");
}
export async function inspect(
  dir: Directory,
  catalog: Catalog,
): Promise<string> {
  const bytes = await read(dir, "manifest.json");
  if (!bytes) throw new Error("请选择包含 manifest.json 的原始扩展目录");
  let m;
  try {
    m = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error("目录中的扩展清单无法读取");
  }
  if (
    m.key !== catalog.key ||
    m.name !== catalog.name ||
    m.manifest_version !== 3
  )
    throw new Error("所选目录与当前扩展身份不匹配，未修改文件");
  if (!catalog.versions.includes(m.version))
    throw new Error("该本地版本不在已发布版本列表中，请选择受支持的扩展目录");
  return m.version;
}
async function equals(a: Uint8Array | null, b: Uint8Array | null) {
  return a === null || b === null
    ? a === b
    : (await hash(a)) === (await hash(b));
}
function ordered(paths: string[]) {
  return paths
    .filter((p) => p !== "manifest.json")
    .concat(paths.includes("manifest.json") ? ["manifest.json"] : []);
}
async function apply(
  dir: Directory,
  files: Record<string, Uint8Array | null>,
  onProgress: (n: number) => void,
) {
  const paths = ordered(Object.keys(files));
  for (let i = 0; i < paths.length; i++) {
    await write(dir, paths[i], files[paths[i]]);
    onProgress(Math.round(((i + 1) / paths.length) * 100));
  }
  for (const path of paths)
    if (!(await equals(await read(dir, path), files[path])))
      throw new Error("写入后文件校验失败");
}
export async function install(
  dir: Directory,
  oldInput: unknown,
  newInput: unknown,
  catalog: Catalog,
  journal: Journal,
  onProgress = (n: number) => {
    void n;
  },
) {
  if ((await journal.get())?.status === "pending")
    throw new Error("存在未完成的更新，请先恢复备份");
  const old = await validateRelease(oldInput, catalog),
    next = await validateRelease(newInput, catalog);
  if (compareVersion(next.release.version, old.release.version) <= 0)
    throw new Error("更新版本必须高于本地版本");
  if ((await inspect(dir, catalog)) !== old.release.version)
    throw new Error("本地版本已变化，请重新检查");
  const before: Backup["before"] = Object.create(null),
    after: Backup["after"] = Object.create(null);
  for (const path of new Set([
    ...Object.keys(old.data),
    ...Object.keys(next.data),
  ])) {
    const current = await read(dir, path);
    if (
      path in old.data
        ? !(await equals(current, old.data[path]))
        : current !== null
    )
      throw new Error(
        `文件 ${path} 已被修改或与本地文件冲突；为保护你的文件，已停止更新`,
      );
    before[path] = current;
    after[path] = next.data[path] ?? null;
  }
  const backup: Backup = {
    directory: dir,
    status: "pending",
    from: old.release.version,
    to: next.release.version,
    createdAt: new Date().toISOString(),
    before,
    after,
  };
  await journal.put(backup); // The transaction must commit before touching the user's directory.
  try {
    await apply(dir, after, onProgress);
    await journal.put({ ...backup, status: "applied" });
  } catch (e) {
    try {
      await apply(dir, before, () => {});
      await journal.put({ ...backup, status: "restored" });
    } catch {
      throw new Error(
        "更新中断，自动恢复未完成。请保留浏览器数据，并点击「恢复备份」重试。",
      );
    }
    throw new Error(`更新未完成，原文件已恢复：${(e as Error).message}`);
  }
}
export async function restore(journal: Journal) {
  const b = await journal.get();
  if (!b || b.status === "restored") throw new Error("没有可恢复的更新备份");
  for (const path of [...Object.keys(b.before), ...Object.keys(b.after)])
    validPath(path);
  await permission(b.directory);
  if (b.status === "applied")
    for (const path of Object.keys(b.after))
      if (!(await equals(await read(b.directory, path), b.after[path])))
        throw new Error(
          "更新后的文件已被修改；请先下载备份并手动恢复，以免覆盖新改动",
        );
  await journal.put({ ...b, status: "pending" });
  await apply(b.directory, b.before, () => {});
  await journal.put({ ...b, status: "restored" });
  return b;
}
