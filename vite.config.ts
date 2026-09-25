import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: {
    rollupOptions: {
      input: { main: resolve("index.html"), publish: resolve("publish.html"), update: resolve("update.html") },
    },
  },
});
