export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  PUSH_Q: Queue;
  USER_DO: DurableObjectNamespace;
  CHANNEL_DO: DurableObjectNamespace;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  INTERNAL_TOKEN_KEY: string;
  MIGRATE_KEY: string;
}
