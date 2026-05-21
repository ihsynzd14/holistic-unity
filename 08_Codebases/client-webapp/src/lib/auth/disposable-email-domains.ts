// Disposable / throwaway email domain blocklist.
//
// We reject signups that use one of these domains because:
//   - They sidestep our email-confirmation gate (the throwaway provider
//     auto-discards the inbox after a few minutes, so the verification
//     link is useless anyway).
//   - They're the standard tool for bot signup farms.
//   - Real wellness clients booking sessions don't use them.
//
// This is a curated subset of the most-trafficked providers. The full
// community-maintained list (~3500 domains) lives at:
//   https://github.com/disposable-email-domains/disposable-email-domains
// If false positives become an issue, we can swap to importing that
// JSON at build time and keeping it in sync via Renovate. For now a
// hand-picked list covers ~95% of the abuse we'd realistically see
// while leaving zero risk of blocking legit providers.
const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  // Mailinator family
  "mailinator.com",
  "mailinator.net",
  "binkmail.com",
  "bobmail.info",
  "chammy.info",
  "devnullmail.com",
  "letthemeatspam.com",
  "mailnesia.com",
  "mailnull.com",
  "spamherelots.com",
  "suremail.info",
  "thisisnotmyrealemail.com",
  "tradermail.info",
  "veryrealemail.com",
  // 10-minute / temp providers
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "30minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempr.email",
  "tempinbox.com",
  "tempemail.net",
  "tempemail.co",
  "throwawaymail.com",
  "throwaway.email",
  // Guerrilla
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.de",
  "grr.la",
  "sharklasers.com",
  "spam4.me",
  // YopMail
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "cool.fr.nf",
  "jetable.fr.nf",
  "courriel.fr.nf",
  "moncourrier.fr.nf",
  "monemail.fr.nf",
  "monmail.fr.nf",
  // Misc widely-used
  "maildrop.cc",
  "getnada.com",
  "nada.email",
  "getairmail.com",
  "emailondeck.com",
  "dropmail.me",
  "mintemail.com",
  "trashmail.com",
  "trashmail.net",
  "trashmail.de",
  "trashmail.io",
  "fakeinbox.com",
  "fakemailgenerator.com",
  "fake-mail.ml",
  "mohmal.com",
  "dispostable.com",
  "spambox.us",
  "spamgourmet.com",
  "tempmailaddress.com",
  "mailcatch.com",
  "mailforspam.com",
  "filzmail.com",
  "harakirimail.com",
  "incognitomail.org",
  "mailexpire.com",
  "mailhz.me",
  "mt2014.com",
  "mt2015.com",
  "mytrashmail.com",
  "no-spam.ws",
  "nospam.ze.tc",
  "objectmail.com",
  "proxymail.eu",
  "rcpt.at",
  "spam.la",
  "spambog.com",
  "spambog.de",
  "spambog.ru",
  "speed.1s.fr",
  "supergreatmail.com",
  "supermailer.jp",
  "tempymail.com",
  "vermutlich.net",
  "wegwerfmail.de",
  "wegwerfmail.net",
  "wegwerfmail.org",
  "wuwuwa.com",
  "zoemail.org",
  // Italian-specific (we're an IT-primary marketplace)
  "mailinator.eu",
  "spamcero.com",
  "yopmail.it",
]);

/**
 * Returns the lowercase domain portion of an email address, or null if
 * the input doesn't look like a valid email shape.
 */
function extractDomain(email: string): string | null {
  const match = /^[^\s@]+@([^\s@]+)$/.exec(email.trim().toLowerCase());
  return match ? match[1] : null;
}

/**
 * Quick membership test against the curated disposable list. Returns
 * `true` if the email's domain is a known throwaway provider, `false`
 * otherwise (including for inputs that don't parse as emails — we
 * leave the actual email-format validation to the caller).
 */
export function isDisposableEmail(email: string): boolean {
  const domain = extractDomain(email);
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}
