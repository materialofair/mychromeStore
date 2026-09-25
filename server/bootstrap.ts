import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { resolve } from "node:path";
import { openDatabase } from "./db.ts";
import { bootstrap } from "./auth.ts";

function hiddenPassword(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function cleanup() {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    }
    function onKey(
      char: string,
      key: { name?: string; ctrl?: boolean; meta?: boolean },
    ) {
      if (key?.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("已取消"));
      } else if (key?.name === "return" || key?.name === "enter") {
        cleanup();
        resolve(value);
      } else if (key?.name === "backspace")
        value = [...value].slice(0, -1).join("");
      else if (
        char &&
        !key?.ctrl &&
        !key?.meta &&
        !/[\x00-\x1f\x7f]/.test(char)
      ) {
        if (value.length + char.length <= 128) value += char;
      }
    }
    process.stdin.on("keypress", onKey);
  });
}
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("请在交互式终端运行，密码不会显示或接受命令行参数");
  const db = openDatabase(process.env.DB_PATH ?? resolve(".data/store.sqlite"));
  try {
    if (db.prepare("SELECT 1 FROM users LIMIT 1").get())
      throw new Error("已初始化，请通过管理页面创建账号");
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const username = (
      await rl.question("管理员用户名（小写，3–40 位）: ")
    ).trim();
    rl.close();
    const password = await hiddenPassword("管理员密码（12–128 位，不回显）: ");
    const confirmation = await hiddenPassword("再次输入密码: ");
    if (password !== confirmation) throw new Error("两次密码不一致");
    await bootstrap(db, username, password);
    console.log("管理员创建成功，请在网站登录。");
  } finally {
    db.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "初始化失败");
  process.exitCode = 1;
});
