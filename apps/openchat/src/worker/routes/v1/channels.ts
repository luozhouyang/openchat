import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { channelDoName, type ChannelType } from "protocol";
import {
  CreateChannelInput,
  CreateChannelOutput,
  OpenDirectInput,
  OpenGroupInput,
  OpenChannelOutput,
  ChannelsForTeamOutput,
  ChannelDetailOutput,
  UpdateChannelInput,
  type UpdateChannelOutput,
  ListMembersQuery,
  ChannelsListOutput,
  NotifyPropsInput,
  type NotifyPropsOutput,
  channelCreatedEvent,
  channelUpdatedEvent,
  channelMemberAddedEvent,
  channelMemberRemovedEvent,
  type ChannelSummary,
} from "protocol";
import { requireSession } from "@worker/auth/session";
import { requireTeamRole, requireChannelRole } from "@worker/auth/guards";
import { PERMISSIONS, resolvePermissions } from "@worker/auth/rbac";
import { getDb } from "@worker/db/client";
import { channelMembers } from "@worker/db/schema-d1";
import {
  listChannelsForTeam,
  getChannel,
  listChannelMemberIds,
  updateChannel,
} from "@worker/db/repos/channels";
import { getTeamMember } from "@worker/db/repos/teams";
import {
  createChannel,
  openDirect,
  openGroup,
  joinChannel,
  leaveChannel,
  archiveChannel,
  restoreChannel,
} from "@worker/services/channel.service";
import { getChannelMember } from "@worker/db/repos/channels";
import { zodValidator } from "@worker/lib/validation";
import { apiError } from "@worker/lib/errors";
import { syncChannelMember, syncUserChannels } from "@worker/user-do-sync";
import { createChannelBroadcaster, deliverStructure } from "@worker/structure-broadcast";
import type { Channel, Db } from "@worker/db/types";
import { directDisplayName, memberNames } from "@worker/routes/v1/users";

export const channelsV1 = new Hono<{ Bindings: Env }>();

function toSummary(ch: Channel, member: boolean): ChannelSummary {
  return {
    id: ch.id,
    teamId: ch.teamId,
    name: ch.name,
    displayName: ch.displayName,
    type: ch.type as ChannelSummary["type"],
    member,
    archivedAt: ch.archivedAt,
  };
}

// dm/gm display names are per-recipient (each member sees the OTHER members'
// names, same rule as the workspaces endpoint), so one shared payload won't
// do: deliver a personalized channel.created to every member.
async function deliverDirectCreated(
  env: Env,
  db: Db,
  channelId: string,
  type: "dm" | "gm",
  memberIds: string[],
) {
  const ch = (await getChannel(db, channelId))!;
  await Promise.all(
    memberIds.map(async (uid) => {
      const others = memberIds.filter((id) => id !== uid);
      const displayName = directDisplayName(type, await memberNames(db, others));
      const event = channelCreatedEvent.parse({
        type: "channel.created",
        channel: { ...toSummary(ch, true), displayName },
      });
      await deliverStructure(env, uid, event);
    }),
  );
}

channelsV1.post(
  "/channels",
  requireSession,
  zodValidator("json", CreateChannelInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    const me = c.get("session")!.user.id;
    const teamMember = await getTeamMember(db, body.teamId, me);
    if (!teamMember) {
      throw apiError("forbidden", "forbidden", 403);
    }
    // Channel creation used to accept any team member. It now goes through
    // the modeled RBAC permission the same way requirePermission does — the
    // required permission depends on the channel type in the body, which the
    // path-param-driven guard middleware can't express for this route, so the
    // permission check runs against the resolved permission set after the
    // membership check above (non-members resolve to system_user-scoped
    // roles; the create permissions only come from team/channel roles).
    const createPerm =
      body.type === "public"
        ? PERMISSIONS.CREATE_PUBLIC_CHANNEL
        : PERMISSIONS.CREATE_PRIVATE_CHANNEL;
    const perms = await resolvePermissions(db, me, { teamId: body.teamId });
    if (!perms.has(createPerm)) {
      throw apiError("forbidden", "forbidden", 403);
    }
    const ch = await createChannel(db, {
      teamId: body.teamId,
      name: body.name,
      displayName: body.displayName,
      type: body.type,
      purpose: body.purpose,
      header: body.header,
      creatorId: me,
    });
    await syncChannelMember(c.env, ch.id, ch.creatorId!, "channel_admin");
    await createChannelBroadcaster(c.env, ch.id).broadcast(
      channelCreatedEvent.parse({ type: "channel.created", channel: toSummary(ch, true) }),
    );
    const out: CreateChannelOutput = { id: ch.id };
    return c.json(out, 201);
  },
);

channelsV1.get("/teams/:teamId/channels", requireSession, requireTeamRole("member"), async (c) => {
  const db = getDb(c.env.DB);
  const teamId = c.req.param("teamId");
  const userId = c.get("session")!.user.id;
  const all = await listChannelsForTeam(db, teamId);
  const memberRows = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, userId));
  const mine = new Set(memberRows.map((r) => r.channelId));
  const out: ChannelsForTeamOutput = {
    channels: all.map((ch) => ({
      id: ch.id,
      teamId: ch.teamId,
      name: ch.name,
      displayName: ch.displayName,
      type: ch.type as ChannelType,
      member: mine.has(ch.id),
      archivedAt: ch.archivedAt,
    })),
  };
  return c.json(out);
});

channelsV1.get("/channels/:channelId", requireSession, requireChannelRole("member"), async (c) => {
  const db = getDb(c.env.DB);
  const ch = (await getChannel(db, c.req.param("channelId")))!;
  const memberIds = await listChannelMemberIds(db, ch.id);
  const out: ChannelDetailOutput = {
    channel: {
      id: ch.id,
      displayName: ch.displayName,
      type: ch.type as ChannelType,
      purpose: ch.purpose,
      header: ch.header,
      memberCount: memberIds.length,
      archivedAt: ch.archivedAt,
    },
  };
  return c.json(out);
});

channelsV1.post("/channels/:channelId/members", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const channelId = c.req.param("channelId");
  const userId = c.get("session")!.user.id;
  const joined = await joinChannel(db, { channelId, userId });
  if (joined) {
    await syncChannelMember(c.env, channelId, userId, "channel_user");
    await syncUserChannels(c.env, userId);
    await createChannelBroadcaster(c.env, channelId).broadcast(
      channelMemberAddedEvent.parse({
        type: "channel.member_added",
        channelId,
        userId,
        roles: "channel_user",
      }),
    );
  }
  return c.json({ ok: true });
});

channelsV1.delete(
  "/channels/:channelId/members/:userId",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    // Self-leave for everyone; admins may kick others. Permission is evaluated
    // through the same RBAC system used by requirePermission (guards.ts):
    // channel_admin / team_admin carry
    // MANAGE_{PUBLIC,PRIVATE}_CHANNEL_MEMBERS in the seeded role sets
    // (auth/rbac.ts SEED_ROLES). DM/GM have no admin semantics, so only the
    // member themself may leave those.
    const userIdParam = c.req.param("userId");
    const me = c.get("session")!.user.id;
    const db0 = getDb(c.env.DB);
    const channelId = c.req.param("channelId");
    const ch = (await getChannel(db0, channelId))!; // requireChannelRole already 404s for missing channels
    const target = userIdParam === "me" ? me : userIdParam;
    if (target !== me) {
      if (ch.type !== "public" && ch.type !== "private") {
        throw apiError("forbidden", "forbidden", 403);
      }
      const perms = await resolvePermissions(db0, me, {
        ...(ch.teamId ? { teamId: ch.teamId } : {}),
        channelId,
      });
      const manage =
        ch.type === "private"
          ? PERMISSIONS.MANAGE_PRIVATE_CHANNEL_MEMBERS
          : PERMISSIONS.MANAGE_PUBLIC_CHANNEL_MEMBERS;
      if (!perms.has(manage)) {
        throw apiError("forbidden", "forbidden", 403);
      }
    }
    // D1 row first read for rollback semantics: if the DO call or the final
    // D1 write fails after the DO-side removal, we can put the membership back.
    const membership = await getChannelMember(db0, channelId, target);
    // Remove DO-side membership + thread subscriptions via the ChannelDO
    // contract member removal (idempotent). It broadcasts channel.member_removed
    // to remaining structure targets plus the removed user itself — no extra
    // broadcast here (the previous double/triple broadcast was redundant).
    const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelDoName(channelId)));
    const doRemoved = await stub.removeMember(target);
    if (membership && !doRemoved) {
      // D1 had the membership but the DO row was already gone (drift): the DO
      // broadcast didn't fire, so at least unstick the removed user's own
      // caches (their UserDO channelsCache/sidebar would keep the ghost).
      await deliverStructure(
        c.env,
        target,
        channelMemberRemovedEvent.parse({
          type: "channel.member_removed",
          channelId,
          userId: target,
        }),
      );
    }
    try {
      await leaveChannel(db0, { channelId, userId: target });
    } catch (err) {
      // Compensate: a half-applied kick (DO removed, D1 kept) would leave a
      // member who sees broadcasts but cannot act — undo the DO side best
      // effort, then surface the failure for a clean client retry.
      if (membership) {
        await stub
          .membersAdd({ userId: target, role: membership.roles ?? "member" })
          .catch(() => {});
      }
      throw err;
    }
    await syncUserChannels(c.env, target).catch(() => {
      // Deletion already succeeded both sides; cache sync is read-repairable.
    });
    return c.json({ ok: true });
  },
);

channelsV1.post(
  "/channels/direct",
  requireSession,
  zodValidator("json", OpenDirectInput),
  async (c) => {
    const me = c.get("session")!.user.id;
    const body = c.req.valid("json");
    if (!body.userIds.includes(me)) {
      throw apiError("invalid", "invalid", 422);
    }
    const withUserId = body.userIds.find((u) => u !== me);
    if (!withUserId) {
      throw apiError("invalid", "invalid", 422);
    }
    const db = getDb(c.env.DB);
    const { id: channelId, existing } = await openDirect(db, { userId: me, withUserId });
    if (!existing) {
      await syncChannelMember(c.env, channelId, me, "channel_user");
      await syncChannelMember(c.env, channelId, withUserId, "channel_user");
      await syncUserChannels(c.env, me);
      await syncUserChannels(c.env, withUserId);
      await deliverDirectCreated(c.env, db, channelId, "dm", [me, withUserId]);
    }
    const out: OpenChannelOutput = { id: channelId, existing };
    return c.json(out, existing ? 200 : 201);
  },
);

channelsV1.post(
  "/channels/group",
  requireSession,
  zodValidator("json", OpenGroupInput),
  async (c) => {
    const me = c.get("session")!.user.id;
    const body = c.req.valid("json");
    const userIds = body.userIds.filter((u) => u !== me);
    if (userIds.length < 2) {
      throw apiError("invalid", "invalid", 422);
    }
    const db = getDb(c.env.DB);
    const { id: channelId, existing } = await openGroup(db, { userId: me, userIds });
    if (!existing) {
      const ids = [...new Set([me, ...userIds])];
      for (const uid of ids) {
        await syncChannelMember(c.env, channelId, uid, "channel_user");
        await syncUserChannels(c.env, uid);
      }
      await deliverDirectCreated(c.env, db, channelId, "gm", ids);
    }
    const out: OpenChannelOutput = { id: channelId, existing };
    return c.json(out, existing ? 200 : 201);
  },
);

channelsV1.put(
  "/channels/:channelId",
  requireSession,
  requireChannelRole("admin"),
  zodValidator("json", UpdateChannelInput),
  async (c) => {
    const db = getDb(c.env.DB);
    const channelId = c.req.param("channelId");
    const body = c.req.valid("json");
    const updated = await updateChannel(db, {
      channelId,
      displayName: body.displayName,
      purpose: body.purpose,
      header: body.header,
    });
    if (!updated) {
      throw apiError("not found", "not found", 404);
    }
    const summary = toSummary(updated, true);
    await createChannelBroadcaster(c.env, channelId).broadcast(
      channelUpdatedEvent.parse({ type: "channel.updated", channel: summary }),
    );
    const out: UpdateChannelOutput = { channel: summary };
    return c.json(out);
  },
);

channelsV1.delete(
  "/channels/:channelId",
  requireSession,
  requireChannelRole("admin"),
  async (c) => {
    const db = getDb(c.env.DB);
    const channelId = c.req.param("channelId");
    await archiveChannel(db, { channelId });
    const ch = await getChannel(db, channelId);
    if (ch) {
      await createChannelBroadcaster(c.env, channelId).broadcast(
        channelUpdatedEvent.parse({ type: "channel.updated", channel: toSummary(ch, true) }),
      );
    }
    return c.json({ ok: true });
  },
);

channelsV1.post(
  "/channels/:channelId/restore",
  requireSession,
  requireChannelRole("admin"),
  async (c) => {
    const db = getDb(c.env.DB);
    const channelId = c.req.param("channelId");
    await restoreChannel(db, { channelId });
    const ch = await getChannel(db, channelId);
    if (ch) {
      await createChannelBroadcaster(c.env, channelId).broadcast(
        channelUpdatedEvent.parse({ type: "channel.updated", channel: toSummary(ch, true) }),
      );
    }
    return c.json({ ok: true });
  },
);

channelsV1.get(
  "/channels/:channelId/members",
  requireSession,
  requireChannelRole("member"),
  zodValidator("query", ListMembersQuery),
  async (c) => {
    const db = getDb(c.env.DB);
    const query = c.req.valid("query");
    const page = query.page ?? 0;
    const perPage = query.perPage ?? 60;
    const all = await listChannelMemberIds(db, c.req.param("channelId"));
    const start = page * perPage;
    const out: ChannelsListOutput = { memberIds: all.slice(start, start + perPage) };
    return c.json(out);
  },
);

channelsV1.get(
  "/channels/:channelId/notifyProps",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const channelId = c.req.param("channelId");
    const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelDoName(channelId)));
    const res = await stub.getNotifPref(c.get("session")!.user.id);
    const out: NotifyPropsOutput = { notifyProps: { pref: res.pref } };
    return c.json(out);
  },
);

channelsV1.put(
  "/channels/:channelId/members/:userId/notifyProps",
  requireSession,
  requireChannelRole("member"),
  zodValidator("json", NotifyPropsInput),
  async (c) => {
    const body = c.req.valid("json");
    const userId = c.req.param("userId");
    const me = c.get("session")!.user.id;
    if (userId !== me && userId !== "me") {
      throw apiError("forbidden", "forbidden", 403);
    }
    const id = c.env.CHANNEL_DO.idFromName(channelDoName(c.req.param("channelId")));
    const res = await c.env.CHANNEL_DO.get(id).setNotifPref({
      userId: me,
      pref: body.notifyProps.pref,
    });
    if ("error" in res) {
      throw apiError(res.error, res.error, res.status as 403 | 422);
    }
    return c.json({ ok: true });
  },
);
