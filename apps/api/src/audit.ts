export function auditLog(entry: {
  actor: string;
  action: string;
  target?: string;
  status: string;
}): void {
  console.info(JSON.stringify({ type: "admin.audit", at: Date.now(), ...entry }));
}
