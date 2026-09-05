import { createMiddleware } from "hono/factory";
import { getDb } from "@worker/db/client";
import { getTeamMember, getTeam } from "@worker/db/repos/teams";
import { getChannelMember, getChannel } from "@worker/db/repos/channels";
import { channelMembers, teamMembers } from "@worker/db/schema-d1";
import type { SessionContext } from "@worker/auth/session";
import { PERMISSIONS, resolvePermissions, type Permission } from "@worker/auth/rbac";
import { apiError } from "@worker/lib/errors";

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
    if (!session) {
      throw apiError("unauthorized", "unauthorized", 401);
    }
    const db = getDb(c.env.DB);
    const teamId = c.req.param("teamId");
    const channelId = c.req.param("channelId");

    if (resource) {
      const resourceId = resource.kind === "team" ? teamId : channelId;
      if (!resourceId) {
        throw apiError("not_found", resource.notFoundError, 404);
      }
      if (resource.kind === "team") {
        if (!(await getTeam(db, resourceId))) {
          throw apiError("not_found", resource.notFoundError, 404);
        }
        const member = await getTeamMember(db, resourceId, session.user.id);
        if (!member) {
          throw apiError("forbidden", "forbidden", 403);
        }
        c.set("teamMember", member);
      } else {
        if (!(await getChannel(db, resourceId))) {
          throw apiError("not_found", resource.notFoundError, 404);
        }
        const member = await getChannelMember(db, resourceId, session.user.id);
        if (!member) {
          throw apiError("forbidden", "forbidden", 403);
        }
        c.set("channelMember", member);
      }
    }

    const perms = await resolvePermissions(db, session.user.id, { teamId, channelId });
    if (!perms.has(perm)) {
      throw apiError("forbidden", "forbidden", 403);
    }
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
