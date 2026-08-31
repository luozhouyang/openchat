import { Hono } from "hono";
import { userDoName } from "protocol";
import { requireSession } from "../../auth/session.ts";

interface SidebarChannel {
  channelId: string;
  maxSeq: number;
  lastReadSeq: number;
  unread: number;
  mentions: number;
  preview: string | null;
  lastMessageAt: number | null;
}

interface SidebarResult {
  channels: SidebarChannel[];
}

export const sidebarV1 = new Hono<{ Bindings: Env }>();

sidebarV1.get("/users/me/sidebar", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const id = c.env.USER_DO.idFromName(userDoName(userId));
  const result = (await c.env.USER_DO.get(id).sidebar()) as SidebarResult;
  return c.json(result);
});
