# CabShare — authentication code and request-flow guide

This guide explains the **new CabShare project in this archive**. No pre-existing authentication repository was provided to compare against.

## Components

| File / component | Role |
|---|---|
| `public/index.html` | Signup/login form fields and buttons |
| `public/app.js` | Calls JSON API via `fetch` with `credentials: 'same-origin'`; displays errors; reads `?verify=...` link, removes it from URL history and redeems it |
| `server/app.js` | Express routes, input validation, rate limiting, same-origin checks and per-request login guard |
| `server/auth.js` | College-domain allowlist, `scrypt` password hashing, verification tokens, session cookies and auth middleware |
| `server/db.js` | SQLite tables: `users`, `verification_tokens`, `sessions`, `ride_groups`, `trips` |
| `.env` | Non-committed mail server settings, base URL, allowed email domain(s), environment flag |

## Sequence: signing up / verifying

```text
Browser Signup Form          Express             SQLite             Email / local terminal
       |                       |                     |                         |
       | POST /auth/signup     |                     |                         |
       |---------------------->| validate name,     |                         |
       |                       | email, password     |                         |
       |                       | scrypt + salt       |                         |
       |                       | INSERT users       ->                         |
       |                       | random 32-byte      |                         |
       |                       | verification token  |                         |
       |                       | store SHA-256(token)-> verification_tokens     |
       |                       | send / print one-time link ------------------->|
       |<----- generic success |                     |                         |
       |                       |                     |                         |
       | Visit link ?verify=token                     |                         |
       | POST /auth/verify --->| SHA-256(token), lookup unexpired hash          |
       |                       | set users.verified=1, consume token -->        |
       |<----- verified        |                     |                         |
```

Code landmarks:

- `server/auth.js` — `allowedEmail(email)` re-exports the suffix-safe check in `server/email-domains.js`; the app accepts the root `vjti.ac.in` and any of its subdomains for students across departments and faculty. `ALLOWED_EMAIL_DOMAINS` can add explicitly approved additional roots; it does not remove VJTI. Lookalikes and malformed domains are rejected.
- `server/auth.js` — `hashPassword(password)` produces a **random 16-byte salt** and a **64-byte scrypt hash**. Neither plaintext password nor password-equivalent data is returned to the browser.
- `server/auth.js` — `issueVerification(userId,email)` creates a random 32-byte (64-hex-character) token. Only its **SHA-256 hash** is stored in SQLite. Token expires after **30 minutes**, and requesting a fresh link revokes previous links for that user.
- `server/auth.js` — `verifyEmail(raw)` hashes the supplied token, requires that it hasn't expired, marks the account verified, and deletes the verification record in one transaction.
- In local development only, the verification URL is printed in the server's terminal. With SMTP configured, Nodemailer emails it. It is **never** included in the API response.

## Sequence: login / authenticated trip request

```text
Browser                     Express / Auth middleware                  SQLite
   | POST /api/auth/login       |                                         |
   | email + password --------->| lookup user by email ----------------->|
   |                            | scrypt(input password, user's salt)    |
   |                            | constant-time hash comparison          |
   |                            | check verified=1                       |
   |                            | generate random 32-byte session token  |
   |                            | store SHA-256(token), expiry --------->|
   |<---------------------------| Set-Cookie: cabshare_session=...       |
   |                            |                                         |
   | GET /api/dashboard         |                                         |
   | Cookie sent automatically ->| SHA-256(cookie value), look up hash -->|
   |                            | require verified, unexpired session    |
   |                            | req.user = { id, name, email }         |
   |                            | requireAuth => reject with 401 if null |
   |<-------- groups + trips ---| only public student names, no emails   |
   |                            |                                         |
   | POST /api/auth/logout ---->| delete matching session hash --------->|
   |<------ clear cookie -------|                                         |
```

Details:

- Password hash: **scrypt** with per-user random salt (`server/auth.js`). Password checks use `crypto.timingSafeEqual` to avoid leaking comparison progress.
- Session token: **32 cryptographically random bytes**, encoded as hex. Database stores `SHA-256(token)`, not the raw bearer token. Expires after **7 days**.
- Cookie: `cabshare_session`; flags: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=7 days`, and `Secure` if `NODE_ENV=production`. The browser automatically sends it on same-origin requests. **JavaScript never needs to read the token**; it is not put in localStorage, sessionStorage, or the URL.
- `optionalAuth` reads the cookie, retrieves a valid unexpired session and attaches `req.user` (id/name/email). `requireAuth` rejects unauthorized requests.
- Logging out deletes the stored hashed session and clears the browser cookie. Sessions revoked here can't be used again.
- Frontend signup/login calls go to **same-origin** `/api/auth/...`, and the server never includes password hashes, raw sessions or verification token hashes in JSON responses.

## Safety controls and limitations

- JSON bodies limited to 16 KiB; prepared SQL statements prevent straightforward SQL injection.
- Every mutation validates `Origin` when present and rejects `Sec-Fetch-Site: cross-site`. Together with `SameSite=Lax`, this protects against common cross-site request forgery in modern browsers. Public HTTPS and comprehensive CSRF testing are still necessary before a campus launch.
- A basic 25-requests-per-IP-per-endpoint/15-minute rate limiter covers authentication. It is **in-memory** and resets on server restart; production needs a persistent, shared limiter and more targeted abuse controls.
- Other students can see **names and times**, not private college email addresses. Only the trip owner may cancel or leave their own trip, and only group members may complete their ride.
- An allowed VJTI email suffix **is not verification**; a user must prove inbox access with a 30-minute link. VJTI's real student-issued domain should be validated before campus deployment.
- `NODE_ENV=production` without SMTP makes verification email dispatch fail; do not deploy until SMTP and HTTPS are set up.
- There is no password-reset, two-factor authentication, college SSO, account suspension, or full production audit log in this classroom MVP.

## What happens to credentials?

**College email:** stored in `users.email`, kept private from other students.

**Password:** sent once via POST during signup/login over the connection. Stored only as `scrypt(password, salt)` plus random salt, never as readable plaintext. For real deployment, HTTPS is mandatory to protect transit.

**Verification token:** issued for email proof, raw value appears only in delivered/locally printed link; SHA-256 token hash is stored for up to 30 minutes. Link is consumed and removed from the browser's address bar immediately.

**Session token:** sent only as an HTTP-only cookie. Raw value remains in the browser cookie store; its hash is stored in `sessions`. Rotated on login; revoked on logout; expires after 7 days.

**SMTP password:** read from `.env` at runtime; `.env` is git-ignored and must not be committed. In production, use environment or secret-management injection. SMTP credentials are never sent to the browser.
