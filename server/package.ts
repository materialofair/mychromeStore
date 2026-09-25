import { createHash, createPublicKey } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { zipSync } from "fflate";
import {
  validPath,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_RELEASE_FILES,
  type Release,
} from "../src/core.ts";

export const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_ENTRIES = 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
function requireValid(
  ok: unknown,
  message = "ZIP 结构无效或不受支持",
): asserts ok {
  if (!ok) throw new Error(message);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array) {
  let n = 0xffffffff;
  for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function extraValid(bytes: Buffer) {
  let p = 0;
  while (p < bytes.length) {
    requireValid(p + 4 <= bytes.length);
    const id = bytes.readUInt16LE(p),
      size = bytes.readUInt16LE(p + 2);
    // ZIP64 and Unicode filename overrides add alternate path interpretations.
    requireValid(id !== 1 && id !== 0x7075 && p + 4 + size <= bytes.length);
    p += 4 + size;
  }
}

/** Strict central/local-header parser. Inflation is bounded by real output, not ZIP claims. */
export function extractPackage(input: Uint8Array): Record<string, Uint8Array> {
  const b = Buffer.from(input);
  requireValid(b.length >= 22 && b.length <= MAX_ARCHIVE, "ZIP 最大为 32 MiB");
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (
      b.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + b.readUInt16LE(i + 20) === b.length
    ) {
      end = i;
      break;
    }
  }
  requireValid(end >= 0);
  const count = b.readUInt16LE(end + 10),
    cdSize = b.readUInt32LE(end + 12),
    cdStart = b.readUInt32LE(end + 16);
  requireValid(
    b.readUInt16LE(end + 4) === 0 &&
      b.readUInt16LE(end + 6) === 0 &&
      b.readUInt16LE(end + 8) === count,
  );
  requireValid(count > 0 && count <= MAX_ENTRIES && cdStart + cdSize === end);
  const files: Record<string, Uint8Array> = Object.create(null);
  const seen = new Map<string, boolean>(),
    ranges: Array<[number, number]> = [];
  let p = cdStart,
    total = 0,
    fileCount = 0;
  for (let i = 0; i < count; i++) {
    requireValid(p + 46 <= end && b.readUInt32LE(p) === 0x02014b50);
    const flags = b.readUInt16LE(p + 8),
      method = b.readUInt16LE(p + 10),
      crc = b.readUInt32LE(p + 16);
    const compressed = b.readUInt32LE(p + 20),
      expanded = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28),
      extraLen = b.readUInt16LE(p + 30),
      commentLen = b.readUInt16LE(p + 32);
    const attrs = b.readUInt32LE(p + 38),
      local = b.readUInt32LE(p + 42);
    requireValid(
      (flags & ~0x0808) === 0 &&
        [0, 8].includes(method) &&
        b.readUInt16LE(p + 34) === 0,
    );
    requireValid(
      p + 46 + nameLen + extraLen + commentLen <= end && nameLen > 0,
    );
    const nameBytes = b.subarray(p + 46, p + 46 + nameLen),
      name = utf8.decode(nameBytes);
    const isDir = name.endsWith("/"),
      path = isDir ? name.slice(0, -1) : name;
    validPath(path);
    const kind = (attrs >>> 16) & 0xf000;
    requireValid(
      kind === 0 || kind === (isDir ? 0x4000 : 0x8000),
      "不允许符号链接或特殊文件",
    );
    const lower = path.toLowerCase();
    requireValid(!seen.has(lower), "ZIP 存在重名或大小写冲突");
    for (const [other, directory] of seen) {
      requireValid(
        !(lower.startsWith(other + "/") && !directory) &&
          !(other.startsWith(lower + "/") && !isDir),
        "ZIP 文件与目录冲突",
      );
    }
    seen.set(lower, isDir);
    requireValid(
      expanded <= MAX_FILE_BYTES &&
        compressed <= MAX_ARCHIVE &&
        (!isDir || expanded === 0),
      "单文件最大为 24 MiB",
    );
    total += expanded;
    requireValid(
      total <= MAX_TOTAL_BYTES && (isDir || ++fileCount <= MAX_RELEASE_FILES),
      "最多 512 个文件，解压总大小最大为 64 MiB",
    );
    extraValid(b.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen));
    requireValid(local + 30 <= cdStart && b.readUInt32LE(local) === 0x04034b50);
    requireValid(
      b.readUInt16LE(local + 6) === flags &&
        b.readUInt16LE(local + 8) === method,
    );
    const ln = b.readUInt16LE(local + 26),
      le = b.readUInt16LE(local + 28),
      dataStart = local + 30 + ln + le;
    requireValid(
      dataStart + compressed <= cdStart &&
        ln === nameLen &&
        b.subarray(local + 30, local + 30 + ln).equals(nameBytes),
    );
    extraValid(b.subarray(local + 30 + ln, dataStart));
    let dataEnd = dataStart + compressed;
    if (flags & 8) {
      // Streaming archives must include a matching descriptor after their data.
      requireValid(dataEnd + 12 <= cdStart);
      if (b.readUInt32LE(dataEnd) === 0x08074b50) dataEnd += 4;
      requireValid(
        dataEnd + 12 <= cdStart &&
          b.readUInt32LE(dataEnd) === crc &&
          b.readUInt32LE(dataEnd + 4) === compressed &&
          b.readUInt32LE(dataEnd + 8) === expanded,
      );
      dataEnd += 12;
    } else {
      requireValid(
        b.readUInt32LE(local + 14) === crc &&
          b.readUInt32LE(local + 18) === compressed &&
          b.readUInt32LE(local + 22) === expanded,
      );
    }
    requireValid(
      !ranges.some(([a, z]) => local < z && dataEnd > a),
      "ZIP 条目重叠",
    );
    ranges.push([local, dataEnd]);
    const packed = b.subarray(dataStart, dataStart + compressed);
    const bytes =
      method === 0
        ? packed
        : inflateRawSync(packed, { maxOutputLength: Math.max(1, expanded) });
    requireValid(
      bytes.length === expanded && crc32(bytes) === crc,
      "ZIP 文件校验失败",
    );
    if (!isDir) files[path] = new Uint8Array(bytes);
    p += 46 + nameLen + extraLen + commentLen;
  }
  requireValid(
    p === end && files["manifest.json"],
    "ZIP 根目录必须包含 manifest.json",
  );
  ranges.sort((a, b) => a[0] - b[0]);
  requireValid(
    ranges[0][0] === 0 &&
      ranges.at(-1)![1] === cdStart &&
      ranges.every((r, i) => !i || ranges[i - 1][1] === r[0]),
    "ZIP 包含未声明的数据",
  );
  return files;
}

export async function parsePackage(input: Uint8Array): Promise<{
  release: Release;
  zip: Uint8Array;
  permissions: string[];
  description: string;
}> {
  const files = extractPackage(input);
  let m;
  try {
    m = JSON.parse(utf8.decode(files["manifest.json"]));
  } catch {
    throw new Error("manifest.json 不是有效的 UTF-8 JSON");
  }
  requireValid(m && m.manifest_version === 3, "仅支持 Manifest V3 扩展");
  requireValid(
    typeof m.name === "string" &&
      m.name.trim().length > 0 &&
      m.name.length <= 100 &&
      !m.name.startsWith("__MSG_"),
    "扩展名应为直接填写的 1–100 字符",
  );
  requireValid(
    typeof m.version === "string" &&
      /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(
        m.version,
      ) &&
      m.version.split(".").every((n: string) => Number(n) <= 65535) &&
      m.version !== "0.0.0",
    "版本必须为三段数字（如 1.0.0），每段不超过 65535",
  );
  requireValid(
    m.description === undefined ||
      (typeof m.description === "string" && m.description.length <= 1000),
    "描述最多 1000 字符",
  );
  requireValid(
    typeof m.key === "string" &&
      m.key.length <= 4096 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        m.key,
      ),
    "manifest.key 必须为固定的公开 RSA 密钥",
  );
  try {
    const der = Buffer.from(m.key, "base64");
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    requireValid(
      key.asymmetricKeyType === "rsa" &&
        (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048 &&
        key.export({ format: "der", type: "spki" }).equals(der),
    );
  } catch {
    throw new Error(
      "manifest.key 必须为 DER/SPKI 格式的 RSA 公钥（至少 2048 位）",
    );
  }
  const permissions: string[] = [];
  for (const field of [
    "permissions",
    "host_permissions",
    "optional_permissions",
    "optional_host_permissions",
  ]) {
    if (m[field] === undefined) continue;
    requireValid(
      Array.isArray(m[field]) &&
        m[field].length <= 100 &&
        m[field].every(
          (v: unknown) =>
            typeof v === "string" && v.length > 0 && v.length <= 256,
        ),
      "权限声明格式无效",
    );
    permissions.push(...m[field].map((v: string) => `${field}: ${v}`));
  }
  const reference = (value: unknown) => {
    validPath(value);
    requireValid(Object.hasOwn(files, value), "Manifest 引用的本地文件不存在");
  };
  const stringList = (value: unknown, label: string) => {
    requireValid(
      Array.isArray(value) &&
        value.length <= 100 &&
        value.every(
          (v) => typeof v === "string" && v.length > 0 && v.length <= 256,
        ),
      "Manifest 匹配规则格式无效",
    );
    permissions.push(...value.map((v: string) => `${label}: ${v}`));
  };
  if (m.background !== undefined) {
    requireValid(
      m.background &&
        typeof m.background === "object" &&
        !Array.isArray(m.background),
      "background 格式无效",
    );
    reference(m.background.service_worker);
  }
  if (m.action?.default_popup) reference(m.action.default_popup);
  if (m.options_page) reference(m.options_page);
  if (m.options_ui?.page) reference(m.options_ui.page);
  if (m.side_panel?.default_path) reference(m.side_panel.default_path);
  if (m.content_scripts !== undefined) {
    requireValid(
      Array.isArray(m.content_scripts) && m.content_scripts.length <= 100,
      "content_scripts 格式无效",
    );
    for (const script of m.content_scripts) {
      requireValid(script && typeof script === "object");
      stringList(script.matches, "content_scripts.matches");
      for (const kind of ["js", "css"])
        if (script[kind] !== undefined) {
          requireValid(
            Array.isArray(script[kind]) && script[kind].length <= 100,
          );
          script[kind].forEach(reference);
        }
    }
  }
  if (m.externally_connectable !== undefined) {
    requireValid(
      m.externally_connectable && typeof m.externally_connectable === "object",
    );
    for (const kind of ["matches", "ids"])
      if (m.externally_connectable[kind] !== undefined)
        stringList(
          m.externally_connectable[kind],
          `externally_connectable.${kind}`,
        );
  }
  const extensionId = [
    ...createHash("sha256")
      .update(Buffer.from(m.key, "base64"))
      .digest()
      .subarray(0, 16),
  ]
    .map((n) => String.fromCharCode(97 + (n >> 4), 97 + (n & 15)))
    .join("");
  const release: Release = {
    schema: 1,
    extensionId,
    key: m.key,
    name: m.name,
    version: m.version,
    files: Object.entries(files).map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      content: Buffer.from(bytes).toString("base64"),
    })),
  };
  return {
    release,
    zip: zipSync(files, { level: 6 }),
    permissions: [...new Set(permissions)].sort(),
    description: m.description ?? "",
  };
}
