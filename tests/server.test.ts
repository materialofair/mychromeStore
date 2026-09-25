import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { createApp, bootstrap, createUser } from "../server/app.ts";
import type { Role } from "../server/auth.ts";

const origin = "http://localhost:5173",
  password = "test-only-password-1234";
const identity = JSON.parse(
  await readFile(new URL("../demo/identity.json", import.meta.url), "utf8"),
) as { key: string; id: string };
type Login = { cookie: string; csrf: string; id: string };
let app: ReturnType<typeof createApp>, directory: string, base: string;
let admin: Login, dev: Login, reviewer: Login, viewer: Login, second: Login;
async function request(
  path: string,
  method = "GET",
  user?: Login,
  data?: unknown,
  extra: Record<string, string> = {},
) {
  const headers: Record<string, string> = { ...extra };
  if (user) {
    headers.Cookie = user.cookie;
    headers["X-CSRF-Token"] = user.csrf;
  }
  if (method !== "GET") headers.Origin = origin;
  let payload: BodyInit | undefined;
  if (data instanceof Uint8Array) {
    payload = new Uint8Array(data);
    headers["Content-Type"] = "application/zip";
  } else if (data !== undefined) {
    payload = JSON.stringify(data);
    headers["Content-Type"] = "application/json";
  }
  Object.assign(headers, extra);
  return fetch(base + path, { method, headers, body: payload });
}
async function login(username: string) {
  const r = await request("/api/login", "POST", undefined, {
    username,
    password,
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  return {
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    csrf: body.csrfToken,
    id: body.user.id,
  } as Login;
}
function archive(version = "1.0.0", permissions = ["storage"]) {
  return zipSync({
    "manifest.json": strToU8(
      JSON.stringify({
        manifest_version: 3,
        name: "Test extension",
        description: "A test fixture",
        version,
        key: identity.key,
        permissions,
      }),
    ),
    "popup.html": strToU8("<p>Fixture</p>"),
  });
}
async function upload(version = "1.0.0", who = dev) {
  const r = await request("/api/submissions", "POST", who, archive(version));
  expect(r.status).toBe(201);
  return (await r.json()).submission.id as string;
}
async function approve(id: string, who = reviewer) {
  return request(`/api/submissions/${id}/review`, "POST", who, {
    decision: "approved",
  });
}
const releaseUrl = (version = "1.0.0", ext = "zip") =>
  `/api/extensions/${identity.id}/releases/${version}.${ext}`;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "space-api-test-"));
  app = createApp({
    dbPath: join(directory, "store.sqlite"),
    origin,
    reservedIds: [],
    staticDir: directory,
  });
  await writeFile(join(directory, "index.html"), "<p>Public site</p>");
  await bootstrap(app.db, "admin", password);
  for (const [username, role] of [
    ["developer", "developer"],
    ["reviewer", "reviewer"],
    ["viewer", "viewer"],
    ["second", "developer"],
  ] as [string, Role][])
    await createUser(app.db, { username, password, role });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  admin = await login("admin");
  dev = await login("developer");
  reviewer = await login("reviewer");
  viewer = await login("viewer");
  second = await login("second");
});
afterEach(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});
describe("publishing API security and lifecycle", () => {
  it("keeps anonymous, viewer, wrong origin and CSRF writes out", async () => {
    expect(
      (await request("/api/submissions", "POST", undefined, archive())).status,
    ).toBe(401);
    expect(
      (await request("/api/submissions", "POST", viewer, archive())).status,
    ).toBe(403);
    expect(
      (
        await request("/api/submissions", "POST", dev, archive(), {
          Origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/submissions", "POST", dev, archive(), {
          "X-CSRF-Token": "wrong",
        })
      ).status,
    ).toBe(403);
    expect((await request("/api/users", "GET", dev)).status).toBe(403);
    expect((await request("/api/session")).headers.get("cache-control")).toBe(
      "no-store",
    );
  });
  it("publishes only approved bytes, keeps old version during review, and removes unpublished downloads", async () => {
    const id = await upload();
    for (const ext of ["zip", "json"])
      expect((await request(releaseUrl("1.0.0", ext))).status).toBe(404);
    expect((await (await request("/api/catalog")).json()).extensions).toEqual(
      [],
    );
    expect(
      (await request(`/api/submissions/${id}/package`, "GET", viewer)).status,
    ).toBe(403);
    expect(
      (await request(`/api/submissions/${id}/package`, "GET", dev)).status,
    ).toBe(200);
    expect((await approve(id)).status).toBe(200);
    const zip = await request(releaseUrl());
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-disposition")).toContain("attachment");
    const id2 = await upload("1.1.0");
    expect(
      (await (await request(`/api/extensions/${identity.id}/catalog`)).json())
        .latestVersion,
    ).toBe("1.0.0");
    expect((await request(releaseUrl("1.1.0"))).status).toBe(404);
    expect(
      (
        await request(`/api/submissions/${id2}/review`, "POST", reviewer, {
          decision: "rejected",
          reason: "Needs testing",
        })
      ).status,
    ).toBe(200);
    expect((await request(releaseUrl("1.1.0"))).status).toBe(404);
    expect(
      (
        await request(`/api/submissions/${id}/unpublish`, "POST", admin, {
          reason: "Security review",
        })
      ).status,
    ).toBe(200);
    for (const ext of ["zip", "json"])
      expect((await request(releaseUrl("1.0.0", ext))).status).toBe(404);
    expect((await (await request("/api/catalog")).json()).extensions).toEqual(
      [],
    );
    expect(
      app.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit WHERE action LIKE 'submission.%'",
        )
        .get()!.n,
    ).toBe(5);
  });
  it("enforces owner binding, version immutability, and no self review", async () => {
    const id = await upload();
    expect(
      (await request("/api/submissions", "POST", second, archive("1.1.0")))
        .status,
    ).toBe(409);
    expect(
      (await request("/api/submissions", "POST", dev, archive())).status,
    ).toBe(409);
    await request(`/api/users/${dev.id}`, "PATCH", admin, { role: "reviewer" });
    dev = await login("developer");
    expect((await approve(id, dev)).status).toBe(403);
    expect(
      (await request(`/api/submissions/${id}`, "GET", second)).status,
    ).toBe(404);
    expect(
      (await (await request("/api/submissions", "GET", second)).json())
        .submissions,
    ).toEqual([]);
    expect((await approve(id)).status).toBe(200);
    expect((await approve(id)).status).toBe(409);
  });
  it("rejects lower version approval and exposes permission diff to reviewers", async () => {
    const low = await upload(),
      high = await upload("2.0.0");
    expect((await approve(high)).status).toBe(200);
    expect((await approve(low)).status).toBe(409);
    const r = await request(
      "/api/submissions",
      "POST",
      dev,
      archive("2.1.0", ["storage", "tabs"]),
    );
    const id = (await r.json()).submission.id;
    const detail = await (
      await request(`/api/submissions/${id}`, "GET", reviewer)
    ).json();
    expect(detail.previousPermissions).toEqual(["permissions: storage"]);
    expect(detail.submission.permissions).toContain("permissions: tabs");
    expect(detail.files[0]).toHaveProperty("sha256");
  });
  it("revokes sessions on password reset, role changes and disabling; protects last admin", async () => {
    expect(
      (
        await request(`/api/users/${admin.id}`, "PATCH", admin, {
          role: "viewer",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/api/users/${admin.id}`, "PATCH", admin, {
          disabled: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/api/users/${dev.id}`, "PATCH", admin, {
          role: "viewer",
        })
      ).status,
    ).toBe(200);
    expect((await request("/api/submissions", "GET", dev)).status).toBe(401);
    dev = await login("developer");
    expect((await request("/api/submissions", "GET", dev)).status).toBe(403);
    expect(
      (await request("/api/submissions", "POST", dev, archive())).status,
    ).toBe(403);
    await request(`/api/users/${second.id}`, "PATCH", admin, {
      password: "another-test-only-password",
    });
    expect((await request("/api/submissions", "GET", second)).status).toBe(401);
    await request(`/api/users/${reviewer.id}`, "PATCH", admin, {
      disabled: true,
    });
    expect((await request("/api/submissions", "GET", reviewer)).status).toBe(
      401,
    );
    expect(
      (
        await request("/api/login", "POST", undefined, {
          username: "reviewer",
          password,
        })
      ).status,
    ).toBe(401);
  });
  it("validates users, generic login errors, csrf logout and bounded login rate", async () => {
    expect(
      (
        await request("/api/users", "POST", admin, {
          username: "newuser",
          password: "short",
          role: "developer",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/users", "POST", admin, {
          username: "newuser",
          password,
          role: "developer",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request("/api/users", "POST", admin, {
          username: "newuser",
          password,
          role: "viewer",
        })
      ).status,
    ).toBe(409);
    const errors = [];
    for (const username of ["missing", "admin"])
      errors.push(
        await (
          await request("/api/login", "POST", undefined, {
            username,
            password: "wrong-password",
          })
        ).json(),
      );
    expect(errors[0]).toEqual(errors[1]);
    expect(
      (
        await request(
          "/api/logout",
          "POST",
          dev,
          {},
          { "X-CSRF-Token": "wrong" },
        )
      ).status,
    ).toBe(403);
    expect((await request("/api/logout", "POST", dev, {})).status).toBe(200);
    expect(
      (await (await request("/api/session", "GET", dev)).json()).user,
    ).toBeNull();
    for (let i = 0; i < 8; i++)
      await request("/api/login", "POST", undefined, {
        username: "missing",
        password: "wrong-password",
      });
    expect(
      (
        await request("/api/login", "POST", undefined, {
          username: "missing",
          password: "wrong-password",
        })
      ).status,
    ).toBe(429);
  });
  it("has no default accounts in a new DB; restart preserves approved packages and private modes", async () => {
    const id = await upload();
    await approve(id);
    await app.close();
    app = createApp({
      dbPath: join(directory, "store.sqlite"),
      origin,
      reservedIds: [],
    });
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    expect((await request(releaseUrl())).status).toBe(200);
    expect((await stat(join(directory, "store.sqlite"))).mode & 0o777).toBe(
      0o600,
    );
    await expect(bootstrap(app.db, "otheradmin", password)).rejects.toThrow(
      "仅空数据库",
    );
    const other = createApp({ dbPath: ":memory:", origin });
    expect(other.db.prepare("SELECT COUNT(*) AS n FROM users").get()!.n).toBe(
      0,
    );
    await other.close();
  });
  it("rejects invalid archives, reserved ID and quotas without creating records", async () => {
    expect(
      (
        await request(
          "/api/submissions",
          "POST",
          dev,
          new Uint8Array([1, 2, 3]),
        )
      ).status,
    ).toBe(400);
    const id = await upload();
    await approve(id);
    await app.close();
    app = createApp({
      dbPath: join(directory, "store.sqlite"),
      origin,
      maxPending: 1,
      reservedIds: [],
    });
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    await upload("1.1.0");
    expect(
      (await request("/api/submissions", "POST", dev, archive("1.2.0"))).status,
    ).toBe(409);
    await app.close();
    app = createApp({ dbPath: join(directory, "store.sqlite"), origin });
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    expect(
      (await request("/api/submissions", "POST", dev, archive("1.3.0"))).status,
    ).toBe(409);
  });
  it("reauthenticates a streamed upload after role revocation", async () => {
    const bytes = archive();
    let finish!: (status: number) => void;
    const result = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const req = httpRequest(
      base + "/api/submissions",
      {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: dev.cookie,
          "X-CSRF-Token": dev.csrf,
          "Content-Type": "application/zip",
          "Content-Length": bytes.length,
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => finish(res.statusCode!));
      },
    );
    req.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      (
        await request(`/api/users/${dev.id}`, "PATCH", admin, {
          disabled: true,
        })
      ).status,
    ).toBe(200);
    req.end(bytes.subarray(Math.floor(bytes.length / 2)));
    expect(await result).toBe(401);
    expect(
      app.db.prepare("SELECT COUNT(*) AS n FROM submissions").get()!.n,
    ).toBe(0);
  });
  it("bounds concurrent upload bodies and releases the slot on validation failure", async () => {
    const bytes = archive();
    let finish!: (status: number) => void;
    const result = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const req = httpRequest(
      base + "/api/submissions",
      {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: dev.cookie,
          "X-CSRF-Token": dev.csrf,
          "Content-Type": "application/zip",
          "Content-Length": bytes.length,
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => finish(res.statusCode!));
      },
    );
    req.write(bytes.subarray(0, 20));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      (await request("/api/submissions", "POST", second, archive())).status,
    ).toBe(429);
    req.end(new Uint8Array(bytes.length - 20));
    expect(await result).toBe(400);
    expect(
      (await request("/api/submissions", "POST", second, archive())).status,
    ).toBe(201);
  });
  it("expires sessions and rejects authenticated reads after expiry", async () => {
    app.db
      .prepare("UPDATE sessions SET expires_at=0 WHERE user_id=?")
      .run(dev.id);
    expect((await request("/api/submissions", "GET", dev)).status).toBe(401);
    expect(
      (await (await request("/api/session", "GET", dev)).json()).user,
    ).toBeNull();
  });
  it("ignores forged proxy headers by default", async () => {
    for (let i = 1; i <= 8; i++)
      expect(
        (
          await request(
            "/api/login",
            "POST",
            undefined,
            { username: "absent", password: "x".repeat(129) },
            { "X-Real-IP": `192.0.2.${i}` },
          )
        ).status,
      ).toBe(401);
    expect(
      (
        await request(
          "/api/login",
          "POST",
          undefined,
          { username: "absent", password: "x".repeat(129) },
          { "X-Real-IP": "192.0.2.99" },
        )
      ).status,
    ).toBe(429);
  });
  it("uses separate valid IP buckets only with explicit trusted loopback proxy", async () => {
    await app.close();
    app = createApp({
      dbPath: join(directory, "store.sqlite"),
      origin,
      trustProxy: true,
    });
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const bad = { username: "absent", password: "x".repeat(129) };
    for (let i = 1; i <= 9; i++)
      expect(
        (
          await request("/api/login", "POST", undefined, bad, {
            "X-Real-IP": `192.0.2.${i}`,
          })
        ).status,
      ).toBe(401);
    for (let i = 0; i < 7; i++)
      expect(
        (
          await request("/api/login", "POST", undefined, bad, {
            "X-Real-IP": "192.0.2.1",
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await request("/api/login", "POST", undefined, bad, {
          "X-Real-IP": "192.0.2.1",
        })
      ).status,
    ).toBe(429);
    // Invalid or multi-valued addresses share the socket bucket, never arbitrary header keys.
    for (let i = 0; i < 8; i++)
      expect(
        (
          await request("/api/login", "POST", undefined, bad, {
            "X-Real-IP": i % 2 ? "not-an-ip" : "192.0.2.1, 192.0.2.2",
          })
        ).status,
      ).toBe(401);
    expect((await request("/api/login", "POST", undefined, bad)).status).toBe(
      429,
    );
    expect(
      (
        await request("/api/login", "POST", undefined, bad, {
          "X-Real-IP": "2001:db8::1",
        })
      ).status,
    ).toBe(401);
  });
  it("does not expose database paths, nonexistent private packages, or static traversal", async () => {
    expect((await request("/")).status).toBe(200);
    for (const path of [
      "/api/submissions/missing/package",
      "/api/extensions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/releases/1.0.0.zip",
      "/.data/store.sqlite",
      "/server/app.ts",
      "/%2e%2e/.data/store.sqlite",
    ])
      expect((await request(path, "GET", dev)).status).toBe(404);
    const r = await request(
      "/api/submissions",
      "POST",
      dev,
      new Uint8Array(32 * 1024 * 1024 + 1),
    );
    expect(r.status).toBe(413);
  });
});
