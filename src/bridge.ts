type Reply = { id?: string; version?: string; accepted?: boolean };
type Runtime = {
  lastError?: { message?: string };
  sendMessage(
    id: string,
    message: unknown,
    callback: (reply: Reply) => void,
  ): void;
};
function runtime(): Runtime | undefined {
  return (globalThis as unknown as { chrome?: { runtime?: Runtime } }).chrome
    ?.runtime;
}
function message(id: string, type: string, version?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const api = runtime();
    if (!api?.sendMessage) {
      reject(new Error("尚未连接 Demo 扩展"));
      return;
    }
    const timeout = setTimeout(() => reject(new Error("扩展响应超时")), 1800);
    try {
      api.sendMessage(
        id,
        { scope: "space-store/v1", type, version },
        (reply) => {
          clearTimeout(timeout);
          if (api.lastError || !reply) reject(new Error("尚未连接 Demo 扩展"));
          else resolve(reply);
        },
      );
    } catch (e) {
      clearTimeout(timeout);
      reject(e);
    }
  });
}
export async function ping(id: string): Promise<string | null> {
  try {
    const r = await message(id, "PING");
    return r.id === id && typeof r.version === "string" ? r.version : null;
  } catch {
    return null;
  }
}
export async function reloadAndVerify(
  id: string,
  version: string,
): Promise<boolean> {
  try {
    await message(id, "RELOAD", version);
  } catch {
    /* Reload can close the channel before acknowledgment; verify independently. */
  }
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 400));
    if ((await ping(id)) === version) return true;
  }
  return false;
}
