import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface R2Env {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
}

export function sanitizeFilename(name: string): string {
  const base = name.split("/").pop() ?? "";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 255);
  return cleaned || "file";
}

function s3(env: R2Env): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export async function presignPut(
  env: R2Env,
  key: string,
  contentType: string,
  expiresSec: number,
): Promise<string> {
  return getSignedUrl(
    s3(env),
    new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key, ContentType: contentType }),
    { expiresIn: expiresSec },
  );
}

export async function presignGet(env: R2Env, key: string, expiresSec: number): Promise<string> {
  return getSignedUrl(s3(env), new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }), {
    expiresIn: expiresSec,
  });
}

export async function headObject(
  files: R2Bucket,
  key: string,
): Promise<{ size: number; contentType: string | null } | null> {
  const obj = await files.head(key);
  if (!obj) {
    return null;
  }
  return { size: obj.size, contentType: obj.httpMetadata?.contentType ?? null };
}
