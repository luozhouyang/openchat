import { createMiddleware } from "hono/factory";
import { getDb } from "../db/client.ts";
import { getTeamMember, getTeam } from "../db/repos/teams.ts";
import { getChannelMember, getChannel } from "../db/repos/channels.ts";
import { channelMembers, teamMembers } from "../db/schema-d1.ts";
import type { SessionContext } from "./session.ts";
import { PERMISSIONS, resolvePermissions, type Permission } from "./rbac.ts";

type TeamMember = typeof teamMembers.$inferSelect;
type ChannelMember = typeof channelMembers.$inferSelect;

declare module "hono" {
  interface ContextVariableMap {
    teamMember?: TeamMember;
    channelMember?: ChannelMember;
  }
}

type GuardEnv = {
  Bindings: Env;
  Variables: { session: SessionContext };
};

type ResourceOpts = { kind: "team" | "channel"; notFoundError: string };

export function requirePermission(perm: Permission, resource?: ResourceOpts) {
  return createMiddleware<GuardEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const db = getDb(c.env.DB);
    const teamId = c.req.param("teamId");
    const channelId = c.req.param("channelId");

    if (resource) {
      const resourceId = resource.kind === "team" ? teamId : channelId;
      if (!resourceId) return c.json({ error: resource.notFoundError }, 404);
      if (resource.kind === "team") {
        if (!(await getTeam(db, resourceId))) return c.json({ error: resource.notFoundError }, 404);
        const member = await getTeamMember(db, resourceId, session.user.id);
        if (!member) return c.json({ error: "forbidden" }, 403);
        c.set("teamMember", member);
      } else {
        if (!(await getChannel(db, resourceId)))
          return c.json({ error: resource.notFoundError }, 404);
        const member = await getChannelMember(db, resourceId, session.user.id);
        if (!member) return c.json({ error: "forbidden" }, 403);
        c.set("channelMember", member);
      }
    }

    const perms = await resolvePermissions(db, session.user.id, { teamId, channelId });
    if (!perms.has(perm)) return c.json({ error: "forbidden" }, 403);
    return next();
  });
}

export function requireTeamRole(min: "member" | "admin") {
  return requirePermission(min === "admin" ? PERMISSIONS.MANAGE_TEAMS : PERMISSIONS.VIEW_TEAM, {
    kind: "team",
    notFoundError: "team not found",
  });
}

export function requireChannelRole(min: "member" | "admin") {
  return requirePermission(
    min === "admin" ? PERMISSIONS.MANAGE_CHANNEL_ROLES : PERMISSIONS.READ_CHANNEL,
    { kind: "channel", notFoundError: "channel not found" },
  );
}
