# Deploy CabShare on Railway

CabShare is **a full-stack Express application**, not a static HTML website. GitHub Pages cannot host its Node.js API, SQLite database or email verification workflow.

> **Account needed:** a Railway account with an active project, plus permission to deploy code. You may need a paid plan or billing details. No deployment can happen solely from the ZIP file without a hosting account.

## 1. Upload the source code to GitHub

Extract `CabShare.zip`, then open a terminal **inside the extracted `CabShare` folder**:

```bash
git init
git add .
git commit -m "Build CabShare student taxi matching app"
git branch -M main
```

Create a new empty `CabShare` repository on GitHub (private is fine), then run:

```bash
git remote add origin https://github.com/YOUR_USERNAME/CabShare.git
git push -u origin main
```

Do **not** upload `.env`, `data/`, SQLite database files, or passwords. They are excluded by `.gitignore`.

## 2. Import it into Railway

1. Open https://railway.com/new and sign in.
2. Select **Deploy from GitHub repo** and choose `CabShare`.
3. Railway finds `railway.toml` and builds the included `Dockerfile`.
4. Under the web service's **Settings / Volumes**, attach a persistent volume with **mount path `/data`**. Without it, registered users and trips are lost when the container is replaced.

## 3. Set production variables

Add these variables under the web service **Variables** tab (do not put credentials in Git):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DB_PATH` | `/data/cabshare.sqlite` |
| `TRUST_PROXY` | `1` |
| `ALLOWED_EMAIL_DOMAINS` | Actual verified VJTI student-email domain(s), comma-separated |
| `BASE_URL` | `https://YOUR-SERVICE.up.railway.app` (replace with the generated domain) |
| `SMTP_HOST` | Your email provider's SMTP host |
| `SMTP_PORT` | Usually `587`, depending on provider |
| `SMTP_SECURE` | `false` for STARTTLS on 587; `true` for implicit TLS on 465 |
| `SMTP_USER` | Your mail-provider account |
| `SMTP_PASS` | SMTP app password or authorized token |
| `MAIL_FROM` | Verified sender address, e.g. `CabShare <noreply@your-domain.com>` |

**Email is required for production signup.** The app intentionally never exposes verification links on public pages and cannot complete signups without a working email provider. Test domain and SMTP sending using real, permitted addresses before inviting classmates.

**Important:** `vjti.ac.in` is a sample allowlist entry, not proof that this is the domain issued for student accounts. Confirm your student email domain with the college first.

## 4. Publish and test

1. In Railway's service Settings → Networking, select **Generate Domain**.
2. Update `BASE_URL` with the **exact HTTPS domain**; Railway redeploys on changes.
3. Open `https://YOUR-SERVICE.up.railway.app/api/health`; it should return `{ "ok": true, "app": "CabShare" }`.
4. Test a real signup → verification email → login → post trip → group join/leave flow.
5. If deployment fails, check the service logs. Typical errors are missing SMTP configuration, incorrect domain, unavailable volume, or Node version.

## Deploy without GitHub (Railway CLI)

After connecting your Railway account and creating a service, you can run `railway up` in the `CabShare` project folder, then `railway domain` to create a public domain. You must still configure variables and a persistent volume through your service.

## Safety / limitations

This is a **classroom MVP**, not an institution-approved or production-audited student network. Before a public campus rollout, add password resets, moderation/reporting, an institution-approved account-verification method, centralized anti-abuse protection, and privacy policies. Never publish classmates' private info or demo account passwords. Users coordinate a taxi; the app **does not book taxis or process payments**.
