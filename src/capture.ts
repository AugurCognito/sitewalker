import { spawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import AdmZip from 'adm-zip';

const require = createRequire(import.meta.url);

/** Temp archive name single-file writes to before we unzip it (external mode). */
const CAPTURE_ZIP = '_sitestash-capture.zip';

/** Resolve the single-file-cli node entry point from our dependencies. */
function singleFileEntry(): string {
  const pkgJson = require.resolve('single-file-cli/package.json');
  return path.join(path.dirname(pkgJson), 'single-file-node.js');
}

export interface CaptureOptions {
  /** When SingleFile considers the page loaded: networkIdle | load | domContentLoaded | ... */
  waitUntil: string;
  /** Max ms to wait for page load before giving up. */
  loadMaxTime: number;
  /** Skip images (faster, smaller files). */
  blockImages: boolean;
  /** Save assets as separate sibling files (one dir per page) instead of inlining them. */
  externalAssets: boolean;
  /** Extra raw flags passed through to single-file-cli. */
  extraArgs: string[];
}

export type CaptureResult = { ok: true } | { ok: false; error: string };

function runSingleFile(
  url: string,
  outPath: string,
  opts: CaptureOptions,
  extra: string[],
): Promise<string | null> {
  const args = [
    singleFileEntry(),
    url,
    outPath,
    `--browser-wait-until=${opts.waitUntil}`,
    `--browser-load-max-time=${opts.loadMaxTime}`,
    '--filename-conflict-action=overwrite',
    ...(opts.blockImages ? ['--block-images'] : []),
    ...extra,
    ...opts.extraArgs,
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (e) => resolve(e.message));
    child.on('close', (code) => resolve(code === 0 ? null : stderr.trim() || `exit ${code}`));
  });
}

/**
 * SingleFile can exit 0 while producing nothing, so we verify the output file
 * actually exists and is non-trivial — surfacing silent failures instead of
 * hiding them.
 */
async function verifyOutput(outFile: string): Promise<CaptureResult> {
  try {
    const st = await stat(outFile);
    if (st.size < 200) return { ok: false, error: `output too small (${st.size} bytes)` };
  } catch {
    return { ok: false, error: 'no output file produced' };
  }
  return { ok: true };
}

/**
 * External-assets capture: SingleFile writes a ZIP (index.html + separate
 * stylesheet/font/image files referenced by local relative paths); we unzip it
 * into the page's own directory and drop the archive.
 */
async function captureExternal(
  url: string,
  outFile: string,
  opts: CaptureOptions,
): Promise<CaptureResult> {
  const dir = path.dirname(outFile);
  const zipPath = path.join(dir, CAPTURE_ZIP);

  const error = await runSingleFile(url, zipPath, opts, [
    '--compress-content=true',
    '--self-extracting-archive=false',
  ]);
  if (error) return { ok: false, error };

  try {
    if ((await stat(zipPath)).size < 200) return { ok: false, error: 'empty archive produced' };
    new AdmZip(zipPath).extractAllTo(dir, true);
  } catch (e) {
    return { ok: false, error: `archive extraction failed: ${e instanceof Error ? e.message : e}` };
  } finally {
    await rm(zipPath, { force: true });
  }
  return verifyOutput(outFile);
}

/**
 * Capture a single URL via single-file-cli.
 *
 * We invoke SingleFile per-page (NOT its --crawl-* mode, which is buggy:
 * shared-browser parallelism throws "Execution context not found" and its
 * link rewriting silently no-ops). One URL in, one page out — either a single
 * fully-inlined .html (embedded) or an index.html plus sibling assets (external).
 */
export async function capturePage(
  url: string,
  outFile: string,
  opts: CaptureOptions,
): Promise<CaptureResult> {
  await mkdir(path.dirname(outFile), { recursive: true });

  if (opts.externalAssets) return captureExternal(url, outFile, opts);

  const error = await runSingleFile(url, outFile, opts, []);
  if (error) return { ok: false, error };
  return verifyOutput(outFile);
}
