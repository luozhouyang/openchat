import { appClient } from "@/app-client";

let sessionProbedAt = 0;
let sessionProbedOk = false;

export async function guardSession(): Promise<boolean> {
  if (sessionProbedOk && Date.now() - sessionProbedAt < 60_000) {
    return true;
  }
  const ok = await appClient.auth.hasSession();
  if (ok) {
    sessionProbedAt = Date.now();
    sessionProbedOk = true;
  } else {
    sessionProbedOk = false;
  }
  return ok;
}

export function resetSessionProbe(): void {
  sessionProbedOk = false;
  sessionProbedAt = 0;
}
