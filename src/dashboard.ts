import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

interface SiteMapPage {
  url: string;
  file: string | null;
  title: string;
  status: string;
}
interface SiteMap {
  site: string;
  generatedAt: string;
  pageCount: number;
  pages: SiteMapPage[];
}

interface TreeNode {
  name: string;
  href?: string;
  children: Map<string, TreeNode>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Find every crawl directory (one containing a site-map.json) under root.
 * Prunes once found — page trees never hold a site-map.json — and depth-caps
 * as a safety net. Returns posix-relative directories.
 */
async function findCrawlDirs(root: string, rel = '', depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  const entries = await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
  if (entries.some((e) => e.isFile() && e.name === 'site-map.json')) return [rel];
  const found: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      found.push(...(await findCrawlDirs(root, path.posix.join(rel, e.name), depth + 1)));
    }
  }
  return found;
}

function addToTree(root: TreeNode, segments: string[], href: string): void {
  let node = root;
  for (const seg of segments) {
    let child = node.children.get(seg);
    if (!child) {
      child = { name: seg, children: new Map() };
      node.children.set(seg, child);
    }
    node = child;
  }
  node.href = href;
}

function renderNode(node: TreeNode): string {
  const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  const label = node.href
    ? `<a href="${escapeHtml(node.href)}">${escapeHtml(node.name)}</a>`
    : escapeHtml(node.name);
  if (kids.length === 0) return `<li>${label}</li>`;
  return `<li><details><summary>${label}</summary><ul>${kids.map(renderNode).join('')}</ul></details></li>`;
}

function renderCrawl(map: SiteMap, dir: string): string {
  const root: TreeNode = { name: map.site, children: new Map() };
  for (const p of map.pages) {
    if (p.status !== 'ok' || !p.file) continue;
    let host = p.url;
    let parts: string[] = [];
    try {
      const u = new URL(p.url);
      host = u.hostname;
      parts = u.pathname.split('/').filter(Boolean);
    } catch {
      // keep raw url as the single segment
    }
    addToTree(root, [host, ...parts], path.posix.join('/', dir, p.file));
  }
  const trees = [...root.children.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(renderNode)
    .join('');
  const indexHref = escapeHtml(path.posix.join('/', dir, 'index.html'));
  return `<section>
  <details>
    <summary><strong>${escapeHtml(map.site)}</strong> <small>${map.pageCount} pages · ${escapeHtml(map.generatedAt)}</small></summary>
    <p><a href="${indexHref}">open flat index →</a></p>
    <ul class="tree">${trees}</ul>
  </details>
</section>`;
}

/** Build the served root dashboard: every crawl present + a collapsible page tree. */
export async function buildDashboard(root: string): Promise<string> {
  const dirs = await findCrawlDirs(root);
  const maps: Array<{ map: SiteMap; dir: string }> = [];
  for (const dir of dirs) {
    try {
      const map = JSON.parse(
        await readFile(path.join(root, dir, 'site-map.json'), 'utf-8'),
      ) as SiteMap;
      maps.push({ map, dir });
    } catch {
      // skip unreadable / malformed maps
    }
  }
  maps.sort((a, b) => a.map.site.localeCompare(b.map.site));

  const body = maps.length
    ? maps.map(({ map, dir }) => renderCrawl(map, dir)).join('\n')
    : '<p>No crawls found in this directory. Run <code>sitestash &lt;url&gt;</code> first.</p>';

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sitestash — ${maps.length} crawl${maps.length === 1 ? '' : 's'}</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#222}
  h1{font-size:1.4rem}
  small{color:#888;font-weight:400}
  section{border:1px solid #e5e5e5;border-radius:8px;margin:.75rem 0;padding:.5rem 1rem}
  summary{cursor:pointer}
  ul.tree,ul.tree ul{list-style:none;margin:.2rem 0;padding-left:1rem;border-left:1px solid #eee}
  a{color:#2563eb;text-decoration:none}
  a:hover{text-decoration:underline}
</style>
<h1>sitestash <small>${maps.length} crawl${maps.length === 1 ? '' : 's'}</small></h1>
${body}
`;
}
