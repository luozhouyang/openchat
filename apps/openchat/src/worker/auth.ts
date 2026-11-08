import { betterAuth } from "better-auth";
// createAuthMiddleware/APIError live in the `better-auth/api` subpath export
// (the root export only surfaces betterAuth + APIError).
import { createAuthMiddleware, APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { admin, bearer, jwt } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { userDoName, id } from "protocol";
import { getDb } from "@worker/db/client";
import * as schema from "@worker/db/schema-d1";
import { users } from "@worker/db/schema-d1";
import { getRegistrationMode } from "@worker/db/repos/settings";
import { auditLog } from "@worker/audit";
import { sendPasswordResetMail, sendVerificationMail } from "@worker/email";

export function makeAuth(env: Env) {
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
    emailAndPassword: {
      enabled: true,
      // The config is rebuilt per request, so the closure over `env` is safe.
      // better-auth looks up the account first and only calls this for known
      // emails; unknown emails still get the generic 200 response.
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetMail(env, user.email, url);
      },
    },
    // Registration gating: better-auth 1.7.x `hooks.before` short-circuits
    // matched endpoints before the handler runs (see better-auth
    // dist/api/dispatch.mjs — a thrown APIError becomes the route response).
    // §5.10: `closed` rejects sign-up outright; `invite` is treated as open at
    // this stage because the email-invite join flow (invites table) already
    // controls team membership, and account-level invite enforcement is a
    // later item.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") {
          return;
        }
        const mode = await getRegistrationMode(getDb(env.DB));
        if (mode === "closed") {
          await auditLog(getDb(env.DB), {
            actor: "system",
            action: "sign-up.rejected",
            target: "registration_closed",
            status: "ok",
          });
          throw new APIError("FORBIDDEN", { message: "registration_closed" });
        }
      }),
    },
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
                await auditLog(getDb(env.DB), {
                  actor: "system",
                  action: "ban.force-disconnect",
                  target: user.id,
                  status: "ok",
                });
              }
            } catch (err) {
              console.error("ban force-disconnect failed", err);
              await auditLog(getDb(env.DB), {
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
