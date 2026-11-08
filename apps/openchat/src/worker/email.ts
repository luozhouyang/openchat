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

export async function sendPasswordResetMail(env: Env, to: string, url: string): Promise<void> {
  const from = env.INVITE_FROM_EMAIL ?? "noreply@openchat.local";
  const text = `Reset your openchat password.\n\nClick to choose a new password: ${url}`;
  try {
    if (env.EMAIL) {
      await env.EMAIL.send({ to, from, subject: "Reset your openchat password", text });
    } else {
      console.info("password reset email (dev):", url);
    }
  } catch (err) {
    console.error("password reset email send failed", err);
  }
}

export async function sendVerificationMail(env: Env, to: string, url: string): Promise<void> {
  const from = env.INVITE_FROM_EMAIL ?? "noreply@openchat.local";
  const text = `Verify your email address on openchat.\n\nClick to verify: ${url}`;
  try {
    if (env.EMAIL) {
      await env.EMAIL.send({ to, from, subject: "Verify your email address", text });
    } else {
      console.info("verification email (dev):", url);
    }
  } catch (err) {
    console.error("verification email send failed", err);
  }
}
