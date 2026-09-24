import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
const identity = JSON.parse(
  await readFile(new URL("../demo/identity.json", import.meta.url), "utf8"),
);
const origin = new URL(process.env.STORE_ORIGIN || "http://localhost:5173");
if (
  origin.origin !== (process.env.STORE_ORIGIN || "http://localhost:5173") ||
  (origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(origin.hostname))
)
  throw new Error(
    "STORE_ORIGIN must be an exact HTTPS origin (localhost HTTP allowed).",
  );
const origins = [
  ...new Set([
    origin.origin,
    ...(origin.hostname === "localhost" ? ["http://127.0.0.1:5173"] : []),
  ]),
];
// Match patterns cannot restrict ports; background.js additionally checks the exact origin.
const matches = origins.map((value) => {
  const u = new URL(value);
  return `${u.protocol}//${u.hostname}/*`;
});
const versions = ["1.0.0", "1.1.0"];
await mkdir("public/releases", { recursive: true });
for (const version of versions) {
  const manifest = {
    manifest_version: 3,
    name: "Focus Notes · 专注便签",
    version,
    description: "本地便签与 Space 扩展商店更新演示。",
    key: identity.key,
    permissions: ["storage"],
    background: { service_worker: "background.js" },
    action: { default_popup: "popup.html", default_title: "Focus Notes" },
    externally_connectable: { matches },
  };
  const files = {
    "manifest.json": Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
  };
  for (const path of ["background.js", "popup.html", "popup.css", "popup.js"]) {
    let text = await readFile(`demo/template/${path}`, "utf8");
    if (path === "background.js")
      text = text.replace("__ORIGINS__", JSON.stringify(origins));
    files[path] = Buffer.from(text);
  }
  const folder = `demo/focus-notes-${version}`;
  await mkdir(folder, { recursive: true });
  for (const [path, data] of Object.entries(files))
    await writeFile(`${folder}/${path}`, data);
  const release = {
    schema: 1,
    extensionId: identity.id,
    name: manifest.name,
    version,
    key: identity.key,
    files: Object.entries(files).map(([path, data]) => ({
      path,
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      content: data.toString("base64"),
    })),
  };
  await writeFile(`public/releases/${version}.json`, JSON.stringify(release));
  await writeFile(
    `public/releases/focus-notes-${version}.zip`,
    zipSync(files, { level: 6 }),
  );
}
await writeFile(
  "public/releases/catalog.json",
  JSON.stringify(
    {
      extensionId: identity.id,
      key: identity.key,
      name: "Focus Notes · 专注便签",
      latestVersion: "1.1.0",
      versions,
      storeOrigin: origin.origin,
    },
    null,
    2,
  ),
);
console.log(
  `Generated Focus Notes 1.0.0 / 1.1.0; ID ${identity.id}; store ${origin.origin}`,
);
