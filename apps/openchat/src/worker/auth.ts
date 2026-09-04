import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { admin, bearer, jwt } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { userDoName, id } from "protocol";
import { getDb } from "./db/client.ts";
import * as schema from "./db/schema-d1.ts";
import { users } from "./db/schema-d1.ts";
import { auditLog } from "./audit.ts";
import { sendVerificationMail } from "./email.ts";

let currentEnv: Env | null = null;

export function makeAuth(env: Env) {
  currentEnv = env;
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: (env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    database: drizzleAdapter(getDb(env.DB), {
      provider: "sqlite",
      schema,
      usePlural: true,
    }),
    emailAndPassword: { enabled: true },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        void sendVerificationMail(env, user.email, url);
      },
    },
    user: {
      additionalFields: {
        nickname: { type: "string", required: false },
        avatarUrl: { type: "string", required: false },
        username: { type: "string", required: true, unique: true },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            return { data: { ...user, id: id("usr") } };
          },
        },
        update: {
          after: async (user) => {
            const env = currentEnv;
            if (!env) return;
            try {
              const db = getDb(env.DB);
              const rows = await db
                .select({ banned: users.banned })
                .from(users)
                .where(eq(users.id, user.id))
                .limit(1);
              const row = rows[0];
              if (row?.banned) {
                const id = env.USER_DO.idFromName(userDoName(user.id));
                await env.USER_DO.get(id).forceDisconnect();
                auditLog({
                  actor: "system",
                  action: "ban.force-disconnect",
                  target: user.id,
                  status: "ok",
                });
              }
            } catch (err) {
              console.error("ban force-disconnect failed", err);
              auditLog({
                actor: "system",
                action: "ban.force-disconnect",
                target: user.id,
                status: "error",
              });
            }
          },
        },
      },
    },
    plugins: [
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      bearer(),
      jwt({ jwt: { expirationTime: "15m" } }),
    ],
  });
}
