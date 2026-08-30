import { createMiddleware } from "hono/factory";
import { getDb } from "../db/client.ts";
import { getTeamMember, getTeam } from "../db/repos/teams.ts";
import { getChannelMember, getChannel } from "../db/repos/channels.ts";
import { channelMembers, teamMembers } from "../db/schema-d1.ts";
import type { SessionContext } from "./session.ts";

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

export function requireTeamRole(min: "member" | "admin") {
  return createMiddleware<GuardEnv>(async (c, next) => {
    const teamId = c.req.param("teamId");
    if (!teamId) return c.json({ error: "team not found" }, 404);
    const session = c.get("session");
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const db = getDb(c.env.DB);
    const team = await getTeam(db, teamId);
    if (!team) return c.json({ error: "team not found" }, 404);
    const member = await getTeamMember(db, teamId, session.user.id);
    if (!member) return c.json({ error: "forbidden" }, 403);
    if (min === "admin" && member.role !== "admin") return c.json({ error: "forbidden" }, 403);
    c.set("teamMember", member);
    return next();
  });
}

export function requireChannelRole(min: "member" | "admin") {
  return createMiddleware<GuardEnv>(async (c, next) => {
    const channelId = c.req.param("channelId");
    if (!channelId) return c.json({ error: "channel not found" }, 404);
    const session = c.get("session");
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const db = getDb(c.env.DB);
    const channel = await getChannel(db, channelId);
    if (!channel) return c.json({ error: "channel not found" }, 404);
    const member = await getChannelMember(db, channelId, session.user.id);
    if (!member) return c.json({ error: "forbidden" }, 403);
    if (min === "admin" && member.role !== "admin") return c.json({ error: "forbidden" }, 403);
    c.set("channelMember", member);
    return next();
  });
}
