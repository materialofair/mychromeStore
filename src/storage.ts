import type { Backup, Directory, Journal } from "./core";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("space-store", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("state");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(new Error("无法打开本地备份存储，请检查浏览器存储设置"));
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", mode);
    const r = operation(tx.objectStore("state"));
    tx.oncomplete = () => {
      db.close();
      resolve(r.result as T);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(new Error("本地备份保存失败，操作已停止"));
    };
  });
}
async function lock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks)
    throw new Error("当前浏览器不支持安全更新锁，请使用新版桌面 Edge");
  return navigator.locks.request(
    name,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error("另一个商店标签页正在操作，请稍后重试");
      return operation();
    },
  );
}

function storage(prefix: string, lockName: string) {
  return {
    journal: {
      get: () => transaction<Backup | undefined>("readonly", (s) => s.get(prefix + "backup")),
      put: (backup: Backup) => transaction<void>("readwrite", (s) => s.put(backup, prefix + "backup")),
    } satisfies Journal,
    saveDirectory: (directory: Directory) => transaction<void>("readwrite", (s) => s.put(directory, prefix + "directory")),
    loadDirectory: () => transaction<Directory | undefined>("readonly", (s) => s.get(prefix + "directory")),
    exclusive: <T>(operation: () => Promise<T>) => lock(lockName, operation),
  };
}

// Preserve the original Demo keys so existing local backups remain recoverable.
export const { journal, saveDirectory, loadDirectory, exclusive } = storage("", "space-store-update");

export function scopedStorage(extensionId: string) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("扩展 ID 无效");
  return storage(`extension:${extensionId}:`, `space-store-update:${extensionId}`);
}
