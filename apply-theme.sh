#!/usr/bin/env bash
# apply-theme.sh — Re-apply the full Cockpit theme to the Paperclip UI.
# Run this after: npm update -g paperclipai  (a launchd/cron job can do it hourly).
#
# Re-injects ALL cockpit components so an npm update can never strip the theme:
#   1. CSS theme stylesheet            (paperclip-cockpit-theme-<ver>.css)
#   2. Theme JS injector               (cockpit-injector.js)
#   3. Canvas grid overlay             (cockpit-canvas-grid.js)
#   4. Command Center header widget    (cockpit-command-center.js)
#   5. Boot/loading screen             (cockpit-loader.js)
#
# All are injected inside our own <!-- COCKPIT_START/END --> markers, placed
# immediately before </head> — deliberately OUTSIDE Paperclip's
# PAPERCLIP_RUNTIME_BRANDING markers (those get rewritten on every SPA serve).
# Injection is idempotent and self-healing: re-running replaces the block, strips
# legacy inline <script> blocks from earlier manual edits, and clears any cockpit
# residue wrongly left inside the RUNTIME_BRANDING region.
#
# Usage:  ./apply-theme.sh          # apply
#         ./apply-theme.sh --check  # verify only, no changes (exit 0 = applied)
#
# See README.md for the full wiring, placeholders, and proxy contract.

set -euo pipefail

# ── Single source of truth for the theme version ───────────────────────────
# Bumping this + re-running this script is the ONLY supported way to ship a new
# theme version. It atomically rewrites the entire COCKPIT block in index.html
# (marker + css <link> + all script ?v= tags) AND the injector's const V/HREF,
# so the served HTML can never end up half-applied.
THEME_VERSION="v26"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source assets in this repo dir
SRC_CSS="$SCRIPT_DIR/paperclip-cockpit-theme-${THEME_VERSION}.css"
SRC_INJECTOR="$SCRIPT_DIR/cockpit-injector.js"
SRC_GRID="$SCRIPT_DIR/cockpit-canvas-grid.js"
SRC_CMD="$SCRIPT_DIR/cockpit-command-center.js"
SRC_LOADER="$SCRIPT_DIR/cockpit-loader.js"
SRC_SW="$SCRIPT_DIR/cockpit-sw.js"

# Where paperclipai is installed. Default is the Homebrew global node_modules on
# macOS/Apple Silicon. Override via env if yours differs:
#   NPM_GLOBAL=/usr/local/lib/node_modules ./apply-theme.sh
NPM_GLOBAL="${NPM_GLOBAL:-/opt/homebrew/lib/node_modules}"
UI_DIST="$NPM_GLOBAL/paperclipai/node_modules/@paperclipai/server/ui-dist"
ASSETS="$UI_DIST/assets"
INDEX="$UI_DIST/index.html"

# Destination asset filenames (served from /assets/*)
DEST_CSS="$ASSETS/paperclip-cockpit-theme-${THEME_VERSION}.css"
DEST_INJECTOR="$ASSETS/cockpit-injector.js"
DEST_GRID="$ASSETS/cockpit-canvas-grid.js"
DEST_CMD="$ASSETS/cockpit-command-center.js"
DEST_LOADER="$ASSETS/cockpit-loader.js"
# The service worker is served from the ROOT (/sw.js), not /assets. Its CACHE_NAME
# carries THEME_VERSION so a version bump purges stale PWA shells.
DEST_SW="$UI_DIST/sw.js"

# The exact block injected immediately before </head>, inside our OWN marker
# comments. It must NOT live between Paperclip's PAPERCLIP_RUNTIME_BRANDING
# markers: @paperclipai/server's applyUiBranding() (dist/ui-branding.js) rewrites
# that region on every SPA-fallback serve (any deep-link / hard refresh), which
# silently strips anything we put there. A block before </head> survives both the
# express.static raw serve AND the branded SPA-fallback serve.
#
# /assets is served immutable with maxAge=1y, so the non-hashed JS filenames get
# a ?v=<version> cache-buster — bumping THEME_VERSION forces browsers to refetch.
# The <link> carries data-cockpit so cockpit-injector.js dedupes against it.
read -r -d '' COCKPIT_BLOCK <<HTMLEOF || true
<!-- COCKPIT_START ${THEME_VERSION} — re-injected by apply-theme.sh; edit cockpit-*.js, not index.html -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap" data-cockpit-fonts="${THEME_VERSION}" />
    <link rel="stylesheet" href="/assets/paperclip-cockpit-theme-${THEME_VERSION}.css" data-cockpit="${THEME_VERSION}" />
    <script defer src="/assets/cockpit-injector.js?v=${THEME_VERSION}"></script>
    <script defer src="/assets/cockpit-canvas-grid.js?v=${THEME_VERSION}"></script>
    <script defer src="/assets/cockpit-loader.js?v=${THEME_VERSION}"></script>
    <script defer src="/assets/cockpit-command-center.js?v=${THEME_VERSION}"></script>
    <!-- COCKPIT_END -->
HTMLEOF

# ── Pre-flight ──────────────────────────────────────────────────────────────

for f in "$SRC_CSS" "$SRC_INJECTOR" "$SRC_GRID" "$SRC_CMD" "$SRC_LOADER" "$SRC_SW"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: source asset not found: $f" >&2
    exit 1
  fi
done

if [[ ! -d "$ASSETS" ]]; then
  echo "ERROR: Paperclip ui-dist/assets not found at $ASSETS" >&2
  echo "       paperclipai may not be installed at $NPM_GLOBAL (override with NPM_GLOBAL=...)" >&2
  exit 1
fi

if [[ ! -f "$INDEX" ]]; then
  echo "ERROR: Paperclip index.html not found at $INDEX" >&2
  exit 1
fi

# ── Check mode ─────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--check" ]]; then
  rc=0
  [[ -f "$DEST_CSS" ]]      || { echo "✗ missing $DEST_CSS"; rc=1; }
  [[ -f "$DEST_INJECTOR" ]] || { echo "✗ missing $DEST_INJECTOR"; rc=1; }
  [[ -f "$DEST_GRID" ]]     || { echo "✗ missing $DEST_GRID"; rc=1; }
  [[ -f "$DEST_CMD" ]]      || { echo "✗ missing $DEST_CMD"; rc=1; }
  [[ -f "$DEST_LOADER" ]]   || { echo "✗ missing $DEST_LOADER"; rc=1; }
  [[ -f "$DEST_SW" ]]       || { echo "✗ missing $DEST_SW"; rc=1; }
  grep -q "paperclip-cockpit-${THEME_VERSION}\"" "$DEST_SW" 2>/dev/null || { echo "✗ sw.js CACHE_NAME not at ${THEME_VERSION}"; rc=1; }
  grep -q 'COCKPIT_START'             "$INDEX" || { echo "✗ index.html missing COCKPIT marker"; rc=1; }
  grep -q "paperclip-cockpit-theme-${THEME_VERSION}.css" "$INDEX" || { echo "✗ index.html missing CSS link"; rc=1; }
  grep -q 'cockpit-injector.js'       "$INDEX" || { echo "✗ index.html missing injector"; rc=1; }
  grep -q 'cockpit-canvas-grid.js'    "$INDEX" || { echo "✗ index.html missing canvas grid"; rc=1; }
  grep -q 'cockpit-command-center.js' "$INDEX" || { echo "✗ index.html missing command center"; rc=1; }
  grep -q 'cockpit-loader.js' "$INDEX" || { echo "✗ index.html missing loader"; rc=1; }
  # The cockpit must NOT live inside Paperclip's RUNTIME_BRANDING region, which
  # applyUiBranding() strips on SPA-fallback serves (regression guard).
  if python3 - "$INDEX" <<'PY'
import re, sys
h = open(sys.argv[1]).read()
m = re.search(r'RUNTIME_BRANDING_START -->(.*?)<!-- PAPERCLIP_RUNTIME_BRANDING_END', h, re.DOTALL)
sys.exit(0 if (m and 'cockpit' in m.group(1)) else 1)
PY
  then echo "✗ cockpit is inside RUNTIME_BRANDING markers — will be stripped on serve"; rc=1; fi

  if [[ $rc -eq 0 ]]; then
    echo "✓ Cockpit theme (${THEME_VERSION}) fully applied — CSS + injector + grid + loader + command bar"
  else
    echo "✗ Cockpit theme is NOT fully applied (see above)"
  fi
  exit $rc
fi

# ── Apply ──────────────────────────────────────────────────────────────────

echo "[$(date)] Applying Cockpit theme (${THEME_VERSION})"

echo "→ Copying assets to $ASSETS"
cp "$SRC_CSS" "$DEST_CSS"
# injector carries the version inline — substitute the single source of truth
sed "s/__THEME_VERSION__/${THEME_VERSION}/g" "$SRC_INJECTOR" > "$DEST_INJECTOR"
cp "$SRC_GRID" "$DEST_GRID"
cp "$SRC_CMD"  "$DEST_CMD"
cp "$SRC_LOADER" "$DEST_LOADER"
# sw.js: served from root; CACHE_NAME carries the version so a bump purges stale
# PWA shells on activate. Network-first, so it never blocks updates.
sed "s/__THEME_VERSION__/${THEME_VERSION}/g" "$SRC_SW" > "$DEST_SW"

echo "→ Injecting cockpit block into $INDEX"
INDEX="$INDEX" COCKPIT_BLOCK="$COCKPIT_BLOCK" python3 - <<'PYEOF'
import os, re

index = os.environ['INDEX']
block = os.environ['COCKPIT_BLOCK']
COCK_START = '<!-- COCKPIT_START'
COCK_END   = '<!-- COCKPIT_END -->'
BR_START   = '<!-- PAPERCLIP_RUNTIME_BRANDING_START -->'
BR_END     = '<!-- PAPERCLIP_RUNTIME_BRANDING_END -->'

with open(index, 'r') as f:
    html = f.read()

# 1. Remove our previous COCKPIT block (idempotent re-runs land here).
html = re.sub(
    r'[ \t]*' + re.escape(COCK_START) + r'.*?' + re.escape(COCK_END) + r'\n?',
    '', html, flags=re.DOTALL,
)

# 2. Strip legacy inline <script> blocks from earlier manual edits so we never
#    end up with duplicate injectors / command bars. Match on a unique comment
#    signature inside each block (none contain a nested </script>).
SIGNATURES = [
    'Cockpit theme injector',
    'canvas grid overlay',
    'Command Center',
]
script_re = re.compile(r'[ \t]*<script\b[^>]*>.*?</script>\s*', re.DOTALL | re.IGNORECASE)
html = script_re.sub(
    lambda m: '' if any(s in m.group(0) for s in SIGNATURES) else m.group(0), html,
)

# 3. Clean Paperclip's RUNTIME_BRANDING region: never let the cockpit live there,
#    where applyUiBranding() strips it on SPA-fallback serves. Reset that region
#    to empty so Paperclip's own transform is a no-op and no stray cockpit
#    <link>/<script src> survives inside it.
if BR_START in html and BR_END in html:
    pre  = html.split(BR_START, 1)[0]
    post = html.split(BR_END, 1)[1]
    html = pre + BR_START + '\n    ' + BR_END + post

# 4. Also remove any stray cockpit stylesheet <link> left loose anywhere.
html = re.sub(r'[ \t]*<link[^>]*paperclip-cockpit-theme[^>]*>\n?', '', html)

# 5. Inject our block immediately before </head> (outside all Paperclip markers),
#    so it survives both the raw express.static serve and the branded fallback.
if '</head>' not in html:
    raise SystemExit('ERROR: no </head> in index.html — cannot inject cockpit')
html = html.replace('</head>', '    ' + block + '\n  </head>', 1)

with open(index, 'w') as f:
    f.write(html)

print('  Cockpit block injected before </head> (CSS + injector + grid + loader + command bar)')
PYEOF

echo "✓ Cockpit theme (${THEME_VERSION}) applied"
echo "  Hard-refresh the browser (Cmd+Shift+R) to see changes."
