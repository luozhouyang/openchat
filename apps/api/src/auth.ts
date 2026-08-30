import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { admin, bearer, jwt } from "better-auth/plugins";
import { getDb } from "./db/client.ts";
import * as schema from "./db/schema-d1.ts";

export function makeAuth(env: Env) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(env.DB), {
      provider: "sqlite",
      schema,
      usePlural: true,
    }),
    emailAndPassword: { enabled: true },
    user: {
      additionalFields: {
        nickname: { type: "string", required: false },
        avatarUrl: { type: "string", required: false },
      },
    },
    session: {
      cookieCache: { enabled: true, strategy: "jwt" },
    },
    plugins: [
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      bearer(),
      jwt({ jwt: { expirationTime: "15m" } }),
    ],
  });
}
