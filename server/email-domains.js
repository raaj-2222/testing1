// Accept the main VJTI domain and the IT student-mail subdomain by default.
// Deployment admins can replace this allowlist using ALLOWED_EMAIL_DOMAINS.
export const DEFAULT_EMAIL_DOMAINS = 'vjti.ac.in,it.vjti.ac.in';

export function allowedDomains() {
  return [...new Set((process.env.ALLOWED_EMAIL_DOMAINS ?? DEFAULT_EMAIL_DOMAINS)
    .split(',').map(domain => domain.trim().toLowerCase()).filter(Boolean))];
}

export function allowedEmail(email) {
  // Domain matching is exact: evil-it.vjti.ac.in.example.com is never accepted.
  const match = typeof email === 'string' ? /^[^\s@]+@([^\s@]+)$/.exec(email) : null;
  return Boolean(match && allowedDomains().includes(match[1].toLowerCase()));
}
