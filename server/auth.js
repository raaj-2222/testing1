import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { deliverVerificationEmail } from './email-delivery.js';
import { db } from './db.js';
export { allowedEmail } from './email-domains.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('hex');

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString('hex') };
}

export async function checkPassword(password, user) {
  const actual = await scrypt(password, user.password_salt, 64);
  const expected = Buffer.from(user.password_hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function makeSession(res, userId) {
  const raw = token();
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(digest(raw), userId, Date.now() + SESSION_MS);
  res.cookie('cabshare_session', raw, { httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/', maxAge: SESSION_MS });
}

export function clearSession(req, res) {
  const raw = req.cookies?.cabshare_session;
  if (raw) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(raw));
  res.clearCookie('cabshare_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/' });
}

export function optionalAuth(req, _res, next) {
  const raw = req.cookies?.cabshare_session;
  const session = raw ? db.prepare(`
    SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.verified=1`
  ).get(digest(raw), Date.now()) : null;
  req.user = session || null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

export async function issueVerification(userId, email) {
  const raw = token();
  db.prepare('DELETE FROM verification_tokens WHERE user_id=?').run(userId);
  db.prepare('INSERT INTO verification_tokens VALUES (?,?,?)')
    .run(digest(raw), userId, Date.now() + 30 * 60_000);
  const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const url = `${base}/?verify=${encodeURIComponent(raw)}`;
  // The raw link is delivered only by mail (or locally in the terminal).
  await deliverVerificationEmail(email, url);
  // Never send the raw verification token in an API response.
}

export function verifyEmail(raw) {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) return false;
  const row = db.prepare('SELECT * FROM verification_tokens WHERE token_hash=? AND expires_at>?')
    .get(digest(raw), Date.now());
  if (!row) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET verified=1 WHERE id=?').run(row.user_id);
    db.prepare('DELETE FROM verification_tokens WHERE user_id=?').run(row.user_id);
    db.exec('COMMIT');
    return true;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
