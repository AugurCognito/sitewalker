# sitewalker

Point it at a URL. Get back a **faithful, offline-browsable copy of the whole site** —
one self-contained `.html` per page (all CSS, images and fonts inlined), internal links
rewritten to work offline, plus a `site-map.json` graph of how the pages connect.

Built for **website migration reference**: when a client moves to us, capture their current
site exactly as it is so the rebuild team has a pixel-faithful, clickable reference. Works on
**static sites and JavaScript/SPA sites alike** (pages are rendered in a real browser before saving).

```bash
sitewalker https://client-site.com      # crawl → ./output/
sitewalker serve --open                  # browse ./output/ in your browser

# ./output/
#   index.html        ← browsable table of contents
#   site-map.json     ← page graph
#   client-site.com/… ← one self-contained .html per page
```

## How it works

```
sitemap-first discovery → render+save each page → extract links → repeat
                                                        ↓
                                  rewrite internal links to local files
                                                        ↓
                                          emit site-map.json + index.html
```

1. **Discovery** — read `robots.txt` + `sitemap.xml` first (the authoritative URL list).
   No sitemap? Fall back to following same-host `<a href>` links.
2. **Capture** — each page is saved by [`single-file-cli`](https://github.com/gildas-lormeau/single-file-cli),
   which renders it in headless Chrome (so JS/SPA content materializes) and inlines every
   asset into **one portable `.html`** you can open by double-clicking.
3. **Link rewriting** — after the crawl, every internal `<a href>` is repointed to its local
   file so the copy browses entirely offline.
4. **Site map** — `site-map.json` records each page's URL, file, title, depth and outgoing links.

### Why we drive SingleFile per-page instead of using its `--crawl` mode

SingleFile *has* a built-in crawler, but two parts of it are unreliable (verified, v2.0.83):

- **Parallel crawl crashes** — `--max-parallel-workers > 1` throws `Execution context not found`
  and silently produces zero files (exit code 0).
- **Offline link rewriting is broken** — `--crawl-replace-URLs` is a naive exact-string
  find/replace of the original URL; trailing-slash normalization makes it miss almost
  everything (0 of ~1400 links rewritten on a real site).

So sitewalker owns discovery, fan-out, deterministic file naming and **URL-aware** link
rewriting, and uses SingleFile purely as a rock-solid single-page capture engine.

## Install

```bash
pnpm install       # installs single-file-cli (it auto-detects your local Chrome)
pnpm build
pnpm link --global # optional: makes `sitewalker` available globally
```

Requires **Node ≥ 20** and a Chrome/Chromium install on the machine.

## Usage

```bash
# whole site, default settings
sitewalker https://example.com

# limit depth, slow down, custom output dir
sitewalker https://example.com --depth 2 --delay 500 --out ./snapshot

# faster, text-focused capture
sitewalker https://example.com --block-images --concurrency 6
```

Run `sitewalker --help` for all options. During development, `pnpm dev <url> [opts]`
(pnpm forwards args directly — no `--` separator needed).

## Development

Tooling matches the house standard (Biome for lint + format, strict TypeScript,
git hooks via simple-git-hooks):

```bash
pnpm lint        # biome check (lint + format diagnostics)
pnpm lint:fix    # biome check --write (apply safe fixes + format)
pnpm format      # biome format --write
pnpm typecheck   # tsc --noEmit (strict: exactOptionalPropertyTypes, verbatimModuleSyntax, …)
pnpm check       # biome ci + typecheck — the full gate
```

Git hooks are installed on `pnpm install`: **pre-commit** runs Biome on staged files,
**pre-push** runs the typecheck. Config lives in `biome.json`, `tsconfig.json`,
`.editorconfig`, `.npmrc`.

## Known limitations (v1)

- **Same hostname only.** `www.x.com` and `x.com` are treated as different sites;
  subdomains are not followed.
- **Each captured page is a frozen snapshot.** Client-side interactivity that depends on
  live network calls won't work offline (the *rendered* state is preserved, which is what a
  migration reference needs). For interactive replay of complex SPAs, use
  [Browsertrix](https://github.com/webrecorder/browsertrix-crawler) (WARC/WACZ).
- **Concurrency spawns one browser per worker.** Lower `--concurrency` on constrained machines.
- Only `<a href>` links are rewritten for offline use; assets are already inlined, so they
  need no rewriting.
