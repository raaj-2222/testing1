import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, transaction, refreshGroup } from './db.js';
import { allowedEmail, hashPassword, checkPassword, makeSession, clearSession,
  optionalAuth, requireAuth, issueVerification, verifyEmail } from './auth.js';
import { WINDOW_MINUTES, MAX_PASSENGERS, FARE_PAISE, findOpenGroup, splitFare } from './matching.js';
import { allowedDomains } from './email-domains.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DIRS = new Set(['to_vjti', 'to_dadar']);
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
// Vercel (and optionally other configured hosts) terminates HTTPS at a proxy.
// Trust one proxy hop so req.protocol reads X-Forwarded-Proto ('https')
// rather than the internal HTTP connection. This keeps Origin checks enabled.
if (process.env.TRUST_PROXY === '1' || process.env.VERCEL === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
  next();
});
app.use(express.json({ limit: '16kb' }));
app.use((req, _res, next) => {
  // Tiny same-origin cookie parser. Cookies never appear in response JSON.
  req.cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const pos = part.indexOf('=');
    if (pos > 0) {
      try { req.cookies[part.slice(0, pos).trim()] = decodeURIComponent(part.slice(pos + 1).trim()); }
      catch { /* Ignore a malformed cookie. */ }
    }
  }
  next();
});
app.use((req, res, next) => {
  // SameSite=Lax and this Origin check protect cookie-based POST requests.
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('Origin');
    const expected = `${req.protocol}://${req.get('host')}`;
    if ((origin && origin !== expected) || req.get('Sec-Fetch-Site') === 'cross-site')
      return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  next();
});
app.use(optionalAuth);

// Basic in-memory protection. Replace with a distributed limiter if deployed
// across multiple servers. Note: this state resets when the server restarts.
const attempts = new Map();
function rateLimit(req, res, next) {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const record = attempts.get(key) || { count: 0, reset: now + 15 * 60_000 };
  if (now > record.reset) { record.count = 0; record.reset = now + 15 * 60_000; }
  record.count++;
  attempts.set(key, record);
  if (record.count > 25) return res.status(429).json({ error: 'Too many attempts. Please try later.' });
  next();
}

function fail(res, status, message) { return res.status(status).json({ error: message }); }
function nowInMumbai() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata', hour12: false }).slice(0, 16);
}
function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
}
function validTime(time) { return typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time); }
function minutesOf(time) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }
function timeOf(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
function positiveId(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'CabShare' }));
app.get('/api/config', (_req, res) => res.json({ windowMinutes: WINDOW_MINUTES, fare: FARE_PAISE / 100, maxPassengers: MAX_PASSENGERS,
  serverTimeMumbai: nowInMumbai(), allowedDomains: allowedDomains() }));

app.post('/api/auth/signup', rateLimit, async (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password;
  if (name.length < 2 || name.length > 60) return fail(res, 400, 'Name must be 2–60 characters.');
  if (!allowedEmail(email)) return fail(res, 400, 'Please use an allowed VJTI email domain.');
  if (typeof password !== 'string' || password.length < 10 || password.length > 128)
    return fail(res, 400, 'Password must contain 10–128 characters.');
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
    return fail(res, 409, 'Email is already registered. Log in or request verification again.');
  const { salt, hash } = await hashPassword(password);
  const inserted = db.prepare('INSERT INTO users(name,email,password_salt,password_hash) VALUES (?,?,?,?)')
    .run(name, email, salt, hash);
  try {
    await issueVerification(Number(inserted.lastInsertRowid), email);
  } catch (error) {
    console.error('Verification mail error:', error.message);
    return fail(res, 503, 'Account created, but verification email could not be sent. Use Resend verification.');
  }
  return res.status(201).json({ message: 'Account created. Check your college email for a verification link. In local mode, check the server terminal.' });
});

app.post('/api/auth/resend', rateLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || typeof password !== 'string' || !(await checkPassword(password, user)))
    return fail(res, 401, 'Invalid email or password.');
  if (user.verified) return res.json({ message: 'Email is already verified. You can log in.' });
  await issueVerification(user.id, user.email);
  res.json({ message: 'New verification link sent (or printed in the local server terminal).' });
});

app.post('/api/auth/verify', rateLimit, (req, res) => {
  if (!verifyEmail(req.body?.token)) return fail(res, 400, 'Verification link is invalid or expired.');
  res.json({ message: 'College email verified. You can now log in.' });
});

app.post('/api/auth/login', rateLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || typeof req.body?.password !== 'string' || !(await checkPassword(req.body.password, user)))
    return fail(res, 401, 'Invalid email or password.');
  if (!user.verified) return fail(res, 403, 'Verify your college email before logging in.');
  clearSession(req, res);
  makeSession(res, user.id);
  return res.json({ user: { id: user.id, name: user.name, email: user.email } });
});
app.post('/api/auth/logout', requireAuth, (req, res) => {
  clearSession(req, res);
  res.json({ message: 'Logged out.' });
});
app.get('/api/auth/me', (req, res) => res.json({ user: req.user || null }));

// Return group candidates already sorted. SQL keeps departure-time groups
// indexed and limits lookups to the same travel date + direction.
function groupCandidates(date, direction) {
  return db.prepare(`
    SELECT g.id, g.anchor_minutes, g.status, COUNT(t.id) AS member_count,
      COALESCE(MIN(t.time_minutes), g.anchor_minutes) AS min_minutes,
      COALESCE(MAX(t.time_minutes), g.anchor_minutes) AS max_minutes
    FROM ride_groups g LEFT JOIN trips t ON t.group_id=g.id
    WHERE g.trip_date=? AND g.direction=? AND g.status='Open'
    GROUP BY g.id ORDER BY g.anchor_minutes, g.id
  `).all(date, direction);
}

app.post('/api/trips', requireAuth, (req, res) => {
  const { date, time, direction } = req.body || {};
  if (!validDate(date) || !validTime(time) || !DIRS.has(direction))
    return fail(res, 400, 'Enter a valid date, time, and direction.');
  const departure = `${date} ${time}`;
  const today = nowInMumbai().slice(0, 10);
  const maxDate = new Date(`${today}T00:00:00Z`);
  maxDate.setUTCDate(maxDate.getUTCDate() + 60);
  if (departure <= nowInMumbai() || date > maxDate.toISOString().slice(0, 10))
    return fail(res, 400, 'Choose a future Mumbai departure within 60 days.');
  const minutes = minutesOf(time);
  try {
    const trip = transaction(() => {
      const duplicate = db.prepare(`SELECT id FROM trips WHERE user_id=? AND trip_date=?
        AND direction=? AND ABS(time_minutes-?)<30`).get(req.user.id, date, direction, minutes);
      if (duplicate) throw Object.assign(new Error('You already have a trip within 30 minutes of that time.'), { status: 409 });
      const candidates = groupCandidates(date, direction);
      let group = findOpenGroup(candidates, minutes);
      let groupId;
      if (group) groupId = group.id;
      else groupId = Number(db.prepare('INSERT INTO ride_groups(trip_date,direction,anchor_minutes) VALUES (?,?,?)')
        .run(date, direction, minutes).lastInsertRowid);
      const result = db.prepare('INSERT INTO trips(user_id,group_id,trip_date,direction,time_minutes) VALUES (?,?,?,?,?)')
        .run(req.user.id, groupId, date, direction, minutes);
      refreshGroup(groupId);
      return { id: Number(result.lastInsertRowid), groupId };
    });
    res.status(201).json({ trip, message: 'Trip posted and matched to a cab group!' });
  } catch (error) {
    if (error.code?.startsWith('SQLITE_CONSTRAINT')) return fail(res, 409, 'You already posted this trip.');
    if (error.status) return fail(res, error.status, error.message);
    throw error;
  }
});

app.get('/api/dashboard', requireAuth, (req, res) => {
  const date = String(req.query.date || nowInMumbai().slice(0, 10));
  const direction = String(req.query.direction || 'to_vjti');
  if (!validDate(date) || !DIRS.has(direction)) return fail(res, 400, 'Invalid date or direction.');
  const rows = db.prepare(`
    SELECT t.id, t.user_id, t.group_id, t.trip_date, t.direction, t.time_minutes,
      u.name, COALESCE(g.status, 'Unmatched') AS status
    FROM trips t JOIN users u ON u.id=t.user_id
    LEFT JOIN ride_groups g ON g.id=t.group_id
    WHERE t.trip_date=? AND t.direction=? ORDER BY t.time_minutes,t.id
  `).all(date, direction);
  const groupRows = db.prepare(`SELECT * FROM ride_groups WHERE trip_date=? AND direction=? ORDER BY anchor_minutes,id`)
    .all(date, direction);
  const groups = groupRows.map(g => {
    const members = rows.filter(r => r.group_id === g.id).map(r => ({ id: r.id, name: r.name,
      time: timeOf(r.time_minutes), isMe: r.user_id === req.user.id }));
    const fare = splitFare(members.map(m => m.id));
    return { id: g.id, date: g.trip_date, direction: g.direction, time: timeOf(g.anchor_minutes),
      status: g.status, seats: members.length, seatsLeft: MAX_PASSENGERS - members.length,
      approxFare: members.length ? Number((FARE_PAISE / 100 / members.length).toFixed(2)) : 50,
      members: members.map(m => ({ ...m, exactFare: fare.find(f => f.id === m.id).paise / 100 })) };
  });
  const unmatched = rows.filter(r => !r.group_id).map(r => ({ id: r.id, name: r.name,
    time: timeOf(r.time_minutes), isMe: r.user_id === req.user.id }));
  const myTrips = db.prepare(`SELECT t.id,t.group_id,t.trip_date AS date,t.direction,t.time_minutes,
    COALESCE(g.status,'Unmatched') AS status FROM trips t
    LEFT JOIN ride_groups g ON g.id=t.group_id WHERE t.user_id=?
    ORDER BY t.trip_date DESC, t.time_minutes DESC LIMIT 50`).all(req.user.id)
    .map(t => ({ ...t, time: timeOf(t.time_minutes) }));
  res.json({ groups, unmatched, myTrips, stats: {
    students: rows.length,
    openGroups: groups.filter(g => g.status === 'Open').length,
    fullGroups: groups.filter(g => g.status === 'Full').length,
    totalGroups: groups.length }, date, direction, updatedAt: new Date().toISOString() });
});

app.post('/api/groups/:id/join', requireAuth, (req, res) => {
  const groupId = positiveId(req.params.id), tripId = positiveId(req.body?.tripId);
  if (!groupId || !tripId) return fail(res, 400, 'A group ID and your own trip ID are required.');
  try {
    transaction(() => {
      const trip = db.prepare('SELECT * FROM trips WHERE id=? AND user_id=?').get(tripId, req.user.id);
      const group = db.prepare('SELECT * FROM ride_groups WHERE id=?').get(groupId);
      if (!trip || !group) throw Object.assign(new Error('Trip or group not found.'), { status: 404 });
      if (trip.group_id) throw Object.assign(new Error('Leave your current group first.'), { status: 409 });
      if (group.status !== 'Open') throw Object.assign(new Error('This group is not open.'), { status: 409 });
      if (group.trip_date !== trip.trip_date || group.direction !== trip.direction)
        throw Object.assign(new Error('Your trip must have the same date and route.'), { status: 409 });
      const stats = db.prepare(`SELECT COUNT(*) AS n, MIN(time_minutes) AS earliest,
        MAX(time_minutes) AS latest FROM trips WHERE group_id=?`).get(groupId);
      if (stats.n >= 4 || Math.max(trip.time_minutes, stats.latest) - Math.min(trip.time_minutes, stats.earliest) > WINDOW_MINUTES)
        throw Object.assign(new Error('Group is full or outside the 20-minute window.'), { status: 409 });
      db.prepare('UPDATE trips SET group_id=? WHERE id=?').run(groupId, tripId);
      refreshGroup(groupId);
    });
    res.json({ message: 'You joined the group.' });
  } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
});

app.post('/api/trips/:id/leave', requireAuth, (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 400, 'Invalid trip ID.');
  try {
    transaction(() => {
      const trip = db.prepare('SELECT t.*,g.status FROM trips t LEFT JOIN ride_groups g ON g.id=t.group_id WHERE t.id=? AND t.user_id=?')
        .get(id, req.user.id);
      if (!trip) throw Object.assign(new Error('Trip not found.'), { status: 404 });
      if (!trip.group_id) throw Object.assign(new Error('This trip is already unmatched.'), { status: 409 });
      if (trip.status === 'Completed') throw Object.assign(new Error('Completed trips cannot be changed.'), { status: 409 });
      db.prepare('UPDATE trips SET group_id=NULL WHERE id=?').run(id);
      refreshGroup(trip.group_id);
    });
    res.json({ message: 'You left the group. Your trip stays visible so you can join another group.' });
  } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
});

app.delete('/api/trips/:id', requireAuth, (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 400, 'Invalid trip ID.');
  try {
    transaction(() => {
      const trip = db.prepare('SELECT t.*,g.status FROM trips t LEFT JOIN ride_groups g ON g.id=t.group_id WHERE t.id=? AND t.user_id=?')
        .get(id, req.user.id);
      if (!trip) throw Object.assign(new Error('Trip not found.'), { status: 404 });
      if (trip.status === 'Completed') throw Object.assign(new Error('Completed trips cannot be deleted.'), { status: 409 });
      db.prepare('DELETE FROM trips WHERE id=?').run(id);
      if (trip.group_id) refreshGroup(trip.group_id);
    });
    res.json({ message: 'Trip cancelled.' });
  } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
});

app.post('/api/groups/:id/complete', requireAuth, (req, res) => {
  const groupId = positiveId(req.params.id);
  if (!groupId) return fail(res, 400, 'Invalid group ID.');
  try {
    transaction(() => {
      const group = db.prepare('SELECT * FROM ride_groups WHERE id=?').get(groupId);
      const membership = db.prepare('SELECT id FROM trips WHERE group_id=? AND user_id=?').get(groupId, req.user.id);
      if (!group || !membership) throw Object.assign(new Error('You are not in this group.'), { status: 403 });
      if (group.status === 'Completed') throw Object.assign(new Error('Group already completed.'), { status: 409 });
      db.prepare("UPDATE ride_groups SET status='Completed' WHERE id=?").run(groupId);
    });
    res.json({ message: 'Group marked completed.' });
  } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
});

app.use(express.static(publicDir));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return fail(res, 404, 'API route not found.');
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON request.');
  res.status(500).json({ error: 'Unexpected server error. See the server terminal.' });
});

if (process.env.NODE_ENV === 'production' && !process.env.SMTP_HOST)
  console.warn('WARNING: configure SMTP_HOST before accepting signups in production.');

if (process.env.NODE_ENV !== 'test') app.listen(PORT, () => {
  console.log(`\n🚕 CabShare is running: http://localhost:${PORT}`);
  console.log(`Database: ${path.resolve(process.env.DB_PATH || 'data/cabshare.sqlite')}`);
});
export { app };
