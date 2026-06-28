import { inScope, normalizeUrl, type SiteScope } from './urls.js';

async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseSitemapXml(xml: string): { sitemaps: string[]; urls: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].flatMap((m) =>
    m[1] ? [m[1]] : [],
  );
  // A <sitemapindex> points to more sitemaps; a <urlset> lists actual pages.
  return /<sitemapindex/i.test(xml) ? { sitemaps: locs, urls: [] } : { sitemaps: [], urls: locs };
}

/** robots.txt `Sitemap:` directives, falling back to /sitemap.xml. */
async function findSitemapEntrypoints(origin: string): Promise<string[]> {
  const entrypoints: string[] = [];
  const robots = await fetchText(new URL('/robots.txt', origin).toString());
  if (robots) {
    for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      const loc = m[1];
      if (loc) entrypoints.push(loc.trim());
    }
  }
  if (entrypoints.length === 0) entrypoints.push(new URL('/sitemap.xml', origin).toString());
  return entrypoints;
}

/** Fetch one sitemap and split it into nested sitemaps and in-scope page URLs. */
async function readSitemap(
  sm: string,
  scope: SiteScope,
): Promise<{ nested: string[]; pages: string[] }> {
  const xml = await fetchText(sm);
  if (!xml) return { nested: [], pages: [] };
  const { sitemaps, urls } = parseSitemapXml(xml);
  const pages = urls
    .map((u) => normalizeUrl(u))
    .filter((u): u is string => u !== null && inScope(u, scope));
  return { nested: sitemaps, pages };
}

/** Walk sitemap entrypoints (expanding indexes) into in-scope page URLs. */
async function collectSitemapUrls(entrypoints: string[], scope: SiteScope): Promise<Set<string>> {
  const seen = new Set<string>();
  const urls = new Set<string>();
  const queue = [...entrypoints];

  while (queue.length) {
    const sm = queue.shift();
    if (sm === undefined || seen.has(sm)) continue;
    seen.add(sm);

    const { nested, pages } = await readSitemap(sm, scope);
    for (const n of nested) if (!seen.has(n)) queue.push(n);
    for (const p of pages) urls.add(p);
  }
  return urls;
}

/**
 * Sitemap-first discovery. Reads robots.txt for `Sitemap:` directives, falls
 * back to /sitemap.xml, and recursively expands sitemap indexes. Returns the
 * same-host page URLs found (possibly empty — caller then crawls by links).
 */
export async function discoverSitemapUrls(
  origin: string,
  scope: SiteScope,
  log: (m: string) => void,
): Promise<string[]> {
  const entrypoints = await findSitemapEntrypoints(origin);
  const urls = await collectSitemapUrls(entrypoints, scope);
  log(
    urls.size ? `sitemap: ${urls.size} URLs discovered` : 'sitemap: none found — crawling by links',
  );
  return [...urls];
}
