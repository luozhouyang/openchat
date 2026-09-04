import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import {
  RolesInput,
  RoleUpdateInput,
  type RolesListOutput,
  type PermissionsOutput,
  type RoleOutput,
  type SchemesOutput,
} from "protocol";
import { requireSession } from "../../auth/session.ts";
import { requirePermission } from "../../auth/guards.ts";
import { PERMISSIONS } from "../../auth/rbac.ts";
import { getDb } from "../../db/client.ts";
import { users, teamMembers, channelMembers, roles as rolesTable } from "../../db/schema-d1.ts";
import { listRoles, listSchemes, updateRolePermissions } from "../../db/repos/roles.ts";
import { getTeamMember } from "../../db/repos/teams.ts";
import { getChannelMember } from "../../db/repos/channels.ts";
import { syncChannelMember } from "../../user-do-sync.ts";
import { apiError } from "../../lib/errors.ts";
import { zodValidator } from "../../lib/validation.ts";

export const rolesV1 = new Hono<{ Bindings: Env }>();

rolesV1.get("/roles", requireSession, requirePermission(PERMISSIONS.MANAGE_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const rows = await listRoles(db);
  const out: RolesListOutput = {
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
        displayName: r.displayName,
        permissions,
        builtIn: r.builtIn === true,
      };
    }),
  };
  return c.json(out);
});
rolesV1.get("/schemes", requireSession, requirePermission(PERMISSIONS.MANAGE_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const schemes = await listSchemes(db);
  const out: SchemesOutput = { schemes };
  return c.json(out);
});
rolesV1.put(
  "/users/:userId/roles",
  requireSession,
  requirePermission(PERMISSIONS.MANAGE_ROLES),
  zodValidator("json", RolesInput),
  async (c) => {
    const body = c.req.valid("json");
    const rawUserId = c.req.param("userId");
    const userId = rawUserId === "me" ? c.get("session")!.user.id : rawUserId;
    const role = body.roles.includes("system_admin") ? "admin" : "user";
    const db = getDb(c.env.DB);
    await db.update(users).set({ role }).where(eq(users.id, userId));
    return c.json({ ok: true });
  },
);
rolesV1.put(
  "/teams/:teamId/members/:userId/roles",
  requireSession,
  requirePermission(PERMISSIONS.MANAGE_TEAMS),
  zodValidator("json", RolesInput),
  async (c) => {
    const body = c.req.valid("json");
    const teamId = c.req.param("teamId");
    const userId = c.req.param("userId");
    const db = getDb(c.env.DB);
    const member = await getTeamMember(db, teamId, userId);
    if (!member) throw apiError("not found", "not found", 404);
    await db
      .update(teamMembers)
      .set({ roles: body.roles.join(" ") })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    return c.json({ ok: true });
  },
);
rolesV1.put(
  "/channels/:channelId/members/:userId/roles",
  requireSession,
  requirePermission(PERMISSIONS.MANAGE_CHANNEL_ROLES),
  zodValidator("json", RolesInput),
  async (c) => {
    const body = c.req.valid("json");
    const channelId = c.req.param("channelId");
    const userId = c.req.param("userId");
    const db = getDb(c.env.DB);
    const member = await getChannelMember(db, channelId, userId);
    if (!member) throw apiError("not found", "not found", 404);
    const roles = body.roles.join(" ");
    await db
      .update(channelMembers)
      .set({ roles })
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
    await syncChannelMember(c.env, channelId, userId, roles);
    return c.json({ ok: true });
  },
);
rolesV1.get("/permissions", requireSession, async (c) => {
  const out: PermissionsOutput = { permissions: Object.values(PERMISSIONS) };
  return c.json(out);
});
rolesV1.put(
  "/roles/:roleId",
  requireSession,
  requirePermission(PERMISSIONS.MANAGE_ROLES),
  zodValidator("json", RoleUpdateInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    const roleId = c.req.param("roleId");
    const rows = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId)).limit(1);
    if (!rows[0]) throw apiError("not found", "not found", 404);
    const known = new Set<string>(Object.values(PERMISSIONS));
    for (const p of body.permissions) {
      if (!known.has(p)) throw apiError("invalid", `unknown permission: ${p}`, 422);
    }
    const role = await updateRolePermissions(db, roleId, body.permissions);
    if (!role) throw apiError("not found", "not found", 404);
    let permissions: string[] = [];
    try {
      const parsed = JSON.parse(role.permissions) as unknown;
      if (Array.isArray(parsed)) permissions = parsed.filter((p) => typeof p === "string");
    } catch {
      // invalid permission JSON is ignored
    }
    const out: RoleOutput = {
      id: role.id,
      name: role.name,
      displayName: role.displayName,
      permissions,
      builtIn: role.builtIn === true,
    };
    return c.json({ ok: true, role: out });
  },
);
