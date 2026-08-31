import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../../auth/session.ts";
import { requirePermission } from "../../auth/guards.ts";
import { PERMISSIONS } from "../../auth/rbac.ts";
import { getDb } from "../../db/client.ts";
import { users, teamMembers, channelMembers } from "../../db/schema-d1.ts";
import { listRoles, listSchemes } from "../../db/repos/roles.ts";
import { getTeamMember } from "../../db/repos/teams.ts";
import { getChannelMember } from "../../db/repos/channels.ts";
import { syncChannelMember } from "../../user-do-sync.ts";

const RolesBody = z.object({ roles: z.array(z.string()) });

export const rolesV1 = new Hono<{ Bindings: Env }>();

rolesV1.get("/roles", requireSession, requirePermission(PERMISSIONS.MANAGE_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const rows = await listRoles(db);
  return c.json({
    roles: rows.map((r) => {
      let permissions: string[] = [];
      try {
        const parsed = JSON.parse(r.permissions) as unknown;
        if (Array.isArray(parsed)) permissions = parsed.filter((p) => typeof p === "string");
      } catch {
        // invalid permission JSON is ignored
      }
      return {
        id: r.id,
        name: r.name,
        display_name: r.displayName,
        permissions,
        built_in: r.builtIn,
      };
    }),
  });
});

rolesV1.get("/schemes", requireSession, requirePermission(PERMISSIONS.MANAGE_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const schemes = await listSchemes(db);
  return c.json({ schemes });
});

rolesV1.put(
  "/users/:userId/roles",
  requireSession,
  requirePermission(PERMISSIONS.MANAGE_ROLES),
  async (c) => {
    const body = RolesBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 422);
    const rawUserId = c.req.param("userId");
    const userId = rawUserId === "me" ? c.get("session")!.user.id : rawUserId;
    const role = body.data.roles.includes("system_admin") ? "admin" : "user";
    const db = getDb(c.env.DB);
    await db.update(users).set({ role }).where(eq(users.id, userId));
    return c.json({ ok: true });
  },
);

rolesV1.put(
  "/teams/:teamId/members/:userId/roles",
  requireSession,
  requirePermission(PERMISSIONS.MANAGE_TEAMS),
  async (c) => {
    const body = RolesBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 422);
    const teamId = c.req.param("teamId");
    const userId = c.req.param("userId");
    const db = getDb(c.env.DB);
    const member = await getTeamMember(db, teamId, userId);
    if (!member) return c.json({ error: "not found" }, 404);
    await db
      .update(teamMembers)
      .set({ roles: body.data.roles.join(" ") })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    return c.json({ ok: true });
  },
);

rolesV1.put(
  "/channels/:channelId/members/:userId/roles",
  requireSession,
  requirePermission(PERMISSIONS.MANAGE_CHANNEL_ROLES),
  async (c) => {
    const body = RolesBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 422);
    const channelId = c.req.param("channelId");
    const userId = c.req.param("userId");
    const db = getDb(c.env.DB);
    const member = await getChannelMember(db, channelId, userId);
    if (!member) return c.json({ error: "not found" }, 404);
    const roles = body.data.roles.join(" ");
    await db
      .update(channelMembers)
      .set({ roles })
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
    await syncChannelMember(c.env, channelId, userId, roles);
    return c.json({ ok: true });
  },
);
