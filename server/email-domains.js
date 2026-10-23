// Everyone with a genuine VJTI email may join: students from any branch and faculty.
// Accept @vjti.ac.in and any nested subdomain (for example @it.vjti.ac.in).
// Additional explicitly approved domains can be set with ALLOWED_EMAIL_DOMAINS.
export const DEFAULT_EMAIL_DOMAINS = 'vjti.ac.in';

export function allowedDomains() {
  // Always include the VJTI root so a deployment's old environment setting
  // cannot accidentally exclude other departments or faculty.
  const extras = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',')
    .map(domain => domain.trim().toLowerCase()).filter(Boolean);
  return [...new Set([DEFAULT_EMAIL_DOMAINS, ...extras])];
}

export function allowedEmail(email) {
  if (typeof email !== 'string') return false;
  const match = /^[^\s@]+@([^\s@]+)$/.exec(email);
  if (!match) return false;
  const host = match[1].toLowerCase();
  // Verify every DNS label; this rejects malformed hostnames and tricks such as
  // user@.vjti.ac.in and user@it..vjti.ac.in.
  if (!host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)))
    return false;
  // The preceding '.' is required: attacker-vjti.ac.in is NOT vjti.ac.in.
  // Likewise vjti.ac.in.evil.com never ends with '.vjti.ac.in'.
  return allowedDomains().some(domain => host === domain || host.endsWith(`.${domain}`));
}
