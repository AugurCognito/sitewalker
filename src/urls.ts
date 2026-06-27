import path from 'node:path';

// Extensions that are never crawlable HTML pages (assets, media, documents).
const ASSET_EXT =
  /\.(?:jpe?g|png|gif|svg|webp|ico|bmp|avif|css|js|mjs|cjs|json|xml|txt|rss|atom|pdf|zip|t?gz|rar|7z|mp[34]|m4a|wav|ogg|flac|webm|mov|avi|mkv|woff2?|ttf|otf|eot|csv|tsv|xlsx?|docx?|pptx?|dmg|exe|apk|wasm)$/i;

/** Parse + normalize a URL. Drops the fragment. Returns null for non-http(s). */
export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  return u.toString();
}

/** True when `target` is on exactly the same hostname as `host`. */
export function sameHost(target: string, host: string): boolean {
  try {
    return new URL(target).hostname.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/** Heuristic: does this URL look like an HTML page (not an asset/download)? */
export function isProbablyPage(target: string): boolean {
  try {
    return !ASSET_EXT.test(new URL(target).pathname);
  } catch {
    return false;
  }
}

function sanitizeSegment(seg: string): string {
  const clean = seg.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return clean.length > 120 ? clean.slice(0, 120) : clean;
}

/**
 * Deterministic URL -> relative file path (posix, forward slashes).
 * Mirrors the site structure under <hostname>/..., always ending in .html.
 *   https://x.com/            -> x.com/index.html
 *   https://x.com/about       -> x.com/about.html
 *   https://x.com/a/b/        -> x.com/a/b/index.html
 *   https://x.com/s?q=1       -> x.com/s__q_1.html
 */
export function urlToRelPath(raw: string): string {
  const u = new URL(raw);
  let pathname: string;
  try {
    pathname = decodeURIComponent(u.pathname);
  } catch {
    pathname = u.pathname;
  }
  if (pathname.endsWith('/') || pathname === '') pathname += 'index';
  const segments = pathname.replace(/^\/+/, '').split('/').map(sanitizeSegment).filter(Boolean);
  let file = segments.join('/') || 'index';
  if (u.search) file += `__${sanitizeSegment(u.search.slice(1))}`;
  if (!/\.html?$/i.test(file)) file += '.html';
  return `${sanitizeSegment(u.hostname)}/${file}`;
}

/** Relative href (posix) to navigate from one saved page to another. */
export function relHref(fromRel: string, toRel: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromRel), toRel);
  return rel || path.posix.basename(toRel);
}
