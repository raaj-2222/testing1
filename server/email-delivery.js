// Mail delivery for verification links. HTTPS (Resend) works in serverless hosts;
// SMTP remains available for local development and traditional Node hosts.
// Provider keys are server-only environment variables: never send them to browsers.

export function emailTransport() {
  if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER &&
      process.env.SMTP_PASS && process.env.MAIL_FROM) return 'smtp';
  return null;
}

export function canDeliverVerificationEmail() {
  // A public Vercel deployment must never print usable verification links to logs.
  return Boolean(emailTransport()) ||
    (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1');
}

export async function deliverVerificationEmail(to, verifyLink) {
  const mode = emailTransport();
  const text = `Open this link within 30 minutes to verify your VJTI email:\n${verifyLink}`;
  if (mode === 'resend') {
    // The Resend REST API uses HTTPS, avoiding unreliable outbound SMTP ports.
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [to],
        subject: 'Verify your CabShare email',
        text
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      // The provider's response might contain private details. Log status only.
      console.error(`Resend verification email request failed (${response.status}).`);
      throw new Error('Email provider rejected the verification message.');
    }
    return;
  }
  if (mode === 'smtp') {
    // Load SMTP only when needed. No extra packages are needed for Resend REST.
    const { default: nodemailer } = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    });
    await transporter.sendMail({
      from: process.env.MAIL_FROM, to, subject: 'Verify your CabShare email', text
    });
    return;
  }
  if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
    console.log(`\n[LOCAL DEVELOPMENT] Email verification link for ${to}:\n${verifyLink}\n`);
    return;
  }
  throw new Error('Email verification provider not configured.');
}
