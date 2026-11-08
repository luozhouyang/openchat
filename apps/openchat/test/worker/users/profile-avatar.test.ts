import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { signup, userIdOf } from "../helpers/setup.ts";

let cookie = "";
let userId = "";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeAll(async () => {
  cookie = await signup(exports.default, "profile@test.dev", "test-password", "Profile");
  userId = await userIdOf(exports.default, cookie);
});

test("updates the caller's display name and nickname", async () => {
  const patch = await exports.default.fetch("http://localhost/api/v1/users/me", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "New Name", nickname: "newbie" }),
  });
  expect(patch.status).toBe(200);

  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const body = (await me.json()) as {
    user: { name: string | null; nickname: string | null };
  };
  expect(body.user.name).toBe("New Name");
  expect(body.user.nickname).toBe("newbie");
});

test("rejects an empty display name", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "   " }),
  });
  expect(res.status).toBe(422);
});

test("profile updates require a session", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Anonymous" }),
  });
  expect(res.status).toBe(401);
});

test("uploads an avatar and serves it back", async () => {
  const upload = await exports.default.fetch("http://localhost/api/v1/users/me/avatar", {
    method: "POST",
    headers: { cookie, "content-type": "image/png" },
    body: PNG_BYTES,
  });
  expect(upload.status).toBe(200);
  const { avatarUrl } = (await upload.json()) as { avatarUrl: string };
  expect(avatarUrl).toContain(`/users/${userId}/avatar`);

  const image = await exports.default.fetch(`http://localhost${avatarUrl}`);
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/png");
});

test("rejects unsupported avatar types and oversized files", async () => {
  const wrongType = await exports.default.fetch("http://localhost/api/v1/users/me/avatar", {
    method: "POST",
    headers: { cookie, "content-type": "text/plain" },
    body: "not an image",
  });
  expect(wrongType.status).toBe(415);

  const tooLarge = await exports.default.fetch("http://localhost/api/v1/users/me/avatar", {
    method: "POST",
    headers: { cookie, "content-type": "image/png" },
    body: new Uint8Array(2 * 1024 * 1024 + 1),
  });
  expect(tooLarge.status).toBe(413);
});

test("returns 404 for a user without an avatar", async () => {
  const otherCookie = await signup(exports.default, "no-avatar@test.dev", "test-password", "No");
  const otherId = await userIdOf(exports.default, otherCookie);
  const res = await exports.default.fetch(`http://localhost/api/v1/users/${otherId}/avatar`);
  expect(res.status).toBe(404);
});
