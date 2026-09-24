import "./style.css";
import { renderApp } from "./ui";
import type { Actions, ViewState } from "./view-types";
import {
  inspect,
  install,
  permission,
  restore,
  validateRelease,
  type Catalog,
  type Directory,
} from "./core";
import { exclusive, journal, loadDirectory, saveDirectory } from "./storage";
import { ping, reloadAndVerify } from "./bridge";
import { zipSync } from "fflate";
const picker = (
  window as unknown as {
    showDirectoryPicker?: (options: {
      mode: "readwrite";
      id: string;
    }) => Promise<Directory>;
  }
).showDirectoryPicker;
let catalog: Catalog | null = null,
  directory: Directory | undefined;
const state: ViewState = {
  latestVersion: "1.1.0",
  extensionId: "",
  folderName: null,
  diskVersion: null,
  runtimeVersion: null,
  phase: "idle",
  message:
    "首次使用？先下载 Demo 1.0，解压后在 Edge 中加载，再绑定同一个目录。",
  busy: false,
  progress: 0,
  hasBackup: false,
  recoveryNeeded: false,
  supported: !!picker && isSecureContext && !!navigator.locks,
};
const draw = () => renderApp(state, actions);
function requiredCatalog() {
  if (!catalog) throw new Error("版本目录尚未加载，请刷新重试");
  return catalog;
}
async function json(path: string): Promise<unknown> {
  const response = await fetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.body)
    throw new Error("无法下载版本信息，请检查网络后重试");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 12 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("版本信息超过大小限制");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function loadCatalog() {
  const c = (await json("/releases/catalog.json")) as Catalog;
  if (
    !c ||
    !/^[a-p]{32}$/.test(c.extensionId) ||
    typeof c.key !== "string" ||
    typeof c.name !== "string" ||
    !Array.isArray(c.versions) ||
    c.versions.length > 20 ||
    !c.versions.every(
      (v) => typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v),
    ) ||
    !c.versions.includes(c.latestVersion)
  )
    throw new Error("商店版本目录无效");
  catalog = c;
  state.latestVersion = c.latestVersion;
  state.extensionId = c.extensionId;
}
async function backupState() {
  const b = await journal.get();
  state.hasBackup = !!b && b.status !== "restored";
  state.recoveryNeeded = b?.status === "pending";
  return b;
}
async function versions() {
  const c = requiredCatalog();
  state.runtimeVersion = await ping(c.extensionId);
  state.diskVersion = null;
  if (
    directory &&
    (await directory.queryPermission({ mode: "readwrite" })) === "granted"
  )
    state.diskVersion = await inspect(directory, c);
}
async function run(operation: () => Promise<void>) {
  if (state.busy) return;
  state.busy = true;
  draw();
  try {
    await operation();
  } catch (e) {
    state.phase = "error";
    state.message =
      (e as Error).name === "AbortError"
        ? "已取消，未开始新的更新。"
        : (e as Error).message;
  } finally {
    try {
      await backupState();
    } catch {
      state.recoveryNeeded = true;
      state.message += " 本地备份存储不可用，请勿继续更新。";
    }
    state.busy = false;
    draw();
  }
}
async function verifyRunning(version: string) {
  state.phase = "reloading";
  state.message = "文件已写入，正在通知扩展重新加载…";
  draw();
  const ok = await reloadAndVerify(requiredCatalog().extensionId, version);
  state.runtimeVersion = await ping(requiredCatalog().extensionId);
  state.phase = ok ? "success" : "manual";
  state.message = ok
    ? `已确认浏览器正在运行 v${version}。便签仍保存在原浏览器中。`
    : "目录文件已更新，但未确认扩展运行新版本。请在 edge://extensions 重新加载；若仍为旧版本，请确认绑定的是实际加载目录。";
}
const actions: Actions = {
  bind: () =>
    run(async () => {
      if (!state.supported)
        throw new Error(
          "请使用桌面 Edge / Chrome，并通过 HTTPS 或 localhost 打开商店",
        );
      requiredCatalog();
      if (state.recoveryNeeded)
        throw new Error("请先恢复未完成的更新，再切换目录");
      const selected = await picker!.call(window, {
        mode: "readwrite",
        id: "space-demo",
      });
      await exclusive(async () => {
        if ((await journal.get())?.status === "pending")
          throw new Error("请先恢复未完成的更新");
        await permission(selected);
        const version = await inspect(selected, requiredCatalog());
        await saveDirectory(selected);
        directory = selected;
        state.folderName = selected.name;
        state.diskVersion = version;
      });
      await versions();
      state.phase = "idle";
      state.message =
        "目录已绑定。请确认这是 Edge 当前加载的原目录，而不是另一份副本。";
    }),
  update: () =>
    run(async () => {
      if (!directory) throw new Error("请先绑定 Edge 已加载的本地扩展目录");
      // Ask while the user's click is still active, before network or lock waits.
      await permission(directory);
      await exclusive(async () => {
        const c = requiredCatalog(),
          dir = directory!;
        if ((await journal.get())?.status === "pending")
          throw new Error("请先恢复未完成的更新");
        const current = await inspect(dir, c);
        state.diskVersion = current;
        if (current === c.latestVersion) {
          await verifyRunning(current);
          return;
        }
        state.phase = "checking";
        state.progress = 0;
        state.message = "正在下载并校验更新，尚未修改本地文件…";
        draw();
        const [old, next] = await Promise.all([
          json(`/releases/${current}.json`),
          json(`/releases/${c.latestVersion}.json`),
        ]);
        await validateRelease(next, c);
        state.phase = "writing";
        state.message = "正在备份并更新原目录，请保持页面打开…";
        draw();
        await install(dir, old, next, c, journal, (n) => {
          state.progress = n;
          draw();
        });
        state.diskVersion = await inspect(dir, c);
        await verifyRunning(state.diskVersion);
      });
    }),
  refresh: () =>
    run(async () => {
      if (!catalog) await loadCatalog();
      await versions();
      await backupState();
      state.phase = "idle";
      state.message = state.recoveryNeeded
        ? "上次更新被中断。请先恢复备份，再进行新的更新。"
        : "已重新检查。本地文件版本和浏览器运行版本分别显示在更新面板中。";
    }),
  restore: () =>
    run(async () => {
      const saved = await journal.get();
      if (!saved) throw new Error("没有可恢复的备份");
      await permission(saved.directory);
      await exclusive(async () => {
        const b = await restore(journal);
        directory = b.directory;
        await saveDirectory(directory);
        state.folderName = directory.name;
        state.diskVersion = await inspect(directory, requiredCatalog());
        await verifyRunning(b.from);
        state.message =
          state.phase === "success"
            ? `已恢复原文件，并确认浏览器运行 v${b.from}。`
            : state.message;
      });
    }),
  downloadBackup: () =>
    run(async () => {
      const b = await journal.get();
      if (!b) throw new Error("尚无备份");
      const files: Record<string, Uint8Array> = Object.create(null);
      for (const [path, data] of Object.entries(b.before))
        if (data) files[path] = data;
      const blob = new Blob([new Uint8Array(zipSync(files))], {
        type: "application/zip",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `focus-notes-backup-${b.from}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      state.message = "备份 ZIP 已准备下载。请保留在扩展目录之外。";
    }),
};
draw();
void run(async () => {
  await loadCatalog();
  directory = await loadDirectory();
  state.folderName = directory?.name ?? null;
  await versions();
  await backupState();
  if (state.recoveryNeeded)
    state.message =
      "检测到未完成更新，请先恢复备份。恢复使用上次更新的原目录。";
});
