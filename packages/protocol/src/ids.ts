import { ulid } from "ulid";

export function newId(): string {
  return ulid();
}

export function userDoName(userId: string): string {
  return `user:${userId}`;
}

export function channelDoName(channelId: string): string {
  return `channel:${channelId}`;
}
