import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import {
  PutPreferencesInput,
  DeletePreferencesInput,
  PreferencesOutput,
  PreferenceValueOutput,
} from "protocol";
import type { SessionContext } from "../../auth/session.ts";
import { requireSession } from "../../auth/session.ts";
import { getDb } from "../../db/client.ts";
import { users } from "../../db/schema-d1.ts";
import { getPreference } from "../../db/repos/preferences.ts";
import {
  getPreferences,
  setPreferences,
  deletePreferences,
} from "../../services/preference.service.ts";
import { zodValidator } from "../../lib/validation.ts";
import { apiError } from "../../lib/errors.ts";

type PrefCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

export const preferencesV1 = new Hono<{ Bindings: Env }>();

function targetUserId(c: PrefCtx, raw: string): string {
  return raw === "me" ? c.get("session")!.user.id : raw;
}

async function canAccess(c: PrefCtx, targetId: string): Promise<boolean> {
  const sessionId = c.get("session")!.user.id;
  if (targetId === sessionId) return true;
  const db = getDb(c.env.DB);
  const roleRows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, sessionId))
    .limit(1);
  const role = roleRows[0]?.role;
  return role === "admin";
}

preferencesV1.get(
  "/users/:userId/preferences/:category/name/:preferenceName",
  requireSession,
  async (c) => {
    const userId = targetUserId(c, c.req.param("userId"));
    if (!(await canAccess(c, userId))) throw apiError("forbidden", "forbidden", 403);
    const db = getDb(c.env.DB);
    const row = await getPreference(db, {
      userId,
      category: c.req.param("category"),
      name: c.req.param("preferenceName"),
    });
    const out: PreferenceValueOutput = { value: row?.value ?? null };
    return c.json(out);
  },
);

preferencesV1.get("/users/:userId/preferences/:category", requireSession, async (c) => {
  const userId = targetUserId(c, c.req.param("userId"));
  if (!(await canAccess(c, userId))) throw apiError("forbidden", "forbidden", 403);
  const db = getDb(c.env.DB);
  const { preferences } = await getPreferences(db, userId);
  const category = c.req.param("category");
  const out: PreferencesOutput = {
    preferences: preferences.filter((p) => p.category === category),
  };
  return c.json(out);
});

preferencesV1.get("/users/:userId/preferences", requireSession, async (c) => {
  const userId = targetUserId(c, c.req.param("userId"));
  if (!(await canAccess(c, userId))) throw apiError("forbidden", "forbidden", 403);
  const db = getDb(c.env.DB);
  const out: PreferencesOutput = await getPreferences(db, userId);
  return c.json(out);
});

preferencesV1.put(
  "/users/:userId/preferences",
  requireSession,
  zodValidator("json", PutPreferencesInput),
  async (c) => {
    const userId = targetUserId(c, c.req.param("userId"));
    if (!(await canAccess(c, userId))) throw apiError("forbidden", "forbidden", 403);
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    await setPreferences(
      db,
      userId,
      body.map(({ category, name, value }) => ({ category, name, value })),
    );
    return c.json({ ok: true });
  },
);

preferencesV1.delete(
  "/users/:userId/preferences",
  requireSession,
  zodValidator("json", DeletePreferencesInput),
  async (c) => {
    const userId = targetUserId(c, c.req.param("userId"));
    if (!(await canAccess(c, userId))) throw apiError("forbidden", "forbidden", 403);
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    await deletePreferences(
      db,
      userId,
      body.map(({ category, name }) => ({ category, name })),
    );
    return c.json({ ok: true });
  },
);
