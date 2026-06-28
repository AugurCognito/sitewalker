#!/usr/bin/env node
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { CaptureOptions } from './capture.js';
import { crawl, type PageResult } from './crawl.js';
import { openBrowser, serve } from './serve.js';
import { writeSiteMap } from './sitemap.js';

const DEFAULT_OUT = './output';

const USAGE = `sitestash — mirror a whole site into self-contained, offline-browsable pages.

Usage:
  sitestash <url> [options]      Crawl a site into ${DEFAULT_OUT}/<host>/
  sitestash serve [dir]          Serve a dashboard of all crawls in dir (default: ${DEFAULT_OUT})

Crawl options:
  -o, --out <dir>        Output directory          (default: ${DEFAULT_OUT})
  -d, --depth <n>        Max link depth            (default: unlimited)
  -c, --concurrency <n>  Pages captured in parallel(default: 4)
      --delay <ms>       Delay after each page     (default: 0)
      --max-pages <n>    Safety cap on pages       (default: 5000)
      --wait-until <s>   Page-ready signal: networkIdle|load|domContentLoaded
                                                   (default: networkIdle)
      --block-images       Skip images (faster, smaller files)
      --markdown           Also write a clean .md of each page (AI reference)
      --include-subdomains Follow all subdomains (e.g. blog.x.com), not just www
      --serve              Start the viewer server when the crawl finishes
  -h, --help               Show this help

Serve options (also apply to --serve):
      --port <n>         Port to listen on         (default: 8080)
      --open             Open the site in your browser

Output (per crawl, under ${DEFAULT_OUT}/<host>/ by default):
  <host>/...             one self-contained .html per page (all assets inlined)
  index.html             flat table of contents
  site-map.json          page graph (urls, files, titles, links, depth)

  Then "sitestash serve" shows a dashboard of every crawl with a page tree.
`;

interface CliValues {
  out?: string;
  depth?: string;
  concurrency?: string;
  delay?: string;
  'max-pages'?: string;
  'wait-until'?: string;
  'block-images'?: boolean;
  markdown?: boolean;
  'include-subdomains'?: boolean;
  serve?: boolean;
  port?: string;
  open?: boolean;
  help?: boolean;
}

function parseIntOpt(v: string | undefined, name: string, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`Invalid --${name}: ${v}`);
    process.exit(1);
  }
  return n;
}

/** Start the static viewer server, keep the process alive until Ctrl+C. */
async function startViewer(dir: string, portStr: string | undefined, open: boolean): Promise<void> {
  const resolved = path.resolve(dir);
  if (!(await stat(resolved).catch(() => null))?.isDirectory()) {
    console.error(`Nothing to serve: ${resolved} does not exist. Run a crawl first.`);
    process.exit(1);
  }
  const port = parseIntOpt(portStr, 'port', 8080);
  try {
    const handle = await serve(resolved, port);
    console.log(`\nServing ${resolved}`);
    console.log(`→ ${handle.url}   (Ctrl+C to stop)`);
    if (open) openBrowser(handle.url);
    // Foreground process: the listening socket keeps it alive; Ctrl+C stops it.
    process.once('SIGINT', () => {
      console.log('\nStopping server…');
      void handle.close();
      process.exit(0);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Could not start server on port ${port}: ${msg}. Try a different --port.`);
    process.exit(1);
  }
}

function parseStartUrl(target: string): URL {
  try {
    const url = new URL(target);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    return url;
  } catch {
    console.error(`Invalid URL: ${target}`);
    process.exit(1);
  }
}

async function reportAndServe(
  results: PageResult[],
  outDir: string,
  startedAt: number,
  values: CliValues,
): Promise<void> {
  const ok = results.filter((r) => r.status === 'ok').length;
  const failed = results.length - ok;
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nDone: ${ok} pages${failed ? `, ${failed} errors` : ''} in ${secs}s`);

  if (values.serve) {
    // Serve the parent so the dashboard lists every crawl (unless --out was set).
    await startViewer(values.out ?? DEFAULT_OUT, values.port, Boolean(values.open));
    return;
  }
  console.log(`Open ${path.join(outDir, 'index.html')}`);
  const serveTarget = values.out ? ` ${values.out}` : '';
  console.log(`Or run: sitestash serve${serveTarget} --open`);
  if (failed) process.exitCode = 1;
}

async function runCrawl(target: string, values: CliValues): Promise<void> {
  const start = parseStartUrl(target);
  // Default: namespace each crawl under output/<host> so crawls accumulate and
  // `sitestash serve` can show them all. An explicit --out is used verbatim.
  const hostFolder = start.hostname.replace(/^www\./i, '');
  const outDir = values.out ? path.resolve(values.out) : path.resolve(DEFAULT_OUT, hostFolder);
  await mkdir(outDir, { recursive: true });

  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  console.log(`sitestash → ${start.toString()}`);
  console.log(`output    → ${outDir}\n`);

  const capture: CaptureOptions = {
    waitUntil: values['wait-until'] ?? 'networkIdle',
    loadMaxTime: 60000,
    blockImages: Boolean(values['block-images']),
    extraArgs: [],
  };

  const results = await crawl({
    startUrl: start.toString(),
    outDir,
    maxDepth: values.depth ? parseIntOpt(values.depth, 'depth', 0) : Number.POSITIVE_INFINITY,
    concurrency: parseIntOpt(values.concurrency, 'concurrency', 4),
    delayMs: parseIntOpt(values.delay, 'delay', 0),
    maxPages: parseIntOpt(values['max-pages'], 'max-pages', 5000),
    markdown: Boolean(values.markdown),
    includeSubdomains: Boolean(values['include-subdomains']),
    capture,
    log: (m) => console.log(m),
  });

  await writeSiteMap(results, outDir, start.toString(), generatedAt);
  await reportAndServe(results, outDir, startedAt, values);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      depth: { type: 'string', short: 'd' },
      concurrency: { type: 'string', short: 'c' },
      delay: { type: 'string' },
      'max-pages': { type: 'string' },
      'wait-until': { type: 'string' },
      'block-images': { type: 'boolean' },
      markdown: { type: 'boolean' },
      'include-subdomains': { type: 'boolean' },
      serve: { type: 'boolean' },
      port: { type: 'string' },
      open: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const command = positionals[0];

  if (command === 'serve') {
    await startViewer(positionals[1] ?? DEFAULT_OUT, values.port, Boolean(values.open));
    return;
  }

  if (!command) {
    console.log(USAGE);
    process.exit(1);
  }

  await runCrawl(command, values);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
