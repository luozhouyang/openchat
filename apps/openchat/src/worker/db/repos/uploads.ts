import { eq } from "drizzle-orm";
import type { UploadSession, UploadSessionInsert, FileInfo, FileInfoInsert, Db } from "../types.ts";
import { uploadsessions, fileinfo } from "../schema-d1.ts";

export async function createUploadSession(
  db: Db,
  row: UploadSessionInsert,
): Promise<UploadSession | null> {
  await db.insert(uploadsessions).values({ ...row, createdAt: row.createdAt ?? Date.now() });
  return getUploadSession(db, row.id);
}

export async function getUploadSession(db: Db, id: string): Promise<UploadSession | null> {
  const rows = await db.select().from(uploadsessions).where(eq(uploadsessions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function completeUploadSession(db: Db, input: { id: string; fileOffset: number }) {
  await db
    .update(uploadsessions)
    .set({ fileOffset: input.fileOffset })
    .where(eq(uploadsessions.id, input.id));
}

export async function createFileInfo(db: Db, row: FileInfoInsert): Promise<FileInfo | null> {
  await db.insert(fileinfo).values({ ...row, updatedAt: row.createdAt });
  return getFileInfo(db, row.id);
}

export async function getFileInfo(db: Db, id: string): Promise<FileInfo | null> {
  const rows = await db.select().from(fileinfo).where(eq(fileinfo.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function linkFileToPost(db: Db, input: { fileId: string; postId: string }) {
  await db
    .update(fileinfo)
    .set({ postId: input.postId, updatedAt: Date.now() })
    .where(eq(fileinfo.id, input.fileId));
}

export async function setThumbnail(
  db: Db,
  input: { fileId: string; thumbnailPath: string | null; previewPath: string | null },
) {
  await db
    .update(fileinfo)
    .set({
      thumbnailPath: input.thumbnailPath,
      previewPath: input.previewPath,
      updatedAt: Date.now(),
    })
    .where(eq(fileinfo.id, input.fileId));
}
