import * as cheerio from 'cheerio';
import { normalizeUrl } from './urls.js';

/** Page <title>, whitespace-collapsed. */
export function getTitle(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? title.trim().replace(/\s+/g, ' ') : '';
}

/** All absolute, normalized hrefs from <a> tags (deduplicated). */
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const n = normalizeUrl(href, baseUrl);
    if (n) out.add(n);
  });
  return [...out];
}

/**
 * Rewrite <a href> values to local relative paths for offline browsing.
 *
 * This replaces SingleFile's built-in `--crawl-replace-URLs`, which is a naive
 * exact-string find/replace that fails on trailing-slash normalization. Here we
 * resolve each href to its absolute URL first, so a saved `/about/` and a
 * discovered `/about` map to the same page regardless of formatting.
 *
 * `resolve` returns the relative href to use, or null to leave the link as-is
 * (e.g. external links, or pages we did not capture).
 */
export function rewriteLinks(
  html: string,
  baseUrl: string,
  resolve: (absUrl: string) => string | null,
): string {
  const $ = cheerio.load(html);
  let changed = false;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const abs = normalizeUrl(href, baseUrl);
    if (!abs) return;
    const rel = resolve(abs);
    if (rel !== null && rel !== href) {
      $(el).attr('href', rel);
      changed = true;
    }
  });
  return changed ? $.html() : html;
}
