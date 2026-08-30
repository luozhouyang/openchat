import { eq } from "drizzle-orm";
import { getDb } from "../client.ts";
import { uploads } from "../schema-d1.ts";

type Db = ReturnType<typeof getDb>;

export async function createUpload(
  db: Db,
  row: {
    id: string;
    channelId: string;
    userId: string;
    key: string;
    filename: string;
    size: number;
    contentType: string;
  },
) {
  await db.insert(uploads).values({ ...row, status: "pending", createdAt: Date.now() });
  return getUpload(db, row.id);
}

export async function getUpload(db: Db, id: string) {
  return (await db.select().from(uploads).where(eq(uploads.id, id)).limit(1))[0] ?? null;
}

export async function completeUpload(db: Db, id: string) {
  await db
    .update(uploads)
    .set({ status: "complete", completedAt: Date.now() })
    .where(eq(uploads.id, id));
}

export async function markAbandoned(db: Db, id: string) {
  await db.update(uploads).set({ status: "abandoned" }).where(eq(uploads.id, id));
}
