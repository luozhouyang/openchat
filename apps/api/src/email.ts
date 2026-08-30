export async function sendInviteEmail(
  env: Env,
  to: string,
  inviteUrl: string,
  teamName: string,
): Promise<void> {
  const from = env.INVITE_FROM_EMAIL ?? "noreply@openchat.local";
  const text = `You've been invited to join ${teamName} on openchat.\n\nClick to accept: ${inviteUrl}`;
  try {
    if (env.EMAIL) {
      await env.EMAIL.send({ to, from, subject: `Invitation to join ${teamName}`, text });
    } else {
      console.info("invite email (dev):", inviteUrl);
    }
  } catch (err) {
    console.error("invite email send failed", err);
  }
}
