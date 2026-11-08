import { v7 as uuidv7 } from "uuid";

export type IdKind =
  | "usr"
  | "team"
  | "chn"
  | "msg"
  | "fil"
  | "upl"
  | "inv"
  | "emo"
  | "rol"
  | "sch"
  | "ntf"
  | "int";

export function id(kind: IdKind): string {
  return `${kind}_${uuidv7()}`;
}

export function userDoName(userId: string): string {
  return `user:${userId}`;
}

export function channelDoName(channelId: string): string {
  return `channel:${channelId}`;
}
