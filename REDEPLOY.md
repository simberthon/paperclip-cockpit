# Cockpit theme — durable source of truth

**This directory is the durable, version-controlled source of truth for the
Paperclip dashboard theme.** Keep it in `$HOME` (e.g. `~/coding/paperclip-theme/`),
NOT in `node_modules`, so a `brew upgrade` / `npm i -g paperclipai` cannot wipe it.
It is a git repo (theme assets only; secrets/logs/proxies are git-ignored — see
`.gitignore`).

Current version: **v26**.

> New here? Read `README.md` first — it covers the placeholders you must fill in
> (camera URL, location, brand, quota anchor) and the proxy/data wiring.

---

## The ONE supported way to (re)apply the theme

```bash
cd ~/coding/paperclip-theme       # wherever you cloned this template
./apply-theme.sh            # apply / re-apply
./apply-theme.sh --check    # verify only (exit 0 = fully applied)
```

`apply-theme.sh` is idempotent + self-healing. It atomically:
1. Copies the theme assets into the live `ui-dist/assets/`.
2. sed-substitutes `__THEME_VERSION__` into `cockpit-injector.js` and
   `cockpit-sw.js` (so the version is set in exactly one place).
3. Rewrites the entire `<!-- COCKPIT_START/END -->` block in `index.html`
   (css `<link>` + all `?v=` script tags) — placed before `</head>`, OUTSIDE
   Paperclip's `RUNTIME_BRANDING` markers (which get stripped on SPA serves).

**Single source of truth for the version** = the `THEME_VERSION="vNN"` line at the
top of `apply-theme.sh`. Nothing else holds the version.

If paperclipai is not at the Homebrew default path, override it:

```bash
NPM_GLOBAL=/usr/local/lib/node_modules ./apply-theme.sh
```

## Automatic durability (optional, recommended)

Wire a launchd agent (macOS) or cron job to run
`apply-theme.sh --check || apply-theme.sh` **hourly + on load**. Then if a
paperclipai reinstall wipes `ui-dist`, the theme self-heals within ≤1h (or
instantly on next login).

A launchd plist template is documented in `README.md`. Name it for your own
domain, e.g. `com.example.paperclip-theme.plist`, and log to a path you control.

## Shipping a NEW version (vN → vN+1)

1. Add `paperclip-cockpit-theme-vN+1.css` to this dir
   (e.g. `cat paperclip-cockpit-theme-vN.css delta.css > paperclip-cockpit-theme-vN+1.css`).
2. Edit `apply-theme.sh`: bump `THEME_VERSION="vN"` → `"vN+1"`.
3. `./apply-theme.sh` then `./apply-theme.sh --check`.
4. **Verify the SERVER, not just files** (a file can exist while the pointer
   still references the old version):
   ```bash
   curl -s localhost:3100/<PREFIX>/dashboard | grep -oE 'theme-v[0-9]+|injector.js\?v=v[0-9]+'
   # every ref must read vN+1, and ZERO refs may read the old version
   curl -s "localhost:3100/assets/cockpit-injector.js?v=vN+1" | grep 'const V'
   ```
5. `git add … && git commit`.

## Emergency remove (broken install — one command)

If the theme breaks your UI and you can't use Paperclip, run this to strip it
completely and get back to stock Paperclip immediately:

```bash
INDEX=$(npm root -g)/paperclipai/node_modules/@paperclipai/server/ui-dist/index.html
python3 -c "
import re, sys
p = '$INDEX'
with open(p) as f: h = f.read()
h = re.sub(r'[ \t]*<!-- COCKPIT_START.*?<!-- COCKPIT_END -->\n?', '', h, flags=re.DOTALL)
with open(p, 'w') as f: f.write(h)
print('Cockpit removed. Hard-refresh: Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows/Linux)')
" 2>/dev/null || python3 -c "
import re, subprocess
p = subprocess.check_output(['npm','root','-g']).decode().strip()
p += '/paperclipai/node_modules/@paperclipai/server/ui-dist/index.html'
with open(p) as f: h = f.read()
h = re.sub(r'[ \t]*<!-- COCKPIT_START.*?<!-- COCKPIT_END -->\n?', '', h, flags=re.DOTALL)
with open(p,'w') as f: f.write(h)
print('Cockpit removed. Hard-refresh your browser.')
"
```

Also unregister the service worker in your browser: **DevTools → Application → Service Workers → Unregister**, then hard-refresh (`Cmd+Shift+R`).

## Rollback (vN → vN-1)

Set `THEME_VERSION="vN-1"` in `apply-theme.sh`, run `./apply-theme.sh`. Old css
files are retained on disk + in git history, so rollback is just a version bump.

## Live deploy topology (reference)

- `paperclipai run` serves `ui-dist` as static root on **:3100**; a tunnel
  (e.g. `cloudflared`) can expose it at `__YOUR_DOMAIN__`.
- `index.html` is `Cache-Control: no-cache` (revalidates → clients pick up new
  version next load). `/assets/*` is immutable+1y, so the `?v=` query MUST bump to
  bust — `apply-theme.sh` handles that.
- A network-first SW (`/sw.js`) is offline-fallback only and does not block updates;
  the injector also `caches.delete()`s on a `const V` change.
- On an installed PWA, a hard refresh (or app relaunch) picks up the new shell.

## Deploy target (the fragile, wiped-on-reinstall location — do NOT edit by hand)

`<NPM_GLOBAL>/paperclipai/node_modules/@paperclipai/server/ui-dist/`
— only ever written by `apply-theme.sh`. Hand-editing it produces half-applied
states (one script tag bumped, everything else stale).

---

### Superseded

Any earlier "set `const V` + HREF inside the injector by hand, `cat` the css,
bump the `?v=` tags manually" procedure is **superseded** — that is now fully
automated by `apply-theme.sh` + the `THEME_VERSION` single source of truth.
Do not edit `cockpit-injector.js`'s version by hand; it carries `__THEME_VERSION__`
and is substituted at apply time.
