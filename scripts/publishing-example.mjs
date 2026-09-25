import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
const folder = new URL("../.data/examples/", import.meta.url);
await mkdir(folder, { recursive: true, mode: 0o700 });
let key;
try {
  key = await readFile(new URL("public-key.txt", folder), "utf8");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  key = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .publicKey.export({ format: "der", type: "spki" })
    .toString("base64");
  await writeFile(new URL("public-key.txt", folder), key, { mode: 0o600 });
}
for (const version of ["1.0.0", "1.1.0"]) {
  const manifest = {
    manifest_version: 3,
    name: "Hello SPACE · 上传演示",
    version,
    key,
    description: "用于体验上传、审核和公开下载的独立扩展。",
    action: { default_popup: "popup.html" },
  };
  const files = {
    "manifest.json": Buffer.from(JSON.stringify(manifest, null, 2)),
    "popup.html": Buffer.from(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Hello SPACE</title><body><h1>Hello SPACE</h1><p>这是经过审核发布的 v${version} 扩展。</p></body></html>`,
    ),
  };
  await writeFile(
    new URL(`hello-space-${version}.zip`, folder),
    zipSync(files),
    { mode: 0o600 },
  );
}
console.log(
  "已生成 .data/examples/hello-space-1.0.0.zip 和 hello-space-1.1.0.zip，可用于上传审核体验。",
);
