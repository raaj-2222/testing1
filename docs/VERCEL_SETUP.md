# CabShare on Vercel: email verification and persistent data

CabShare's HTML interface can appear to work on Vercel even when signup or later group operations fail. A live student-facing application needs **both** a server-side email delivery service and a **persistent shared database**.

## Error: "Account saved, but the verification email could not be delivered"

The backend saves an unverified account before trying to send the message. No verification link can be delivered unless a mail provider is configured. When email sending fails, the user should use **Need a new verification link?** after the administrator fixes delivery; do not repeatedly create accounts.

## Email delivery: Resend over HTTPS (recommended for Vercel)

1. Create an account at https://resend.com and add a domain **that you own/control**. Follow the instructions to verify its DNS records. You do not need to own the VJTI domain to send verification messages **to** a VJTI email address; the **sender** must be from your own verified domain.
2. Generate a Resend API key with permission to send emails.
3. In Vercel → your CabShare project → Settings → Environment Variables, set:

   - `RESEND_API_KEY` — the actual API key (keep secret)
   - `MAIL_FROM` — for example `CabShare <verify@your-verified-domain.com>`
   - `BASE_URL` — `https://testing1-kappa-two.vercel.app` or your exact public production URL
   - `NODE_ENV` — `production`

4. Redeploy to apply new environment variables.
5. Try **Need a new verification link?** with the same email and password. Check the inbox and spam folder.
6. If sending fails, inspect the Vercel server function logs for the Resend HTTP status code. Verify the sending domain and sender address inside Resend. Resend's test sender `onboarding@resend.dev` is not a substitute for a verified sender to arbitrary student email addresses.

The app also supports SMTP for traditional Node hosting with `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`, but HTTPS email APIs are generally more suitable for serverless Vercel Functions. **Never put email API keys in GitHub, frontend JavaScript, or screenshots.**

## Critical: Vercel's filesystem is not a durable SQLite database

CabShare currently stores users, verification tokens, sessions, and ride groups in `data/cabshare.sqlite`. This is fine on a single persistent server, but **not as durable state on Vercel Functions**. Vercel says local SQLite is not supported for persistent shared writes across serverless instances. Using `/tmp` would only make it temporarily writable and would *not* fix persistence.

Before inviting real students, select one of these deployment paths:

- **Smallest change:** deploy the entire Express app on a Node hosting service that provides a persistent filesystem volume (such as Railway). Mount the volume at `/data`, set `DB_PATH=/data/cabshare.sqlite`, and configure email delivery. Use the generated public Railway URL instead of the Vercel frontend.
- **Keep Vercel:** migrate the backend to a hosted, transactional database such as PostgreSQL (Neon or Supabase), including the `users`, `verification_tokens`, `sessions`, `ride_groups`, and `trips` tables and transactional 4-seat enforcement. This is a **code migration**, not a single environment variable change. Do not point the existing `node:sqlite` module at a PostgreSQL connection string.

Until persistent storage is implemented, even successful local Vercel signup tests should not be considered production-ready.

## Privacy

Use only verified VJTI email inboxes. Keep verification links out of API responses and browser console logs, maintain HTTPS and `HttpOnly` cookies, and never disable email verification to work around missing mail settings.
