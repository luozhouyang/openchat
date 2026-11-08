import { eq } from "drizzle-orm";
import { systemSettings } from "@worker/db/schema-d1";
import type { Db } from "@worker/db/types";

/**
 * key/value store for operator-controlled platform settings. `system_settings`
 * pre-dated any read/write path (the registration review item); this repo is
 * the single owner of that CRUD now.
 */
export const REGISTRATION_MODE_KEY = "registration_mode";

export type RegistrationMode = "open" | "invite" | "closed";
export const REGISTRATION_MODES: readonly RegistrationMode[] = ["open", "invite", "closed"];

export function isRegistrationMode(v: unknown): v is RegistrationMode {
  return typeof v === "string" && (REGISTRATION_MODES as readonly string[]).includes(v);
}

/** Returns the stored registration_mode, defaulting to `open` when unset. */
export async function getRegistrationMode(db: Db): Promise<RegistrationMode> {
  const rows = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, REGISTRATION_MODE_KEY))
    .limit(1);
  const raw = rows[0]?.value;
  return isRegistrationMode(raw) ? raw : "open";
}

/** Upserts the registration mode with `open`/`invite`/`closed` normalized. */
export async function setRegistrationMode(db: Db, mode: RegistrationMode): Promise<void> {
  const now = Date.now();
  await db
    .insert(systemSettings)
    .values({ key: REGISTRATION_MODE_KEY, value: mode, updatedAt: now })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: mode, updatedAt: now },
    });
}
