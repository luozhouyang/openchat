import { Hono } from "hono";
export const statusV1 = new Hono<{ Bindings: Env }>();
// implemented in a later wave
