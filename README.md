# 🚕 CabShare — VJTI Student Taxi Sharing

CabShare helps students coordinate **Dadar Station ↔ VJTI** taxi rides. It is a classroom project, not a taxi-booking service. One taxi is **estimated at ₹50**; four riders can pay about **₹12.50 each**.

## Features

- Signup/login with an **approved college email** and an emailed verification link.
- Passwords hashed with Node.js `scrypt`; expiring, opaque sessions in **HTTP-only cookies**.
- Post a departure date/time and direction (Dadar → VJTI or VJTI → Dadar).
- See groups and unmatched students; the dashboard **polls every 10 seconds**.
- Greedy automatic grouping in **20-minute windows**, maximum **4 passengers**.
- If a group has 4 people, a fifth student starts another group.
- Leave a group without deleting your trip; join another compatible group manually.
- Cancel a trip; group members can mark their ride **Completed**.
- Fare estimates and exact integer-paise allocation, so rounding always adds to ₹50.
- Sorting + greedy algorithm, brute-force comparison, reproducible timing script and tests.
- Responsive interface; no frontend build step.

## Requirements

- **Node.js 22.13+** (Node 24 LTS is recommended) and npm. SQLite is provided by Node's `node:sqlite`, so you do not need a separate SQLite installation. Node 22 may print an experimental SQLite warning, which is expected.
- Internet access for the first `npm install` to download Express, Nodemailer and dotenv.

## Quick start (Windows PowerShell)

```powershell
# Open a terminal inside the unzipped CabShare folder.
cd CabShare
npm install
Copy-Item .env.example .env
npm start
```

Open **http://localhost:3000** in your browser.

### Quick start (Mac / Linux)

```bash
cd CabShare
npm install
cp .env.example .env
npm start
```

### Sign in for the first time

1. Open `http://localhost:3000` and click **Create account**.
2. Enter your name, an address ending in `@vjti.ac.in` (or another configured allowed domain), and a password of at least 10 characters.
3. With the default **development** configuration, the server prints an email verification URL to the **terminal running `npm start`**. Open the link in the browser. SMTP is optional locally.
4. Log in using the same email and password.
5. Click **Post a trip**. Choose a future Mumbai date/time and direction. The app automatically finds a matching group or creates one.
6. To simulate several riders, repeat with different email addresses or seed fictional riders as described below.

**Important:** The project's sample domain is `vjti.ac.in` because it is an institutional domain, **not because the institute's student email domain has been confirmed**. Check actual issued student addresses and update `ALLOWED_EMAIL_DOMAINS` before a real campus launch. Domain matching is exact (not every subdomain is allowed). A correct email suffix by itself is **not** proof of student identity: verification is required.

### Optional sample data for a presentation

```bash
npm run seed
```

This creates fictional student trips dated **tomorrow** for the Dadar → VJTI route. Select tomorrow in the dashboard to view the groups. Seeded accounts have random unknown passwords and are for display only. Never run this on a real production system.

## Useful commands

```bash
npm start             # Start the Express server
npm run dev           # Auto-restart backend when you edit files
npm test              # Run algorithm unit tests
npm run benchmark     # Re-measure brute force versus optimized matching
npm run seed          # Add fictional students for tomorrow
```

`npm run benchmark` also replaces `docs/BENCHMARK_RESULTS.md` with timings on your computer.

## Folder structure

```text
CabShare/
├── public/
│   ├── index.html          # All page markup, forms, dashboard and dialogs
│   ├── styles.css          # Responsive design
│   └── app.js              # Fetch API, frontend state, UI updates
├── server/
│   ├── app.js              # Express routes and request validation
│   ├── auth.js             # scrypt, hashed verification/session tokens
│   ├── db.js               # SQLite tables, transactions, group-status sync
│   └── matching.js         # Optimized and brute-force algorithms, fares
├── scripts/
│   ├── benchmark.js        # Reproducible timing comparison
│   └── seed-demo.js        # Optional fictional rider data
├── tests/
│   ├── matching.test.js    # Matching algorithm unit tests
│   └── database.test.js    # SQLite and group-status smoke tests
├── docs/
│   ├── ALGORITHMS.md       # DAA explanation, pseudocode, complexities
│   ├── AUTHENTICATION.md   # Authentication components + request flow
│   └── BENCHMARK_RESULTS.md
├── Dockerfile              # Production container for Node.js + Express
├── railway.toml            # Hosting health-check/build settings
├── docs/DEPLOYMENT.md      # Step-by-step public hosting instructions
├── .env.example            # Example settings (no secrets)
├── .gitignore
└── package.json
```

`data/cabshare.sqlite` is created automatically on the first server start and ignored by Git.

## How matching behaves

The app groups only students going in the **same direction on the same date**. All riders within a group must fall within a **20-minute overall departure span**. The first four compatible students share a group; a fifth starts a new one. During live posting, the backend finds the closest compatible open cab using **binary search + a bounded candidate-window scan**. This preserves existing memberships when someone posts, joins, or leaves. The batch greedy algorithm is used in the DAA benchmark and optional demo seeding.

Each rider may join only with **their own, already-posted, unmatched trip**. Leaving a group keeps that trip listed as unmatched so it can join another open group. Deleting a trip removes it altogether. A full group becomes open again when someone leaves. A completed ride is archived as Completed.

## Fare splitting

| Passengers | Approximate share | Exact handling |
|---:|---:|---|
| 1 | ₹50.00 | ₹50.00 |
| 2 | ₹25.00 | ₹25.00 each |
| 3 | ₹16.67 | Two pay ₹16.67, one ₹16.66 |
| 4 | ₹12.50 | ₹12.50 each |

Money is stored/calculated in **paise** (₹50 = 5000 paise), not binary floating-point fractions. This ensures shares add up correctly. The ₹50 figure is a **user-supplied estimate**, not a live taxi fare. There is no payment processing.

## API overview

| Method | Endpoint | Use |
|---|---|---|
| GET | `/api/config` | Non-sensitive app settings, current Mumbai time |
| POST | `/api/auth/signup` | Create pending student account |
| POST | `/api/auth/verify` | Redeem emailed verification token |
| POST | `/api/auth/resend` | Request a new verification link |
| POST | `/api/auth/login` | Authenticate and issue session cookie |
| GET | `/api/auth/me` | Get current account (or `null`) |
| POST | `/api/auth/logout` | Revoke current session |
| GET | `/api/dashboard?date=YYYY-MM-DD&direction=to_vjti` | Get groups, unmatched riders and your trips |
| POST | `/api/trips` | Create trip and auto-assign a group |
| POST | `/api/groups/:id/join` | Join with `{"tripId":123}` |
| POST | `/api/trips/:id/leave` | Leave group, keep posted trip |
| DELETE | `/api/trips/:id` | Cancel trip |
| POST | `/api/groups/:id/complete` | Mark member's group as completed |

All dashboard and trip endpoints require a verified, logged-in account. Responses don't disclose other users' email addresses or credentials.

## Authentication details

Read **[docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)** for components, the signup/login request sequence, password hashing, email-verification token generation, session cookie handling, login guards and the threat model.

## Algorithms details

Read **[docs/ALGORITHMS.md](docs/ALGORITHMS.md)** and **[docs/BENCHMARK_RESULTS.md](docs/BENCHMARK_RESULTS.md)** for time/space complexities, pseudocode, measured performance and limitations.

## Hosting it online

**The deployment-ready files are included:** `Dockerfile`, `railway.toml`, and a configurable database path `DB_PATH` for persistent SQLite storage. Follow **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for a step-by-step Railway deployment. Actual hosting requires a linked hosting account, the real student email domain, and SMTP credentials; generating the code does not itself publish a website.

## Local development vs real deployment

- **Never use development mode on the public internet.** Without SMTP, the verification link appears in the terminal. For public use set `NODE_ENV=production`, configure `BASE_URL=https://...`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`, and serve via HTTPS.
- This is an educational MVP. Before real student adoption, add institution-approved student-email verification (or college SSO), proper audit logs, a shared rate limiter, password reset, admin abuse controls, spam reporting, privacy policy and data retention rules.
- Treat a group as a **coordination suggestion**. It does not reserve a taxi, guarantee availability, verify anyone's actual location or collect payment. Meet in a public area, protect each other's privacy and agree on the real meter fare.
- SQLite + Node's synchronous API is convenient for a small local project, not a high-traffic distributed production backend.

## Troubleshooting

- **`npm` not recognized:** install the current Node.js LTS release and reopen the terminal.
- **Port 3000 busy:** change `PORT=3001` in `.env`; also set `BASE_URL=http://localhost:3001` for verification links.
- **Invalid college email:** set `ALLOWED_EMAIL_DOMAINS` to the actual issued student email domain(s), separated by commas; restart.
- **No verification email:** in development check the terminal where `npm start` is running; in production configure valid SMTP credentials.
- **Already registered but not verified:** enter email/password and click **Need a new verification link?**
- **No riders visible:** you need to log in and select a date and direction with posted trips. Run `npm run seed` to populate tomorrow's Dadar → VJTI demo.
- **No compatible cab:** the other group's trip dates, directions and member departure times must fit within 20 minutes total.

Made for student learning. Not officially affiliated with VJTI.
