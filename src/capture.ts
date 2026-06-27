import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

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
  /** Extra raw flags passed through to single-file-cli. */
  extraArgs: string[];
}

export type CaptureResult = { ok: true } | { ok: false; error: string };

function runSingleFile(url: string, outFile: string, opts: CaptureOptions): Promise<string | null> {
  const args = [
    singleFileEntry(),
    url,
    outFile,
    `--browser-wait-until=${opts.waitUntil}`,
    `--browser-load-max-time=${opts.loadMaxTime}`,
    '--filename-conflict-action=overwrite',
    ...(opts.blockImages ? ['--block-images'] : []),
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
 * Capture a single URL as one self-contained .html via single-file-cli.
 *
 * We invoke SingleFile per-page (NOT its --crawl-* mode, which is buggy:
 * shared-browser parallelism throws "Execution context not found" and its
 * link rewriting silently no-ops). One URL in, one fully-inlined file out.
 *
 * SingleFile can exit 0 while producing nothing, so we verify the output file
 * actually exists and is non-trivial — surfacing silent failures instead of
 * hiding them.
 */
export async function capturePage(
  url: string,
  outFile: string,
  opts: CaptureOptions,
): Promise<CaptureResult> {
  await mkdir(path.dirname(outFile), { recursive: true });

  const error = await runSingleFile(url, outFile, opts);
  if (error) return { ok: false, error };

  try {
    const st = await stat(outFile);
    if (st.size < 200) return { ok: false, error: `output too small (${st.size} bytes)` };
  } catch {
    return { ok: false, error: 'no output file produced' };
  }
  return { ok: true };
}
