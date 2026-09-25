import { resolve } from "node:path";
import { createApp } from "./app.ts";
const origin = process.env.STORE_ORIGIN ?? "http://localhost:5173";
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT 必须是有效端口");
function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} 必须为正整数`);
  return value;
}
const app = createApp({
  dbPath: process.env.DB_PATH ?? resolve(".data/store.sqlite"),
  origin,
  trustProxy: process.env.TRUST_PROXY === "1",
  staticDir: resolve("dist"),
  maxPending: positiveInteger("MAX_PENDING_UPLOADS", 10),
  maxUserBytes: positiveInteger("MAX_USER_STORAGE_MIB", 512) * 1024 * 1024,
  maxTotalBytes: positiveInteger("MAX_TOTAL_STORAGE_MIB", 4096) * 1024 * 1024,
  maxConcurrentUploads: positiveInteger("MAX_CONCURRENT_UPLOADS", 1),
});
app.server.listen(port, "127.0.0.1", () =>
  console.log(
    `SPACE API listening on http://127.0.0.1:${port} (store origin ${origin})`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
