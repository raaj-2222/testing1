// Run with `node --test tests/email-domains.test.js` (no npm packages needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedDomains, allowedEmail } from '../server/email-domains.js';

function withDomains(value, fn) {
  const prior = process.env.ALLOWED_EMAIL_DOMAINS;
  if (value === null) delete process.env.ALLOWED_EMAIL_DOMAINS;
  else process.env.ALLOWED_EMAIL_DOMAINS = value;
  try { fn(); } finally {
    if (prior === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
    else process.env.ALLOWED_EMAIL_DOMAINS = prior;
  }
}

test('Allows VJTI root domain, every branch, and faculty addresses', () => {
  withDomains(null, () => {
    assert.deepEqual(allowedDomains(), ['vjti.ac.in']);
    for (const address of [
      'student@vjti.ac.in', 'student_b25@it.vjti.ac.in',
      'student@mech.vjti.ac.in', 'student@civil.vjti.ac.in',
      'student@extc.vjti.ac.in', 'professor@vjti.ac.in',
      'professor@dept.vjti.ac.in', 'person@lab.dept.vjti.ac.in',
      'PERSON@IT.VJTI.AC.IN'
    ]) assert.equal(allowedEmail(address), true, address);
  });
});

test('Rejects impersonation/lookalike addresses and malformed domains', () => {
  withDomains(null, () => {
    for (const address of [
      'user@gmail.com', 'user@notvjti.ac.in', 'user@fake-vjti.ac.in',
      'user@it.vjti.ac.in.evil.com', 'user@vjti.ac.in.evil.net',
      'user@.vjti.ac.in', 'user@it..vjti.ac.in', 'user@-it.vjti.ac.in',
      'user@it-.vjti.ac.in', 'user@@it.vjti.ac.in', '', null
    ]) assert.equal(allowedEmail(address), false, String(address));
  });
});

test('Older Vercel domain settings still allow other VJTI branches', () => {
  withDomains('IT.VJTI.AC.IN, it.vjti.ac.in', () => {
    assert.deepEqual(allowedDomains(), ['vjti.ac.in', 'it.vjti.ac.in']);
    assert.equal(allowedEmail('student@civil.vjti.ac.in'), true);
    assert.equal(allowedEmail('faculty@vjti.ac.in'), true);
  });
});

test('Explicit additional institutional domains are supported', () => {
  withDomains('other-college.example', () => {
    assert.equal(allowedEmail('user@other-college.example'), true);
    assert.equal(allowedEmail('user@faculty.other-college.example'), true);
    assert.equal(allowedEmail('user@it.vjti.ac.in'), true);
  });
});
