import { eq } from "drizzle-orm";
import { getDb } from "../client.ts";
import { uploadsessions, fileinfo } from "../schema-d1.ts";

type Db = ReturnType<typeof getDb>;

export async function createUploadSession(
  db: Db,
  row: {
    id: string;
    type: string | null;
    userId: string | null;
    channelId: string | null;
    filename: string | null;
    path: string | null;
    fileSize: number | null;
  },
) {
  await db.insert(uploadsessions).values({ ...row, createdAt: Date.now() });
  return getUploadSession(db, row.id);
}

export async function getUploadSession(db: Db, id: string) {
  return (
    (await db.select().from(uploadsessions).where(eq(uploadsessions.id, id)).limit(1))[0] ?? null
  );
}

export async function completeUploadSession(
  db: Db,
  id: string,
  { fileOffset }: { fileOffset: number },
) {
  await db.update(uploadsessions).set({ fileOffset }).where(eq(uploadsessions.id, id));
}

export async function createFileInfo(
  db: Db,
  row: {
    id: string;
    creatorId: string | null;
    postId: string | null;
    path: string | null;
    name: string | null;
    extension: string | null;
    size: number | null;
    mimeType: string | null;
    createdAt: number;
  },
) {
  await db.insert(fileinfo).values({ ...row, updatedAt: row.createdAt });
  return getFileInfo(db, row.id);
}

export async function getFileInfo(db: Db, id: string) {
  return (await db.select().from(fileinfo).where(eq(fileinfo.id, id)).limit(1))[0] ?? null;
}

export async function linkFileToPost(
  db: Db,
  { fileId, postId }: { fileId: string; postId: string },
) {
  await db.update(fileinfo).set({ postId, updatedAt: Date.now() }).where(eq(fileinfo.id, fileId));
}

export async function setThumbnail(
  db: Db,
  {
    fileId,
    thumbnailPath,
    previewPath,
  }: { fileId: string; thumbnailPath: string | null; previewPath: string | null },
) {
  await db
    .update(fileinfo)
    .set({ thumbnailPath, previewPath, updatedAt: Date.now() })
    .where(eq(fileinfo.id, fileId));
}
