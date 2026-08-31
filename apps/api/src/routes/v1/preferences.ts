import { Hono, type Context } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
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

type PrefContext = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

export const preferencesV1 = new Hono<{ Bindings: Env }>();

const PutItem = z.object({
  user_id: z.string().optional(),
  category: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  value: z.string().max(4096).default(""),
});
const PutBody = z.array(PutItem).max(1000);

const DeleteItem = z.object({
  user_id: z.string().optional(),
  category: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
});
const DeleteBody = z.array(DeleteItem).max(1000);

function targetUserId(c: PrefContext, raw: string): string {
  return raw === "me" ? c.get("session")!.user.id : raw;
}

async function canAccess(c: PrefContext, targetId: string): Promise<boolean> {
  const sessionId = c.get("session")!.user.id;
  if (targetId === sessionId) return true;
  const db = getDb(c.env.DB);
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, sessionId))
    .limit(1);
  return rows[0]?.role === "admin";
}

preferencesV1.get(
  "/users/:user_id/preferences/:category/name/:preference_name",
  requireSession,
  async (c) => {
    const userId = targetUserId(c, c.req.param("user_id"));
    if (!(await canAccess(c, userId))) return c.json({ error: "forbidden" }, 403);
    const db = getDb(c.env.DB);
    const row = await getPreference(db, {
      userId,
      category: c.req.param("category"),
      name: c.req.param("preference_name"),
    });
    return c.json({ value: row?.value ?? null });
  },
);

preferencesV1.get("/users/:user_id/preferences/:category", requireSession, async (c) => {
  const userId = targetUserId(c, c.req.param("user_id"));
  if (!(await canAccess(c, userId))) return c.json({ error: "forbidden" }, 403);
  const db = getDb(c.env.DB);
  const { preferences } = await getPreferences(db, userId);
  const category = c.req.param("category");
  return c.json({ preferences: preferences.filter((p) => p.category === category) });
});

preferencesV1.get("/users/:user_id/preferences", requireSession, async (c) => {
  const userId = targetUserId(c, c.req.param("user_id"));
  if (!(await canAccess(c, userId))) return c.json({ error: "forbidden" }, 403);
  const db = getDb(c.env.DB);
  return c.json(await getPreferences(db, userId));
});

preferencesV1.put("/users/:user_id/preferences", requireSession, async (c) => {
  const userId = targetUserId(c, c.req.param("user_id"));
  if (!(await canAccess(c, userId))) return c.json({ error: "forbidden" }, 403);
  const body = PutBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  await setPreferences(
    db,
    userId,
    body.data.map(({ category, name, value }) => ({ category, name, value })),
  );
  return c.json({ ok: true });
});

preferencesV1.delete("/users/:user_id/preferences", requireSession, async (c) => {
  const userId = targetUserId(c, c.req.param("user_id"));
  if (!(await canAccess(c, userId))) return c.json({ error: "forbidden" }, 403);
  const body = DeleteBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  await deletePreferences(
    db,
    userId,
    body.data.map(({ category, name }) => ({ category, name })),
  );
  return c.json({ ok: true });
});
