# sitestash

[![npm version](https://img.shields.io/npm/v/sitestash.svg)](https://www.npmjs.com/package/sitestash)
[![CI](https://github.com/AugurCognito/sitestash/actions/workflows/ci.yml/badge.svg)](https://github.com/AugurCognito/sitestash/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/sitestash.svg)](LICENSE)

Point it at a URL. Get back a **faithful, offline-browsable copy of the whole site** —
one self-contained `.html` per page (all CSS, images and fonts inlined), internal links
rewritten to work offline, plus a `site-map.json` graph of how the pages connect.

Built for **website migration reference**: when a client moves to us, capture their current
site exactly as it is so the rebuild team has a pixel-faithful, clickable reference. Works on
**static sites and JavaScript/SPA sites alike** (pages are rendered in a real browser before saving).

```bash
sitestash https://client-site.com      # crawl → ./output/client-site.com/
sitestash https://another-client.com   # each crawl is kept separately
sitestash serve --open                  # dashboard of ALL crawls, in your browser

# ./output/
#   client-site.com/
#     index.html        ← flat table of contents
#     site-map.json     ← page graph
#     client-site.com/… ← one self-contained .html per page
#   another-client.com/ …
```

`sitestash serve` renders a dashboard listing every crawl in the folder, each with a
collapsible tree of its pages — so old exports stay browsable alongside new ones.

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

So sitestash owns discovery, fan-out, deterministic file naming and **URL-aware** link
rewriting, and uses SingleFile purely as a rock-solid single-page capture engine.

## Install

```bash
# run without installing
npx sitestash https://example.com

# or install the CLI globally
npm i -g sitestash      # then: sitestash https://example.com
```

From source (for development):

```bash
pnpm install       # installs single-file-cli (it auto-detects your local Chrome)
pnpm build
pnpm link --global # optional: makes `sitestash` available globally
```

Requires **Node ≥ 20** and a Chrome/Chromium install on the machine.

## Usage

```bash
# whole site, default settings
sitestash https://example.com

# limit depth, slow down, custom output dir
sitestash https://example.com --depth 2 --delay 500 --out ./snapshot

# faster, text-focused capture
sitestash https://example.com --block-images --concurrency 6

# also emit clean markdown per page (AI reference), and follow subdomains
sitestash https://example.com --markdown --include-subdomains
```

Run `sitestash --help` for all options. During development, `pnpm dev <url> [opts]`
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

- **Scope = apex + www by default.** `x.com` and `www.x.com` are crawled together. Pass
  `--include-subdomains` to also follow `blog.x.com`, `shop.x.com`, etc. Other domains are
  never followed.
- **Each captured page is a frozen snapshot.** Client-side interactivity that depends on
  live network calls won't work offline (the *rendered* state is preserved, which is what a
  migration reference needs). For interactive replay of complex SPAs, use
  [Browsertrix](https://github.com/webrecorder/browsertrix-crawler) (WARC/WACZ).
- **Concurrency spawns one browser per worker.** Lower `--concurrency` on constrained machines.
- Only `<a href>` links are rewritten for offline use; assets are already inlined, so they
  need no rewriting.

## Testing

`pnpm check` (Biome + strict tsc) runs in CI on every push and PR.

`scripts/smoke.sh` is a live-network integration check that crawls a few
scrape-friendly sandbox sites (toscrape.com, example.com) and validates the
output — page counts, asset inlining, offline link rewriting, JS rendering, and
the site map. It needs Chrome and hits the network, so it is **not** run in CI:

```bash
./scripts/smoke.sh
```

## License

sitestash's own code is licensed under the [MIT License](LICENSE).

> [!IMPORTANT]
> sitestash depends on [`single-file-cli`](https://github.com/gildas-lormeau/single-file-cli),
> which is licensed under **AGPL-3.0**. We invoke it as a **separate process** and do not
> bundle, link, or modify its source — so sitestash itself can be MIT. However, if you
> **redistribute** single-file-cli alongside this tool, or expose it as a **network service**,
> AGPL-3.0 obligations apply to that component. `cheerio` is MIT.
