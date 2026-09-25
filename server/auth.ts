import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { audit, transaction } from "./db.ts";

export const ROLES = ["viewer", "developer", "reviewer", "admin"] as const;
export type Role = (typeof ROLES)[number];
export type User = {
  id: string;
  username: string;
  role: Role;
  disabled: number;
  created_at: string;
};
export function validRole(role: unknown): role is Role {
  return ROLES.includes(role as Role);
}
export function validatePassword(
  password: unknown,
): asserts password is string {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error("密码必须为 12–128 个字符");
}
export function validateUsername(
  username: unknown,
): asserts username is string {
  if (
    typeof username !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{2,39}$/.test(username)
  )
    throw new Error("用户名须为 3–40 位小写字母、数字、下划线或连字符");
}
function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(password, salt, 64, (err, result) =>
      err ? reject(err) : resolve(result),
    ),
  );
}
export async function hashPassword(password: string) {
  validatePassword(password);
  const salt = randomBytes(24).toString("hex");
  return `${salt}:${(await scrypt(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, stored?: string) {
  // Equal work for nonexistent users avoids a cheap username timing oracle.
  const [salt, expected] = (
    stored ?? `${"0".repeat(48)}:${"0".repeat(128)}`
  ).split(":");
  const actual = await scrypt(password, salt);
  return timingSafeEqual(actual, Buffer.from(expected, "hex")) && !!stored;
}
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function publicUser(user: User) {
  return { id: user.id, username: user.username, role: user.role };
}
export async function createUser(
  db: DatabaseSync,
  input: { username: string; password: string; role: Role },
  actor: string | null = null,
) {
  validateUsername(input.username);
  if (!validRole(input.role)) throw new Error("无效角色");
  const hash = await hashPassword(input.password);
  return transaction(db, () => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users(id,username,password,role,created_at) VALUES(?,?,?,?,?)",
    ).run(id, input.username, hash, input.role, new Date().toISOString());
    audit(db, actor, "user.create", id, input.role);
    return db
      .prepare(
        "SELECT id,username,role,disabled,created_at FROM users WHERE id=?",
      )
      .get(id) as User;
  });
}
export async function bootstrap(
  db: DatabaseSync,
  username: string,
  password: string,
) {
  validateUsername(username);
  const hash = await hashPassword(password);
  return transaction(db, () => {
    if (db.prepare("SELECT 1 FROM users LIMIT 1").get())
      throw new Error("仅空数据库可初始化管理员");
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users(id,username,password,role,created_at) VALUES(?,?,?,?,?)",
    ).run(id, username, hash, "admin", new Date().toISOString());
    audit(db, null, "bootstrap", id);
    return { id, username, role: "admin" as const };
  });
}
