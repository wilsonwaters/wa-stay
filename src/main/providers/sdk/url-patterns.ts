/**
 * URL allow-lists for provider windows and pasted sign-in links (architecture-notes §7,
 * §12.32). Pure functions: no Electron, no network.
 *
 * **Origin patterns** say which top-level pages a provider window may show:
 * - `https://host` or `https://host:port`: exactly that origin;
 * - `https://*.domain`: any subdomain of `domain`, at any depth, but never `domain` itself
 *   (`https://*.dbca.wa.gov.au` matches `parkstay.dbca.wa.gov.au` and `a.b.dbca.wa.gov.au`,
 *   not `dbca.wa.gov.au` or `evildbca.wa.gov.au`), on the default port;
 * - `http://` only for an exact loopback origin (`127.0.0.1`, `localhost`, `[::1]`), which
 *   only live tests use. The registry accepts https patterns only, so a provider's own lists
 *   never hold one.
 *
 * A URL matches only when it is http(s), carries no user name or password, and its origin
 * fits a pattern. Paths and queries never matter.
 *
 * **URL patterns** (`completionUrlPatterns`) are whole URLs where `*` stands for any text,
 * including none, anchored at both ends: `https://site.example/done/*` matches
 * `https://site.example/done/` and `https://site.example/done/?next=1`.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const WILDCARD_PREFIX = 'https://*.';

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The URL, when it is one a provider window may load at all: http(s) without credentials. */
function webUrl(url: string): URL | null {
  const parsed = parseUrl(url);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return null;
  if (parsed.username || parsed.password) return null;
  return parsed;
}

/**
 * True when `pattern` is a valid origin pattern a provider may declare: an exact https
 * origin, or `https://*.` followed by a domain of at least two labels.
 */
export function isHttpsOriginPattern(pattern: unknown): boolean {
  if (typeof pattern !== 'string') return false;
  if (pattern.startsWith(WILDCARD_PREFIX)) {
    return DOMAIN.test(pattern.slice(WILDCARD_PREFIX.length));
  }
  const parsed = parseUrl(pattern);
  return (
    parsed !== null &&
    parsed.protocol === 'https:' &&
    parsed.origin === pattern &&
    /^[a-z0-9.-]+$/.test(parsed.hostname)
  );
}

/** True when `url`'s origin fits one of `patterns` (see the module comment). */
export function matchesOrigin(url: string, patterns: readonly string[]): boolean {
  const target = webUrl(url);
  if (!target) return false;
  const host = target.hostname.toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith(WILDCARD_PREFIX)) {
      const domain = pattern.slice(WILDCARD_PREFIX.length).toLowerCase();
      return (
        target.protocol === 'https:' &&
        target.port === '' &&
        DOMAIN.test(domain) &&
        host.length > domain.length + 1 &&
        host.endsWith(`.${domain}`)
      );
    }
    const allowed = parseUrl(pattern);
    if (!allowed || allowed.origin !== pattern) return false;
    if (allowed.protocol === 'http:' && !LOOPBACK_HOSTS.has(allowed.hostname)) return false;
    return target.origin === allowed.origin;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `pattern` is an https URL pattern (with `*` wildcards) that parses as a URL. */
export function isHttpsUrlPattern(pattern: unknown): boolean {
  if (typeof pattern !== 'string' || !pattern.startsWith('https://')) return false;
  const sample = parseUrl(pattern.replace(/\*/g, 'x'));
  return sample !== null && sample.protocol === 'https:';
}

/** True when `url` matches one of the `*`-wildcard URL patterns, anchored at both ends. */
export function matchesUrlPattern(url: string, patterns: readonly string[]): boolean {
  const target = webUrl(url);
  if (!target) return false;
  const href = target.href;
  return patterns.some((pattern) => {
    const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i');
    return regex.test(href);
  });
}

/**
 * What a log line may say about a URL: the origin of a web URL, otherwise only its scheme.
 * Never the path or query, which can carry a sign-in token or a booking hash.
 */
export function describeUrl(url: string): string {
  const parsed = parseUrl(url);
  if (!parsed) return 'an invalid URL';
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    ? parsed.origin
    : `a ${parsed.protocol} URL`;
}
