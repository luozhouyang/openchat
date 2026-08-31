import { Hono } from "hono";
export const preferencesV1 = new Hono<{ Bindings: Env }>();
// implemented in a later wave
