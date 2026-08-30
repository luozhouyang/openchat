import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { admin, bearer, jwt } from "better-auth/plugins";

export const auth = betterAuth({
  baseURL: "http://localhost:8787",
  secret: "better-auth-dev-secret",
  database: drizzleAdapter({} as never, {
    provider: "sqlite",
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
