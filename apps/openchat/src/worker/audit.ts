import { id } from "protocol";
import type { Db } from "@worker/db/types";
import { auditLogs } from "@worker/db/schema-d1";

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  status: string;
  detail?: unknown;
}

/** Writes the entry to the log stream and to D1; storage failures never throw. */
export async function auditLog(db: Db, entry: AuditEntry): Promise<void> {
  console.info(JSON.stringify({ type: "admin.audit", at: Date.now(), ...entry }));
  try {
    await db.insert(auditLogs).values({
      id: id("aud"),
      actorId: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      status: entry.status,
      detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
      createdAt: Date.now(),
    });
  } catch (err) {
    console.error("audit log write failed", err);
  }
}
