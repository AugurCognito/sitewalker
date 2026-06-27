#!/usr/bin/env bash
#
# smoke.sh — run sitestash against a few real sites and validate the output.
#
# These are live-network integration checks (slow, polite, bounded), NOT unit
# tests — they are intentionally kept out of `pnpm test`/CI. Run on demand:
#
#   ./scripts/smoke.sh
#
# Targets are scrape-friendly sandboxes (toscrape.com is built for this) plus
# example.com. Each crawl is capped with --max-pages / --depth and rate-limited
# with --delay to stay polite.

# No pipefail: this script counts results with `grep | wc -l`, and grep exits 1
# on no-match — under pipefail that would abort the run instead of reporting 0.
set -eu
cd "$(dirname "$0")/.."

OUT_ROOT="./output/smoke"
POLITE=(--concurrency 2 --delay 300)

# name | url | extra flags | assertion keyword (grep, case-insensitive) | min pages
TARGETS=(
  "example|https://example.com|--max-pages 1|Example Domain|1"
  "quotes-static|https://quotes.toscrape.com|--depth 1 --max-pages 6|Einstein|3"
  "quotes-js|https://quotes.toscrape.com/js/|--depth 1 --max-pages 6|Einstein|3"
  "books-images|https://books.toscrape.com|--depth 1 --max-pages 6|data:image|3"
)

pass=0
fail=0
declare -a SUMMARY

note() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()   { printf '   \033[32m✓ %s\033[0m\n' "$1"; }
bad()  { printf '   \033[31m✗ %s\033[0m\n' "$1"; }

check() { # description | condition-result(0/1)
  if [ "$2" -eq 0 ]; then ok "$1"; return 0; else bad "$1"; return 1; fi
}

echo "Building…"
pnpm build >/dev/null
mkdir -p "$OUT_ROOT"

for entry in "${TARGETS[@]}"; do
  IFS='|' read -r name url flags keyword minpages <<<"$entry"
  out="$OUT_ROOT/$name"
  rm -rf "$out"

  note "$name  ($url)"
  ok_target=1

  # shellcheck disable=SC2086
  if node dist/cli.js "$url" --out "$out" $flags "${POLITE[@]}" >"$out.log" 2>&1; then
    crawl_rc=0
  else
    crawl_rc=$?
  fi
  # crawl exits 1 if some pages errored; treat as soft (still validate output)
  [ "$crawl_rc" -le 1 ] || { bad "crawl crashed (exit $crawl_rc)"; tail -5 "$out.log"; fail=$((fail+1)); SUMMARY+=("$name: CRASH"); continue; }

  # Count captured pages: every .html except the top-level viewer index.html.
  # A captured homepage maps to <host>/index.html, so we exclude only the root one.
  pages=$(find "$out" -name '*.html' ! -path "$out/index.html" | wc -l | tr -d ' ')
  check "captured >= $minpages pages (got $pages)" "$([ "$pages" -ge "$minpages" ] && echo 0 || echo 1)" || ok_target=0

  check "site-map.json exists" "$([ -f "$out/site-map.json" ] && echo 0 || echo 1)" || ok_target=0
  check "viewer index.html exists" "$([ -f "$out/index.html" ] && echo 0 || echo 1)" || ok_target=0

  # site-map pageCount matches files on disk
  if [ -f "$out/site-map.json" ]; then
    mapcount=$(node -e "const m=require('./$out/site-map.json');console.log(m.pageCount)")
    check "site-map pageCount ($mapcount) == html files ($pages)" \
      "$([ "$mapcount" -eq "$pages" ] && echo 0 || echo 1)" || ok_target=0
  fi

  # no external asset refs leaked (everything inlined)
  leaks=$(grep -rolE '(src|href)="https?://[^"]+\.(png|jpe?g|gif|svg|webp|css|woff2?)"' "$out" 2>/dev/null | wc -l | tr -d ' ')
  check "no external asset refs left (files with leaks: $leaks)" \
    "$([ "$leaks" -eq 0 ] && echo 0 || echo 1)" || ok_target=0

  # offline link rewriting produced local .html links (skip single-page targets)
  if [ "$minpages" -gt 1 ]; then
    localrefs=$(grep -rohE 'href="[^"]+\.html"' "$out"/*/ 2>/dev/null | grep -vc '://' || true)
    check "internal links rewritten to local files ($localrefs)" \
      "$([ "${localrefs:-0}" -gt 0 ] && echo 0 || echo 1)" || ok_target=0
  fi

  # per-target content assertion (e.g. JS actually rendered for quotes-js)
  if grep -rqi "$keyword" "$out" 2>/dev/null; then
    ok "content assertion: found '$keyword'"
  else
    bad "content assertion: '$keyword' NOT found"; ok_target=0
  fi

  if [ "$ok_target" -eq 1 ]; then pass=$((pass+1)); SUMMARY+=("$name: PASS ($pages pages)")
  else fail=$((fail+1)); SUMMARY+=("$name: FAIL"); fi
done

note "Summary"
for s in "${SUMMARY[@]}"; do echo "   $s"; done
echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
