import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase, transaction, audit } from "./db.ts";
import {
  hashPassword,
  verifyPassword,
  tokenHash,
  publicUser,
  validateUsername,
  validRole,
  type User,
  type Role,
} from "./auth.ts";
import { parsePackage, MAX_ARCHIVE } from "./package.ts";
import type { Release } from "../src/core.ts";
export { bootstrap, createUser } from "./auth.ts";

type Session = { user: User; csrf: string; token: string };
type Submission = {
  id: string;
  extension_id: string;
  name: string;
  version: string;
  description: string;
  submitter_id: string;
  reviewer_id: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reason: string | null;
  permissions: string;
  extension_key: string;
  submitter_name: string;
  reviewer_name: string | null;
};
const SELECT = `SELECT s.id,s.extension_id,s.name,s.version,s.description,s.submitter_id,s.reviewer_id,s.status,s.created_at,s.reviewed_at,s.reason,s.permissions,e.key AS extension_key,u.username AS submitter_name,r.username AS reviewer_name FROM submissions s JOIN extensions e ON e.id=s.extension_id JOIN users u ON u.id=s.submitter_id LEFT JOIN users r ON r.id=s.reviewer_id`;
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
function versionCompare(a: string, b: string) {
  const av = a.split(".").map(Number),
    bv = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (av[i] ?? 0) - (bv[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
function metadata(s: Submission) {
  return {
    id: s.id,
    extensionId: s.extension_id,
    name: s.name,
    version: s.version,
    description: s.description,
    status: s.status,
    submitterId: s.submitter_id,
    submitterName: s.submitter_name,
    reviewerName: s.reviewer_name,
    createdAt: s.created_at,
    reviewedAt: s.reviewed_at,
    reason: s.reason,
    permissions: JSON.parse(s.permissions) as string[],
  };
}
function boundedReason(value: unknown, required = false) {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > 1000 ||
    (required && !value.trim())
  )
    fail(400, "请填写审核或下架原因（最多 1000 字）");
  return (value as string).trim();
}
async function body(req: IncomingMessage, limit: number) {
  if (Number(req.headers["content-length"] ?? 0) > limit)
    fail(413, "请求内容过大");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, "请求内容过大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req: IncomingMessage) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json")
    fail(415, "需要 application/json");
  try {
    const value = JSON.parse((await body(req, 8192)).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object")
      fail(400, "请求格式错误");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return fail(400, "请求格式错误");
  }
}
export interface AppOptions {
  trustProxy?: boolean;
  maxConcurrentUploads?: number;
  dbPath: string;
  origin: string;
  staticDir?: string;
  reservedIds?: string[];
  maxPending?: number;
  maxUserBytes?: number;
  maxTotalBytes?: number;
}
export function createApp(options: AppOptions) {
  const originURL = new URL(options.origin);
  if (
    originURL.origin !== options.origin ||
    !["http:", "https:"].includes(originURL.protocol)
  )
    throw new Error("ORIGIN 必须为完整源地址，不含路径或结尾斜杠");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    originURL.hostname,
  );
  if (!local && originURL.protocol !== "https:")
    throw new Error("非本地访问必须使用 HTTPS");
  const maxConcurrentUploads = options.maxConcurrentUploads ?? 1;
  if (
    !Number.isInteger(maxConcurrentUploads) ||
    maxConcurrentUploads < 1 ||
    maxConcurrentUploads > 4
  )
    throw new Error("上传并发数必须是 1–4 的整数");
  const db = openDatabase(options.dbPath),
    reserved = new Set(
      options.reservedIds ?? ["pmadfengihgmgkjenefbenhdclnibkbm"],
    );
  const attempts = new Map<string, { count: number; until: number }>();
  let hashInFlight = 0;
  let uploadsInFlight = 0;
  function limit(key: string, max: number) {
    const now = Date.now();
    if (attempts.size > 10000) {
      for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
      if (attempts.size > 10000) fail(429, "请求过多，请稍后重试");
    }
    let item = attempts.get(key);
    if (!item || item.until < now) {
      item = { count: 0, until: now + 15 * 60 * 1000 };
      attempts.set(key, item);
    }
    if (++item.count > max) fail(429, "请求过多，请 15 分钟后重试");
  }
  const cookie = (token: string, expires = false) =>
    `space_session=${token}; Path=/; HttpOnly; SameSite=Strict; ${expires ? "Max-Age=0" : "Max-Age=28800"}${local ? "" : "; Secure"}`;
  function session(req: IncomingMessage): Session | undefined {
    const raw = /(?:^|;\s*)space_session=([a-f0-9]{64})(?:;|$)/.exec(
      req.headers.cookie ?? "",
    )?.[1];
    if (!raw) return;
    const token = tokenHash(raw);
    const row = db
      .prepare(
        `SELECT u.id,u.username,u.role,u.disabled,u.created_at,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.disabled=0`,
      )
      .get(token, Date.now()) as (User & { csrf: string }) | undefined;
    if (row) return { user: row, csrf: row.csrf, token };
  }
  function requireUser(req: IncomingMessage, roles?: Role[]): Session {
    const s = session(req);
    if (!s) return fail(401, "请先登录");
    if (roles && !roles.includes(s.user.role)) return fail(403, "没有操作权限");
    return s;
  }
  function writeAuth(req: IncomingMessage, roles?: Role[]) {
    if (req.headers.origin !== options.origin) fail(403, "请求来源不被允许");
    const s = requireUser(req, roles);
    if (req.headers["x-csrf-token"] !== s.csrf)
      fail(403, "请求验证失败，请重新登录");
    return s;
  }
  function find(id: string) {
    return db.prepare(`${SELECT} WHERE s.id=?`).get(id) as
      | Submission
      | undefined;
  }
  function access(req: IncomingMessage, id: string) {
    const s = requireUser(req, ["developer", "reviewer", "admin"]),
      row = find(id);
    if (
      !row ||
      (!["admin", "reviewer"].includes(s.user.role) &&
        row.submitter_id !== s.user.id)
    )
      return fail(404, "未找到资源");
    return row;
  }
  function releaseFor(id: string) {
    return JSON.parse(
      db.prepare("SELECT release FROM submissions WHERE id=?").get(id)!
        .release as string,
    ) as Release;
  }
  function zipFor(id: string) {
    return db.prepare("SELECT zip FROM submissions WHERE id=?").get(id)!
      .zip as Uint8Array;
  }
  function latestPublished(id: string) {
    return (
      db
        .prepare(
          "SELECT version FROM submissions WHERE extension_id=? AND status IN ('approved','unpublished')",
        )
        .all(id) as { version: string }[]
    ).sort((a, b) => versionCompare(b.version, a.version))[0];
  }
  function approved(id: string) {
    return (
      db
        .prepare(`${SELECT} WHERE s.extension_id=? AND s.status='approved'`)
        .all(id) as Submission[]
    ).sort((a, b) => versionCompare(b.version, a.version));
  }
  function catalog(id: string) {
    const rows = approved(id);
    if (!rows.length) return;
    const row = rows[0];
    return {
      extensionId: id,
      key: row.extension_key,
      name: row.name,
      latestVersion: row.version,
      versions: rows.map((s) => s.version),
      storeOrigin: options.origin,
      description: row.description,
      downloadUrl: `/api/extensions/${id}/releases/${row.version}.zip`,
    };
  }
  function send(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  }
  async function route(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    );
    const path = new URL(req.url ?? "/", options.origin).pathname,
      method = req.method ?? "GET";
    if (method === "GET" && path === "/api/session") {
      const s = session(req);
      return send(
        res,
        200,
        s ? { user: publicUser(s.user), csrfToken: s.csrf } : { user: null },
      );
    }
    if (method === "POST" && path === "/api/login") {
      if (req.headers.origin !== options.origin) fail(403, "请求来源不被允许");
      const peer = req.socket.remoteAddress ?? "unknown";
      const forwarded = req.headers["x-real-ip"];
      const loopback =
        peer === "::1" ||
        peer === "::ffff:127.0.0.1" ||
        (isIP(peer) === 4 && peer.startsWith("127."));
      const ip =
        options.trustProxy === true &&
        loopback &&
        typeof forwarded === "string" &&
        isIP(forwarded) !== 0
          ? forwarded
          : peer;
      limit(`ip:${ip}`, 60);
      const input = await jsonBody(req);
      const username = typeof input.username === "string" ? input.username : "";
      limit(`login:${ip}:${username.slice(0, 40)}`, 8);
      if (
        typeof input.password !== "string" ||
        input.password.length > 128 ||
        !/^[a-z0-9][a-z0-9_-]{2,39}$/.test(username)
      )
        fail(401, "用户名或密码错误");
      if (hashInFlight >= 4) fail(429, "请求过多，请稍后重试");
      const user = db
        .prepare("SELECT * FROM users WHERE username=?")
        .get(username) as (User & { password: string }) | undefined;
      let ok = false;
      hashInFlight++;
      try {
        ok = await verifyPassword(input.password as string, user?.password);
      } finally {
        hashInFlight--;
      }
      if (!ok || !user || user.disabled) fail(401, "用户名或密码错误");
      const output = transaction(db, () => {
        const current = db
          .prepare("SELECT * FROM users WHERE id=?")
          .get(user!.id) as (User & { password: string }) | undefined;
        if (!current || current.disabled || current.password !== user!.password)
          fail(401, "用户名或密码错误");
        const raw = randomBytes(32).toString("hex"),
          csrf = randomBytes(32).toString("hex");
        db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
        // Keep one active login per account and bound session storage.
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(current!.id);
        db.prepare(
          "INSERT INTO sessions(token,user_id,csrf,expires_at) VALUES(?,?,?,?)",
        ).run(tokenHash(raw), current!.id, csrf, Date.now() + 28800000);
        audit(db, current!.id, "login", current!.id);
        return { raw, csrf, user: current! };
      });
      res.setHeader("Set-Cookie", cookie(output.raw));
      return send(res, 200, {
        user: publicUser(output.user),
        csrfToken: output.csrf,
      });
    }
    if (method === "POST" && path === "/api/logout") {
      const s = writeAuth(req);
      db.prepare("DELETE FROM sessions WHERE token=?").run(s.token);
      res.setHeader("Set-Cookie", cookie("", true));
      return send(res, 200, { ok: true });
    }
    if (path === "/api/users" && method === "GET") {
      requireUser(req, ["admin"]);
      return send(res, 200, {
        users: db
          .prepare(
            "SELECT id,username,role,disabled,created_at AS createdAt FROM users ORDER BY created_at",
          )
          .all()
          .map((u) => ({ ...u, disabled: !!u.disabled })),
      });
    }
    if (path === "/api/users" && method === "POST") {
      writeAuth(req, ["admin"]);
      const input = await jsonBody(req);
      try {
        validateUsername(input.username);
        if (!validRole(input.role)) fail(400, "无效角色");
      } catch (error) {
        if (error instanceof HttpError) throw error;
        fail(400, (error as Error).message);
      }
      let hash: string;
      try {
        hash = await hashPassword(input.password as string);
      } catch {
        return fail(400, "密码必须为 12–128 个字符");
      }
      const user = transaction(db, () => {
        const s = writeAuth(req, ["admin"]);
        if (
          db
            .prepare("SELECT 1 FROM users WHERE username=?")
            .get(input.username as string)
        )
          fail(409, "用户名已存在");
        if (
          (db.prepare("SELECT COUNT(*) AS n FROM users").get()!.n as number) >=
          1000
        )
          fail(409, "账号数量已达上限");
        const id = randomUUID();
        db.prepare(
          "INSERT INTO users(id,username,password,role,created_at) VALUES(?,?,?,?,?)",
        ).run(
          id,
          input.username as string,
          hash,
          input.role as string,
          new Date().toISOString(),
        );
        audit(db, s.user.id, "user.create", id, input.role as string);
        return {
          id,
          username: input.username,
          role: input.role,
          disabled: false,
        };
      });
      return send(res, 201, { user });
    }
    let match = /^\/api\/users\/([a-zA-Z0-9-]+)$/.exec(path);
    if (match && method === "PATCH") {
      writeAuth(req, ["admin"]);
      const input = await jsonBody(req),
        id = match[1];
      if (
        (input.role !== undefined && !validRole(input.role)) ||
        (input.disabled !== undefined && typeof input.disabled !== "boolean") ||
        !Object.keys(input).length ||
        Object.keys(input).some(
          (k) => !["role", "disabled", "password"].includes(k),
        )
      )
        fail(400, "无效账号变更");
      let hash: string | undefined;
      if (input.password !== undefined) {
        try {
          hash = await hashPassword(input.password as string);
        } catch {
          fail(400, "密码必须为 12–128 个字符");
        }
      }
      const user = transaction(db, () => {
        const s = writeAuth(req, ["admin"]),
          target = db.prepare("SELECT * FROM users WHERE id=?").get(id) as
            | User
            | undefined;
        if (!target) return fail(404, "未找到资源");
        const role = (input.role ?? target.role) as Role,
          disabled =
            input.disabled === undefined
              ? target.disabled
              : input.disabled
                ? 1
                : 0;
        if (
          target.role === "admin" &&
          !target.disabled &&
          (role !== "admin" || disabled) &&
          (db
            .prepare(
              "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0",
            )
            .get()!.n as number) <= 1
        )
          fail(409, "必须保留至少一个启用的管理员");
        db.prepare(
          "UPDATE users SET role=?,disabled=?,password=COALESCE(?,password) WHERE id=?",
        ).run(role, disabled, hash ?? null, id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
        audit(
          db,
          s.user.id,
          "user.update",
          id,
          JSON.stringify({ role, disabled: !!disabled, passwordReset: !!hash }),
        );
        return { id, username: target.username, role, disabled: !!disabled };
      });
      return send(res, 200, { user });
    }
    if (path === "/api/submissions" && method === "POST") {
      const initial = writeAuth(req, ["developer", "admin"]);
      limit(`upload:${initial.user.id}`, 20);
      if (
        req.headers["content-type"]?.split(";")[0].trim() !== "application/zip"
      )
        fail(415, "请上传 ZIP 文件");
      if (uploadsInFlight >= maxConcurrentUploads)
        fail(429, "服务器正在处理其他扩展包，请稍后重试");
      uploadsInFlight++;
      try {
        const bytes = await body(req, MAX_ARCHIVE);
        let parsed: Awaited<ReturnType<typeof parsePackage>>;
        try {
          parsed = await parsePackage(bytes);
        } catch {
          return fail(
            400,
            "扩展包校验失败：请检查 ZIP、Manifest、版本、文件大小和扩展公钥",
          );
        }
        const { release, zip, permissions, description } = parsed;
        const id = transaction(db, () => {
          const s = writeAuth(req, ["developer", "admin"]);
          if (reserved.has(release.extensionId))
            fail(409, "此扩展 ID 为系统示例保留，请使用自己的扩展公钥");
          const existing = db
            .prepare("SELECT owner_id,key FROM extensions WHERE id=?")
            .get(release.extensionId);
          if (
            existing &&
            (existing.owner_id !== s.user.id || existing.key !== release.key)
          )
            fail(409, "此扩展属于其他开发者");
          if (
            db
              .prepare(
                "SELECT 1 FROM submissions WHERE extension_id=? AND version=?",
              )
              .get(release.extensionId, release.version)
          )
            fail(409, "版本已存在，请递增版本号");
          const latest = latestPublished(release.extensionId);
          if (latest && versionCompare(release.version, latest.version) <= 0)
            fail(409, "版本号必须高于已发布版本");
          const quota = db
            .prepare(
              "SELECT COUNT(CASE WHEN status='pending' THEN 1 END) AS pending, COALESCE(SUM(length(zip)+length(CAST(release AS BLOB))),0) AS bytes FROM submissions WHERE submitter_id=?",
            )
            .get(s.user.id)!;
          const releaseText = JSON.stringify(release),
            storedBytes = zip.byteLength + Buffer.byteLength(releaseText);
          const total = db
            .prepare(
              "SELECT COALESCE(SUM(length(zip)+length(CAST(release AS BLOB))),0) AS bytes FROM submissions",
            )
            .get()!.bytes as number;
          if (
            (quota.pending as number) >= (options.maxPending ?? 10) ||
            (quota.bytes as number) + storedBytes >
              (options.maxUserBytes ?? 512 * 1024 * 1024) ||
            total + storedBytes >
              (options.maxTotalBytes ?? 4 * 1024 * 1024 * 1024)
          )
            fail(409, "已达到待审核数量或存储配额，请联系管理员");
          if (!existing)
            db.prepare(
              "INSERT INTO extensions(id,owner_id,key) VALUES(?,?,?)",
            ).run(release.extensionId, s.user.id, release.key);
          const id = randomUUID();
          db.prepare(
            `INSERT INTO submissions(id,extension_id,name,version,description,submitter_id,status,created_at,permissions,release,zip) VALUES(?,?,?,?,?,?,'pending',?,?,?,?)`,
          ).run(
            id,
            release.extensionId,
            release.name,
            release.version,
            description,
            s.user.id,
            new Date().toISOString(),
            JSON.stringify(permissions),
            releaseText,
            zip,
          );
          audit(db, s.user.id, "submission.create", id);
          return id;
        });
        return send(res, 201, { submission: metadata(find(id)!) });
      } finally {
        uploadsInFlight--;
      }
    }
    if (path === "/api/submissions" && method === "GET") {
      const s = requireUser(req, ["developer", "reviewer", "admin"]);
      const rows = db
        .prepare(
          `${SELECT}${["admin", "reviewer"].includes(s.user.role) ? "" : " WHERE s.submitter_id=?"} ORDER BY s.created_at DESC`,
        )
        .all(
          ...(["admin", "reviewer"].includes(s.user.role) ? [] : [s.user.id]),
        ) as Submission[];
      return send(res, 200, { submissions: rows.map(metadata) });
    }
    match =
      /^\/api\/submissions\/([a-zA-Z0-9-]+)(?:\/(package|review|unpublish))?$/.exec(
        path,
      );
    if (match && method === "GET" && !match[2]) {
      const row = access(req, match[1]),
        release = releaseFor(row.id),
        previous = approved(row.extension_id).find(
          (s) => versionCompare(s.version, row.version) < 0,
        );
      const history = db
        .prepare(
          "SELECT a.action,u.username AS actorName,a.created_at AS createdAt,a.detail FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.target_id=? ORDER BY a.id",
        )
        .all(row.id);
      return send(res, 200, {
        submission: metadata(row),
        history,
        release,
        previousPermissions: previous ? JSON.parse(previous.permissions) : [],
        files: release.files.map(({ path, bytes, sha256 }) => ({
          path,
          bytes,
          sha256,
        })),
      });
    }
    if (match && method === "GET" && match[2] === "package") {
      const row = access(req, match[1]);
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${row.extension_id}-${row.version}.zip"`,
      });
      return res.end(zipFor(row.id));
    }
    if (
      match &&
      method === "POST" &&
      ["review", "unpublish"].includes(match[2])
    ) {
      const action = match[2],
        id = match[1];
      writeAuth(req, action === "review" ? ["reviewer", "admin"] : ["admin"]);
      const input = await jsonBody(req);
      if (
        action === "review" &&
        !["approved", "rejected"].includes(input.decision as string)
      )
        fail(400, "无效审核决定");
      const reason = boundedReason(
        input.reason,
        action === "unpublish" || input.decision === "rejected",
      );
      transaction(db, () => {
        const s = writeAuth(
            req,
            action === "review" ? ["reviewer", "admin"] : ["admin"],
          ),
          row = find(id);
        if (!row) return fail(404, "未找到资源");
        if (action === "review") {
          if (row.status !== "pending") fail(409, "仅待审核版本可审核");
          if (row.submitter_id === s.user.id)
            fail(403, "不能审核自己提交的扩展");
          if (input.decision === "approved") {
            const latest = latestPublished(row.extension_id);
            if (latest && versionCompare(row.version, latest.version) <= 0)
              fail(409, "已有更高或相同版本发布，请拒绝此版本");
          }
          db.prepare(
            "UPDATE submissions SET status=?,reviewer_id=?,reviewed_at=?,reason=? WHERE id=?",
          ).run(
            input.decision as string,
            s.user.id,
            new Date().toISOString(),
            reason,
            id,
          );
        } else {
          if (row.status !== "approved") fail(409, "仅已发布版本可下架");
          db.prepare(
            "UPDATE submissions SET status='unpublished',reason=? WHERE id=?",
          ).run(reason, id);
        }
        audit(
          db,
          s.user.id,
          action === "review"
            ? `submission.${input.decision}`
            : "submission.unpublish",
          id,
          reason,
        );
      });
      return send(res, 200, { submission: metadata(find(id)!) });
    }
    if (path === "/api/catalog" && method === "GET") {
      const ids = db
        .prepare(
          "SELECT DISTINCT extension_id FROM submissions WHERE status='approved'",
        )
        .all();
      return send(res, 200, {
        extensions: ids.map((row) => catalog(row.extension_id as string)),
      });
    }
    match = /^\/api\/extensions\/([a-p]{32})\/catalog$/.exec(path);
    if (match && method === "GET") {
      const result = catalog(match[1]);
      if (!result) fail(404, "未找到资源");
      return send(res, 200, result);
    }
    match =
      /^\/api\/extensions\/([a-p]{32})\/releases\/(\d+(?:\.\d+){2,3})\.(json|zip)$/.exec(
        path,
      );
    if (match && method === "GET") {
      const row = db
        .prepare(
          `SELECT ${match[3] === "json" ? "release" : "zip"} FROM submissions WHERE extension_id=? AND version=? AND status='approved'`,
        )
        .get(match[1], match[2]);
      if (!row) return fail(404, "未找到资源");
      if (match[3] === "json") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        return res.end(row.release as string);
      }
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${match[1]}-${match[2]}.zip"`,
      });
      return res.end(row.zip as Uint8Array);
    }
    if (!path.startsWith("/api/") && method === "GET" && options.staticDir) {
      const file = path === "/" ? "/index.html" : path;
      if (
        !/^\/(?:index\.html|publish\.html|update\.html|assets\/[a-zA-Z0-9_-]+\.(?:js|css|svg|png|woff2)|releases\/(?:catalog\.json|[0-9.]+\.json|focus-notes-[0-9.]+\.zip))$/.test(
          file,
        )
      )
        fail(404, "未找到资源");
      try {
        const root = await realpath(options.staticDir),
          target = await realpath(resolve(root, `.${file}`));
        if (!target.startsWith(root + sep)) fail(404, "未找到资源");
        const bytes = await readFile(target);
        const types: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".zip": "application/zip",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        };
        res.writeHead(200, {
          "Content-Type": types[extname(file)] ?? "application/octet-stream",
        });
        return res.end(bytes);
      } catch {
        fail(404, "未找到资源");
      }
    }
    fail(404, "未找到资源");
  }
  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      send(res, error instanceof HttpError ? error.status : 500, {
        error:
          error instanceof HttpError
            ? error.message
            : "服务器处理失败，请稍后重试",
      });
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return {
    server,
    db,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (
            error &&
            (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
          )
            reject(error);
          else resolve();
        }),
      );
      db.close();
    },
  };
}
