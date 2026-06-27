import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PageResult } from './crawl.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Write the two artifacts that make this more than a pile of HTML:
 *  - site-map.json: the page graph (url, file, title, depth, outgoing links)
 *  - index.html: a browsable table of contents into the captured pages
 */
export async function writeSiteMap(
  results: PageResult[],
  outDir: string,
  startUrl: string,
  generatedAt: string,
): Promise<void> {
  const ok = results.filter((r) => r.status === 'ok');
  const errors = results.filter((r) => r.status === 'error');

  const map = {
    site: startUrl,
    generatedAt,
    pageCount: ok.length,
    errorCount: errors.length,
    pages: results.map((r) => ({
      url: r.url,
      file: r.file,
      title: r.title,
      depth: r.depth,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
      links: r.links,
    })),
  };
  await writeFile(path.join(outDir, 'site-map.json'), JSON.stringify(map, null, 2));

  const rows = ok
    .filter((r): r is PageResult & { file: string } => r.file !== null)
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(
      (r) =>
        `    <li><a href="${escapeHtml(r.file)}">${escapeHtml(r.title || r.url)}</a> <small>${escapeHtml(r.url)}</small></li>`,
    )
    .join('\n');
  const errRows = errors
    .map((r) => `    <li>${escapeHtml(r.url)} — ${escapeHtml(r.error ?? 'error')}</li>`)
    .join('\n');

  const index = `<!doctype html>
<meta charset="utf-8">
<title>sitewalker — ${escapeHtml(startUrl)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem}small{color:#888}h2{margin-top:2rem}</style>
<h1>${escapeHtml(startUrl)}</h1>
<p>${ok.length} pages captured${errors.length ? ` · ${errors.length} errors` : ''} · ${escapeHtml(generatedAt)}</p>
<h2>Pages</h2>
<ul>
${rows}
</ul>${errors.length ? `\n<h2>Errors</h2>\n<ul>\n${errRows}\n</ul>` : ''}
`;
  await writeFile(path.join(outDir, 'index.html'), index);
}
