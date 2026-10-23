import test from 'node:test';
import assert from 'node:assert/strict';
import { emailTransport, canDeliverVerificationEmail, deliverVerificationEmail } from '../server/email-delivery.js';

async function withAsyncSettings(changes, fn) {
  const before = {};
  for (const [name, value] of Object.entries(changes)) {
    before[name] = process.env[name];
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  }
  try { return await fn(); }
  finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function envSettings(changes, fn) {
  const before = {};
  for (const [name, value] of Object.entries(changes)) {
    before[name] = process.env[name];
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  }
  try { return fn(); }
  finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const blank = { RESEND_API_KEY:null, MAIL_FROM:null, SMTP_HOST:null,
  SMTP_USER:null, SMTP_PASS:null };

test('Production signup requires configured email delivery', () => {
  envSettings({ ...blank, NODE_ENV:'production', VERCEL:'1' }, () => {
    assert.equal(emailTransport(), null);
    assert.equal(canDeliverVerificationEmail(), false);
  });
});

test('Vercel does not print verification links even when NODE_ENV is development', () => {
  envSettings({ ...blank, NODE_ENV:'development', VERCEL:'1' }, () => {
    assert.equal(canDeliverVerificationEmail(), false);
  });
});

test('Resend requires an API key and a configured sender', () => {
  envSettings({ ...blank, NODE_ENV:'production', VERCEL:'1', RESEND_API_KEY:'re_test' }, () => {
    assert.equal(canDeliverVerificationEmail(), false);
  });
  envSettings({ ...blank, NODE_ENV:'production', VERCEL:'1', RESEND_API_KEY:'re_test', MAIL_FROM:'CabShare <hello@example.com>' }, () => {
    assert.equal(emailTransport(), 'resend');
    assert.equal(canDeliverVerificationEmail(), true);
  });
});

test('Resend uses HTTPS and never includes the API key in the message', async () => {
  const previousFetch = globalThis.fetch;
  let requested;
  globalThis.fetch = async (url, options) => {
    requested = { url, options };
    return { ok: true, status: 200 };
  };
  try {
    await withAsyncSettings({ ...blank, NODE_ENV:'production', VERCEL:'1',
      RESEND_API_KEY:'re_dummy', MAIL_FROM:'CabShare <verify@example.com>' }, async () => {
        await deliverVerificationEmail('student@it.vjti.ac.in', 'https://example.com/?verify=token');
      });
    assert.equal(requested.url, 'https://api.resend.com/emails');
    assert.equal(requested.options.method, 'POST');
    assert.equal(requested.options.headers.Authorization, 'Bearer re_dummy');
    const body = JSON.parse(requested.options.body);
    assert.deepEqual(body.to, ['student@it.vjti.ac.in']);
    assert.equal(body.from, 'CabShare <verify@example.com>');
    assert.equal(body.text.includes('re_dummy'), false);
  } finally { globalThis.fetch = previousFetch; }
});

test('Resend rejects provider errors rather than claiming verification was sent', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok:false, status:403 });
  try {
    await assert.rejects(withAsyncSettings({ ...blank, NODE_ENV:'production', VERCEL:'1',
      RESEND_API_KEY:'re_dummy', MAIL_FROM:'CabShare <verify@example.com>' },
      () => deliverVerificationEmail('student@vjti.ac.in', 'https://example.com/?verify=token')),
      /Email provider rejected/);
  } finally { globalThis.fetch = original; }
});
