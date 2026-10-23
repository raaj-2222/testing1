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

test('Default domains allow both root VJTI and IT student addresses', () => {
  withDomains(null, () => {
    assert.deepEqual(allowedDomains(), ['vjti.ac.in', 'it.vjti.ac.in']);
    assert.equal(allowedEmail('student@vjti.ac.in'), true);
    assert.equal(allowedEmail('student_b25@it.vjti.ac.in'), true);
  });
});

test('Rejects lookalike domains and malformed addresses', () => {
  withDomains(null, () => {
    for (const address of ['user@gmail.com', 'user@notvjti.ac.in',
      'user@it.vjti.ac.in.evil.com', 'user@other.vjti.ac.in',
      'user@@it.vjti.ac.in', '', null]) assert.equal(allowedEmail(address), false);
  });
});

test('Explicit deployment allowlist overrides defaults, trims, and normalizes', () => {
  withDomains('IT.VJTI.AC.IN, vjti.ac.in ,it.vjti.ac.in', () => {
    assert.deepEqual(allowedDomains(), ['it.vjti.ac.in', 'vjti.ac.in']);
    assert.equal(allowedEmail('user@IT.VJTI.AC.IN'), true);
  });
  withDomains('vjti.ac.in', () => {
    assert.equal(allowedEmail('user@it.vjti.ac.in'), false);
  });
});
