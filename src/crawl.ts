import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type CaptureOptions, capturePage } from './capture.js';
import { discoverSitemapUrls } from './discovery.js';
import { extractLinks, getTitle, rewriteLinks } from './extract.js';
import { htmlToMarkdown } from './markdown.js';
import {
  inScope,
  isProbablyPage,
  normalizeUrl,
  relHref,
  type SiteScope,
  siteScope,
  urlToRelPath,
} from './urls.js';

export interface CrawlConfig {
  startUrl: string;
  outDir: string;
  /** Link-following depth from the start URL. Use Infinity for the whole site. */
  maxDepth: number;
  /** Number of pages captured in parallel (each spawns its own browser). */
  concurrency: number;
  /** Delay after each capture (politeness), in ms. */
  delayMs: number;
  /** Hard safety cap on pages captured. */
  maxPages: number;
  /** Also write a clean markdown rendition of each page (AI reference). */
  markdown: boolean;
  /** Follow every subdomain of the registrable domain, not just apex/www. */
  includeSubdomains: boolean;
  capture: CaptureOptions;
  log: (m: string) => void;
}

export interface PageResult {
  url: string;
  file: string | null; // relative path, null on error
  title: string;
  depth: number;
  status: 'ok' | 'error';
  error?: string;
  links: string[]; // same-host normalized links found on the page
}

interface QueueItem {
  url: string;
  depth: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function crawl(cfg: CrawlConfig): Promise<PageResult[]> {
  const start = new URL(cfg.startUrl);
  const scope: SiteScope = siteScope(cfg.startUrl, cfg.includeSubdomains);

  const queued = new Set<string>();
  const results = new Map<string, PageResult>();
  const queue: QueueItem[] = [];

  function enqueue(rawUrl: string, depth: number): void {
    if (depth > cfg.maxDepth || queued.size >= cfg.maxPages) return;
    const n = normalizeUrl(rawUrl);
    if (!n || queued.has(n)) return;
    if (!inScope(n, scope) || !isProbablyPage(n)) return;
    queued.add(n);
    queue.push({ url: n, depth });
  }

  // Capture one page, record the result, and enqueue its same-host links.
  async function captureAndRecord(item: QueueItem, label: number): Promise<void> {
    const rel = urlToRelPath(item.url, cfg.capture.externalAssets);
    const outFile = path.join(cfg.outDir, rel);
    cfg.log(`[${label}] depth ${item.depth}  ${item.url}`);

    const res = await capturePage(item.url, outFile, cfg.capture);
    if (!res.ok) {
      cfg.log(`     ✗ ${res.error}`);
      results.set(item.url, {
        url: item.url,
        file: null,
        title: '',
        depth: item.depth,
        status: 'error',
        error: res.error,
        links: [],
      });
      return;
    }

    const html = await readFile(outFile, 'utf-8');
    if (cfg.markdown) {
      await writeFile(outFile.replace(/\.html?$/i, '.md'), htmlToMarkdown(html));
    }
    const links = extractLinks(html, item.url).filter((l) => inScope(l, scope));
    results.set(item.url, {
      url: item.url,
      file: rel,
      title: getTitle(html),
      depth: item.depth,
      status: 'ok',
      links,
    });
    for (const l of links) enqueue(l, item.depth + 1);
  }

  // Seed: the start URL, plus everything in the sitemap (depth 0).
  enqueue(start.toString(), 0);
  for (const u of await discoverSitemapUrls(start.origin, scope, cfg.log)) {
    enqueue(u, 0);
  }

  // Cooperative worker pool. JS is single-threaded, so the shared counters and
  // collections are mutated without interleaving between awaits — no locks
  // needed. The shift() and inFlight++ below run in one synchronous block (no
  // await between them), so a peer can never observe an empty queue while this
  // worker holds an item but has not yet registered it as in-flight. A worker
  // only exits once the queue is empty AND no peer is still in flight (a peer
  // might enqueue children before it finishes). The page budget is enforced in
  // enqueue(), so the loop body has no cap check.
  let inFlight = 0;
  let processed = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const item = queue.shift();
      if (!item) {
        if (inFlight === 0) return;
        await sleep(25);
        continue;
      }
      inFlight++;
      try {
        await captureAndRecord(item, ++processed);
        if (cfg.delayMs) await sleep(cfg.delayMs);
      } finally {
        inFlight--;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency) }, () => worker()));

  await rewriteForOffline(cfg, results);
  return [...results.values()];
}

/** Final pass: point every internal link at its local file (URL-aware). */
async function rewriteForOffline(
  cfg: CrawlConfig,
  results: Map<string, PageResult>,
): Promise<void> {
  const urlToFile = new Map<string, string>();
  for (const r of results.values()) {
    if (r.status === 'ok' && r.file) urlToFile.set(r.url, r.file);
  }

  cfg.log('rewriting internal links for offline browsing…');
  for (const r of results.values()) {
    const fromFile = r.file;
    if (r.status !== 'ok' || !fromFile) continue;
    const abs = path.join(cfg.outDir, fromFile);
    const html = await readFile(abs, 'utf-8');
    const out = rewriteLinks(html, r.url, (target) => {
      const file = urlToFile.get(target);
      return file ? relHref(fromFile, file) : null;
    });
    if (out !== html) await writeFile(abs, out);
  }
}
