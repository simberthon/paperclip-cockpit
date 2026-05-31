/* Cockpit Command Center — HUD widget (TEMPLATE)
 *
 * A fixed top bar for the Paperclip dashboard: live clock, weather, goal %,
 * Claude Max quota/reset, per-business revenue, next booking, and quick-links.
 *
 * Data sources (all free / no-cost):
 *   - Live clock          : local Date (1s)
 *   - Location + weather  : ipapi.co (IP geoloc) -> open-meteo (weather)
 *   - Goal progress %     : Paperclip /dashboard tasks (done / total)
 *   - Velocity            : Paperclip /dashboard runActivity (this 7d vs prior 7d)
 *   - Open / Running / MTD: Paperclip /dashboard aggregated across companies
 *   - Next booking        : your ical-proxy :3102 -> /assets/cockpit-booking.json
 *   - MTD revenue         : your stripe-proxy :3103 -> /assets/cockpit-revenue.json
 *   - Claude quota         : your quota scrape   -> /assets/cockpit-quota.json
 *   - Company quick-links : Paperclip /api/companies
 *
 * See README.md for the proxy contract and the *.example.json shapes you wire
 * your own data into. Refresh cadence: weather 1h, location 6h, metrics 1h.
 */
(() => {
  'use strict';

  /* ── BRAND (single config point) ──────────────────────────────────────────
   * Set `window.__COCKPIT_BRAND__ = { name, sub, boot, bookingLabel }` BEFORE
   * this script loads to rename the cockpit everywhere (header + boot screen).
   * Defaults below are placeholders — change them or the global, not the markup. */
  const BRAND = (typeof window !== 'undefined' && window.__COCKPIT_BRAND__) || {};
  const BRAND_NAME = BRAND.name || 'COCKPIT';                 /* __YOUR_BRAND_NAME__ */
  const BRAND_SUB  = BRAND.sub  || 'COMMAND CENTER';          /* __YOUR_BRAND_SUBTITLE__ */
  /* Label for the calendar cell. Generic by default — set it to whatever fits
   * your business: "NEXT BOOKING", "NEXT APPOINTMENT", "NEXT MEETING", etc. */
  const BOOKING_LABEL = BRAND.bookingLabel || 'NEXT BOOKING'; /* __YOUR_BOOKING_LABEL__ */

  /* ── Security camera link (optional) ───────────────────────────────
   * Set this to your camera/NVR web URL to show a "CAMS" button on the right.
   * Left as the placeholder below, the button is hidden. */
  const CAMERA_URL = '__YOUR_CAMERA_URL__';

  const DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const fmtDate = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const fmtUSD  = (cents) => {
    const v = cents / 100;
    return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
  };

  /* Default map location until IP geolocation resolves at runtime. Replace with
   * your own base coordinates; ipapi.co overrides this on load anyway. */
  const DEFAULT_LOCATION = { city: '__YOUR_CITY__', lat: 0, lon: 0 };
  let LOC = { ...DEFAULT_LOCATION };

  /* ── Claude Max quota (option 1: session-window timer) ────────────────────
   * The Claude Max subscription usage % is NOT API-accessible — it lives only
   * in the claude.ai browser session. So we track the 5h rolling session window
   * instead: a live countdown to the next limits reset + a bar showing how much
   * of the window has elapsed. Anchor it ONCE to any observed reset, then it
   * auto-rolls forward every 5h with no further input.
   *
   * CONFIG: set QUOTA_RESET_ANCHOR to one reset time you observe on claude.ai.
   * To re-anchor after a plan change, update this constant. */
  const QUOTA_RESET_ANCHOR_MS = Date.parse('__YOUR_QUOTA_RESET_ANCHOR_ISO__');  /* e.g. '2026-01-01T00:00:00Z' */
  const QUOTA_WINDOW_MS       = 5 * 60 * 60 * 1000;   /* 5h rolling */

  /* Quota % can be ESTIMATED from Paperclip run volume when no live scrape is
   * available — token usage is not exposed by any API in subscription mode.
   * The estimate is windowed to the CURRENT 5h session so it resets to ~0 at
   * each session boundary, mirroring claude.ai:
   *   windowRuns = runs since this session window started (localStorage baseline)
   *   quota%     = windowRuns / MAX20X_SESSION_RUN_BUDGET
   * CONFIG: tune the budget below until the estimate matches your real %. */
  const MAX20X_SESSION_RUN_BUDGET = 150;

  /* ── REAL Claude Max usage (optional) ─────────────────────────────────────
   * Token usage is not API-exposed, so an hourly job can scrape your
   * claude.ai/settings/usage page and write the REAL session % + reset to
   * /assets/cockpit-quota.json (same-origin, see cockpit-quota.example.json).
   * When that file is present + FRESH we show the real number and drive the
   * RESET cell from the real value; otherwise we fall back to the run-volume
   * estimate above and the rolling anchor — the cockpit never blanks.
   * Fresh = scraped within 95min (tolerates one missed hourly run). */
  const QUOTA_FILE_FRESH_MS = 95 * 60 * 1000;
  let quotaIsLive = false;   /* true → QUOTA shows real %, run-volume estimate suppressed */
  let realResetMs = null;    /* real reset epoch ms from the scrape, or null → use anchor */

  /* ── build widget DOM ─────────────────────────────────────── */
  function buildWidget() {
    if (document.getElementById('cockpit-command-header')) return;

    const camHasUrl = CAMERA_URL && CAMERA_URL !== '__YOUR_CAMERA_URL__';
    const camHtml = camHasUrl
      ? `<a class="cmd-cam" href="${CAMERA_URL}" target="_blank" rel="noopener" title="Security cameras (live)">
           <span class="cmd-cam-ico">📹</span><span class="cmd-cam-label">CAMS</span><span class="cmd-cam-dot"></span>
         </a>
         <span class="cmd-sep cmd-sep-links"></span>`
      : '';

    const bar = document.createElement('div');
    bar.id = 'cockpit-command-header';
    bar.innerHTML = `
      <!-- ░░ LEFT zone — identity + system data ░░ -->
      <div class="cmd-zone cmd-zone-left">
        <span class="cmd-brand">
          <span class="cmd-brand-mark">◤</span>
          <span class="cmd-brand-text"><span class="cmd-brand-name">${BRAND_NAME}</span><span class="cmd-brand-sub">${BRAND_SUB}</span></span>
          <span class="cmd-live"><span class="cmd-live-dot"></span>LIVE</span>
        </span>

        <span class="cmd-sep"></span>
        <span class="cmd-block">
          <span class="cmd-time" id="cmd-time">--:--:--</span>
          <span class="cmd-date" id="cmd-date"></span>
        </span>

        <span class="cmd-sep"></span>
        <span class="cmd-block">
          <span class="cmd-weather" id="cmd-weather">⌀ —</span>
          <span class="cmd-loc" id="cmd-loc">📍 locating…</span>
        </span>

        <span class="cmd-sep"></span>
        <span class="cmd-stat" title="Goal completion across all companies">
          <span class="cmd-stat-top"><span class="cmd-stat-ico">🎯</span><span class="cmd-stat-label">GOAL</span><span class="cmd-stat-val" id="cmd-goal">—</span></span>
          <span class="cmd-bar"><span class="cmd-bar-fill" id="cmd-goal-bar"></span></span>
        </span>

        <span class="cmd-sep"></span>
        <span class="cmd-stat cmd-quota" id="cmd-quota-cell" title="Estimated Claude Max session quota used this window — based on Paperclip run volume. Tune the calibration constant if it drifts from your real %.">
          <span class="cmd-stat-top"><span class="cmd-stat-ico">🔋</span><span class="cmd-stat-label">QUOTA</span><span class="cmd-stat-val" id="cmd-quota-pct">~—</span></span>
          <span class="cmd-bar"><span class="cmd-bar-fill cmd-quota-fill" id="cmd-quota-bar"></span></span>
        </span>

        <span class="cmd-sep"></span>
        <span class="cmd-stat" id="cmd-reset-cell" title="Time until your Claude Max session limits reset — 5h rolling window">
          <span class="cmd-stat-top"><span class="cmd-stat-ico">⏱</span><span class="cmd-stat-label">CLAUDE RESET</span></span>
          <span class="cmd-stat-val" id="cmd-reset-left">—</span>
        </span>

        <!-- weekly limits (all models + Sonnet), real %+reset from the quota scrape -->
        <span class="cmd-sep"></span>
        <span class="cmd-stat cmd-quota" id="cmd-wkall-cell" title="Weekly Claude Max usage across all models — real %, from the quota scrape. Resets weekly.">
          <span class="cmd-stat-top"><span class="cmd-stat-ico">📊</span><span class="cmd-stat-label">WK ALL</span><span class="cmd-stat-val" id="cmd-wkall-val">—</span></span>
          <span class="cmd-bar"><span class="cmd-bar-fill cmd-quota-fill" id="cmd-wkall-bar"></span></span>
        </span>

        <span class="cmd-sep"></span>
        <span class="cmd-stat cmd-quota" id="cmd-wksonnet-cell" title="Weekly Claude Max usage for Sonnet only — real %, from the quota scrape. Resets weekly.">
          <span class="cmd-stat-top"><span class="cmd-stat-ico">🎵</span><span class="cmd-stat-label">WK SONNET</span><span class="cmd-stat-val" id="cmd-wksonnet-val">—</span></span>
          <span class="cmd-bar"><span class="cmd-bar-fill cmd-quota-fill" id="cmd-wksonnet-bar"></span></span>
        </span>

        <span class="cmd-sep"></span>
        <span class="cmd-stat" id="cmd-quota-upd-cell" title="When the Claude usage numbers were last refreshed">
          <span class="cmd-stat-top"><span class="cmd-stat-ico">🕒</span><span class="cmd-stat-label">UPDATED</span></span>
          <span class="cmd-stat-val" id="cmd-quota-upd">—</span>
        </span>
      </div>

      <!-- ░░ CENTER zone — business ░░ -->
      <div class="cmd-zone cmd-zone-center">
        <span class="cmd-rev" title="Stripe month-to-date revenue per business — live, converted to USD, refreshed hourly">
          <span class="cmd-stat-top"><span class="cmd-stat-ico">💰</span><span class="cmd-stat-label">MTD REVENUE</span></span>
          <span class="cmd-rev-totals" id="cmd-rev-totals"></span>
          <span class="cmd-rev-chips" id="cmd-rev-chips"><span class="cmd-rev-empty">—</span></span>
        </span>

        <span class="cmd-sep"></span>
        <span class="cmd-stat cmd-stat-next" title="Your next calendar item">
          <span class="cmd-stat-top"><span class="cmd-stat-ico">📅</span><span class="cmd-stat-label">${BOOKING_LABEL}</span></span>
          <span class="cmd-stat-val" id="cmd-booking">—</span>
        </span>
      </div>

      <!-- ░░ RIGHT zone — links + cameras ░░ -->
      <div class="cmd-zone cmd-zone-right">
        ${camHtml}
        <span class="cmd-links" id="cmd-links"></span>
      </div>
    `;
    document.body.prepend(bar);

    const tick = () => {
      const now = new Date();
      const t = document.getElementById('cmd-time');
      const d = document.getElementById('cmd-date');
      if (t) t.textContent = fmtTime(now);
      if (d) d.textContent = fmtDate(now);
    };
    tick();
    setInterval(tick, 1000);

    updateReset();
    setInterval(updateReset, 30 * 1000);  /* live countdown, 30s granularity */
  }

  /* ── RESET: live countdown to the next Claude Max session reset (time only) ── */
  function nextResetMs() {
    const now = Date.now();
    /* prefer the REAL reset time from the quota scrape; only fall back to the
     * rolling hardcoded anchor when no fresh scrape is available. */
    if (realResetMs && realResetMs > now) return realResetMs;
    let reset = QUOTA_RESET_ANCHOR_MS;
    if (isNaN(reset)) return now;           /* anchor not configured yet */
    if (reset <= now) reset += Math.ceil((now - reset) / QUOTA_WINDOW_MS) * QUOTA_WINDOW_MS;
    return reset;
  }
  function updateReset() {
    const leftEl = document.getElementById('cmd-reset-left');
    const cell   = document.getElementById('cmd-reset-cell');
    if (!leftEl) return;
    const reset = nextResetMs();
    const mins  = Math.round((reset - Date.now()) / 60000);
    leftEl.textContent = mins >= 60
      ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
      : `${mins}m`;
    if (cell) {
      const at = new Date(reset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      cell.title = `Claude Max session limits reset at ${at} (in ${leftEl.textContent}) — 5h rolling window.`;
    }
  }

  /* ── keep body padding-top in sync with the REAL header height ──
   * On mobile the header wraps onto multiple lines (auto height), so a fixed
   * --command-bar-height would overlap content. Measure the rendered height and
   * push it into the CSS var on load / resize / content change. */
  function syncBarHeight() {
    const bar = document.getElementById('cockpit-command-header');
    if (!bar) return;
    if (bar.style.display === 'none') return;        /* hidden on /auth */
    /* Write to a SEPARATE padding var, not --command-bar-height. The header's own
     * height is set from --command-bar-height in CSS, so writing the measured
     * height back to it would be circular (locks the bar, never shrinks). The
     * body padding tracks the real (possibly multi-row) height instead. */
    const h = Math.round(bar.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--cmd-bar-pad', h + 'px');
  }

  /* ── QUOTA: estimated % used, from Paperclip run volume (set in refreshMetrics) ── */
  function setQuotaPct(pct, real) {
    const pctEl = document.getElementById('cmd-quota-pct');
    const barEl = document.getElementById('cmd-quota-bar');
    /* real scrape → exact "NN%"; run-volume estimate → "~NN%" (tilde = approximate). */
    if (pctEl) pctEl.textContent = real ? `${pct}%` : `~${pct}%`;
    if (barEl) {
      barEl.style.width = Math.min(100, pct) + '%';
      barEl.classList.toggle('cmd-quota-hot', pct > 80);
      barEl.classList.toggle('cmd-quota-warn', pct > 60 && pct <= 80);
    }
  }

  /* ── weekly limit cells (all models / Sonnet) — "NN% · Sat 17:00" ──
   * Bars are hidden at ≤480px (CSS), so the % + reset live in the text value too,
   * keeping both blocks fully legible on mobile. */
  function fmtWeeklyReset(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    return new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function setWeeklyCell(valId, barId, pct, resetIso) {
    const valEl = document.getElementById(valId);
    const barEl = document.getElementById(barId);
    if (typeof pct !== 'number') { if (valEl) valEl.textContent = '—'; return; }
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const reset = fmtWeeklyReset(resetIso);
    if (valEl) valEl.textContent = reset ? `${p}% · ${reset}` : `${p}%`;
    if (barEl) {
      barEl.style.width = p + '%';
      barEl.classList.toggle('cmd-quota-hot', p > 80);
      barEl.classList.toggle('cmd-quota-warn', p > 60 && p <= 80);
    }
  }
  function clearWeeklyCells() {
    for (const id of ['cmd-wkall-val', 'cmd-wksonnet-val', 'cmd-quota-upd']) {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    }
    for (const id of ['cmd-wkall-bar', 'cmd-wksonnet-bar']) {
      const el = document.getElementById(id);
      if (el) el.style.width = '0%';
    }
  }
  function fmtUpdated(ts) {
    if (typeof ts !== 'number') return '—';
    const ageMin = Math.round((Date.now() - ts) / 60000);
    if (ageMin <= 0) return 'just now';
    if (ageMin < 60) return `${ageMin}m ago`;
    const h = Math.floor(ageMin / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }

  /* ── hide the cockpit bar on the Paperclip login/auth screen ──
   * Keep the bar, just don't render it on the auth page.
   * SPA-safe: re-check on nav + interval. */
  function syncAuthVisibility() {
    const bar = document.getElementById('cockpit-command-header');
    if (!bar) return;
    const onAuth = /^\/auth\b/.test(location.pathname) || location.pathname === '/login';
    /* header CSS sets `display:flex !important`, so inline display loses unless we
     * also use !important priority. */
    if (onAuth) {
      bar.style.setProperty('display', 'none', 'important');
      document.documentElement.style.setProperty('--cmd-bar-pad', '0px');
    } else {
      bar.style.removeProperty('display');
      syncBarHeight();   /* set body padding to the real (possibly multi-row) height */
    }
  }

  /* ── dynamic location (IP geolocation) ────────────────────── */
  async function fetchLocation() {
    try {
      const r = await fetch('https://ipapi.co/json/');
      if (!r.ok) return;
      const d = await r.json();
      if (d && d.latitude && d.longitude) {
        LOC = { city: d.city || 'Unknown', lat: d.latitude, lon: d.longitude };
        const el = document.getElementById('cmd-loc');
        if (el) el.textContent = `📍 ${LOC.city}`;
      }
    } catch { /* keep default location */ }
  }

  /* ── weather (open-meteo, location-driven) ────────────────── */
  const WMO = {
    0:'☀ Clear', 1:'🌤 Clear', 2:'⛅ Cloudy', 3:'☁ Overcast',
    45:'🌫 Fog', 48:'🌫 Fog',
    51:'🌦 Drizzle', 53:'🌦 Drizzle', 55:'🌦 Drizzle',
    61:'🌧 Rain', 63:'🌧 Rain', 65:'🌧 Heavy rain',
    71:'❄ Snow', 73:'❄ Snow', 75:'❄ Snow',
    80:'🌦 Showers', 81:'🌧 Showers', 82:'⛈ Showers',
    95:'⛈ Storm', 96:'⛈ Storm', 99:'⛈ Storm'
  };
  async function fetchWeather() {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${LOC.lat}&longitude=${LOC.lon}&current=temperature_2m,weathercode&forecast_days=1`;
      const r = await fetch(url);
      if (!r.ok) return;
      const d = await r.json();
      const temp = Math.round(d.current?.temperature_2m ?? 0);
      const code = d.current?.weathercode ?? -1;
      const el = document.getElementById('cmd-weather');
      if (el) el.textContent = `${WMO[code] || '⌀'} ${temp}°C`;
    } catch { /* offline — skip */ }
  }

  /* Fetch cockpit data SAME-ORIGIN first (snapshot JSON served from /assets,
   * reachable from any device), then fall back to the localhost proxy (works
   * when the cockpit is opened directly on the host machine). The 127.0.0.1
   * proxies are unreachable from a remote browser, which is why same-origin
   * must come first. cache-buster `?t=` defeats the immutable /assets cache so
   * the snapshot stays fresh. */
  async function fetchCockpitData(jsonPath, proxyUrl) {
    try {
      const r = await fetch(`${jsonPath}?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch { /* fall through to proxy */ }
    try {
      const r = await fetch(proxyUrl);
      if (r.ok) return await r.json();
    } catch { /* both unavailable */ }
    return null;
  }

  /* ── REAL Claude Max quota + reset (optional scrape) ───────────────────────
   * Read the hourly scrape (same-origin JSON, so it works from a remote
   * browser). When the file is ok + fresh + has a numeric session %, drive the
   * QUOTA cell (real %) and the CLAUDE RESET countdown (real reset time) from it.
   * On stale / missing / too-old / malformed, leave quotaIsLive=false so the
   * run-volume estimate and rolling anchor take over — the cockpit never blanks.
   * Shape: see cockpit-quota.example.json. */
  async function fetchQuota() {
    quotaIsLive = false;
    realResetMs = null;
    clearWeeklyCells();   /* don't show last-cycle weekly numbers if the scrape went stale */
    let d = null;
    try {
      const r = await fetch(`/assets/cockpit-quota.json?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) d = await r.json();
    } catch { /* missing → estimate fallback */ }

    if (!d || d.ok !== true || d.stale === true) return;
    if (typeof d.ts === 'number' && Date.now() - d.ts > QUOTA_FILE_FRESH_MS) return;  // too old
    if (typeof d.sessionPct !== 'number') return;

    quotaIsLive = true;
    setQuotaPct(Math.max(0, Math.min(100, Math.round(d.sessionPct))), true);

    /* weekly limits (all models + Sonnet) + last-updated stamp. */
    setWeeklyCell('cmd-wkall-val', 'cmd-wkall-bar', d.weeklyAllPct, d.weeklyAllResetAtIso);
    setWeeklyCell('cmd-wksonnet-val', 'cmd-wksonnet-bar', d.weeklySonnetPct, d.weeklySonnetResetAtIso);
    const updEl = document.getElementById('cmd-quota-upd');
    if (updEl) updEl.textContent = fmtUpdated(d.ts);
    const cell = document.getElementById('cmd-quota-cell');
    if (cell) cell.title =
      `Real Claude Max session usage: ${d.sessionPct}% used — scraped hourly from claude.ai/settings/usage`;

    /* real reset: prefer the absolute timestamp, else (scrape ts + minutes-left) */
    if (d.resetAtIso) {
      const t = Date.parse(d.resetAtIso);
      if (!isNaN(t)) realResetMs = t;
    } else if (typeof d.resetInMin === 'number' && typeof d.ts === 'number') {
      realResetMs = d.ts + d.resetInMin * 60000;
    }
    updateReset();   /* reflect the real reset immediately, before the 30s tick */
  }

  /* ── next booking (ical-proxy → cockpit-booking.json) ──
   * Shows the client name + time (+ room when present). Real clients only —
   * the proxy already filters out blocks/holds/empty placeholders.
   * Shape: see cockpit-booking.example.json. */
  async function fetchBooking() {
    const el = document.getElementById('cmd-booking');
    if (!el) return;
    try {
      const d = await fetchCockpitData('/assets/cockpit-booking.json', 'http://127.0.0.1:3102/booking');
      if (!d) throw 0;
      const b = d && d.booking;
      if (b && b.client) {
        const room = b.room ? ` · ${b.room}` : '';
        el.innerHTML =
          `<span class="cmd-book-client">${b.client}</span>` +
          `<span class="cmd-book-when">${b.when || ''} ${b.time || ''}${room}</span>`;
        el.title = `Next booking: ${b.client} — ${b.dateLabel || ''} ${b.time || ''}` +
                   (b.room ? ` (${b.room})` : '');
      } else if (b && b.label) {           // back-compat alternate shape
        el.textContent = b.label;
        el.title = 'Next booking: ' + (b.title || 'booking');
      } else {
        el.textContent = '—';
        el.title = 'No upcoming client booking';
      }
    } catch { el.textContent = '—'; }
  }

  /* ── Stripe MTD revenue per business (stripe-proxy → cockpit-revenue.json) ──
   * Renders one chip per business with its live MTD revenue in USD.
   * Shape: see cockpit-revenue.example.json. */
  const REV_ORDER = ['BIZ1', 'BIZ2', 'BIZ3'];   /* __YOUR_BUSINESS_CODES__ — display order in the revenue strip */
  /* Your ownership share per business — the single source of truth for the
   * "PI PROFIT" (personal profit) ownership-weighted total. 1.00 = 100%.
   * Add one entry per business code you wire up in cockpit-revenue.json.
   * The 1.0 fallback below is a safety net so a brand-new, unweighted code never
   * silently drops out of the figure — it surfaces at 100% until you set its real %. */
  const REV_WEIGHTS = { BIZ1: 1.00, BIZ2: 1.00, BIZ3: 1.00 };   /* __YOUR_OWNERSHIP_WEIGHTS__ */
  const fmtRevUSD = (usd) =>
    usd >= 1000 ? `$${(usd / 1000).toFixed(1)}k` : `$${Math.round(usd)}`;
  async function fetchRevenue() {
    const el = document.getElementById('cmd-rev-chips');
    const totEl = document.getElementById('cmd-rev-totals');
    if (!el) return;
    try {
      const d = await fetchCockpitData('/assets/cockpit-revenue.json', 'http://127.0.0.1:3103/revenue');
      if (!d) throw 0;
      const accts = (d && d.accounts) || {};
      const codes = Object.keys(accts).sort(
        (a, b) => REV_ORDER.indexOf(a) - REV_ORDER.indexOf(b)
      );
      if (!codes.length) {
        el.innerHTML = '<span class="cmd-rev-empty">—</span>';
        if (totEl) totEl.innerHTML = '';
        return;
      }
      el.innerHTML = codes.map((code) => {
        const a = accts[code] || {};
        const val = a.usd == null ? '—' : fmtRevUSD(a.usd);
        const stale = a.stale ? ' cmd-rev-stale' : '';
        const tip = a.usd == null
          ? `${a.name || code}: unavailable`
          : `${a.name || code}: $${a.usd} MTD (${a.charges || 0} charges)`;
        return `<span class="cmd-rev-chip${stale}" data-code="${code}" title="${tip}">` +
               `<span class="cmd-rev-code">${code}</span>` +
               `<span class="cmd-rev-val">${val}</span></span>`;
      }).join('');

      /* gross + ownership-weighted totals, sitting ABOVE the chips.
       * Skip null/unavailable businesses so we never render NaN / $undefined. */
      let gross = 0, weighted = 0, anyVal = false;
      codes.forEach((code) => {
        const usd = accts[code] && accts[code].usd;
        if (usd == null || isNaN(usd)) return;
        anyVal = true;
        gross += usd;
        const w = REV_WEIGHTS[code] != null ? REV_WEIGHTS[code] : 1;
        weighted += usd * w;
      });
      if (totEl) {
        if (!anyVal) {
          totEl.innerHTML = '';
        } else {
          /* weighted tooltip carries BOTH figures, so when the gross cell is
           * hidden on narrow screens (≤480px) no information is lost. */
          const wTip = `PI PROFIT (personal profit, ownership-weighted): ${fmtRevUSD(weighted)} · `
                     + `gross top-line: ${fmtRevUSD(gross)}`;
          totEl.innerHTML =
            `<span class="cmd-rev-total" title="Gross MTD — full top-line revenue across all businesses">` +
              `<span class="cmd-rev-tcode">TOTAL</span><span class="cmd-rev-tval">${fmtRevUSD(gross)}</span>` +
            `</span>` +
            `<span class="cmd-rev-total cmd-rev-total-w" title="${wTip}">` +
              `<span class="cmd-rev-tcode">PI PROFIT</span><span class="cmd-rev-tval">${fmtRevUSD(weighted)}</span>` +
            `</span>`;
        }
      }
    } catch {
      el.innerHTML = '<span class="cmd-rev-empty">—</span>';
      if (totEl) totEl.innerHTML = '';
    }
  }

  /* ── Paperclip metrics + goal % + velocity ────────────────── */
  async function jget(url) {
    try { const r = await fetch(url); return r.ok ? await r.json() : null; }
    catch { return null; }
  }

  async function refreshMetrics() {
    /* try the real scrape first so the estimate below only fills the gap. */
    await fetchQuota();

    const companies = await jget('/api/companies');
    if (!companies || !companies.length) return;

    /* company quick-links (once) */
    const linksEl = document.getElementById('cmd-links');
    if (linksEl && !linksEl.dataset.built) {
      linksEl.dataset.built = '1';
      companies.forEach(c => {
        const a = document.createElement('a');
        a.className = 'cmd-company-link';
        a.href = `/${c.issuePrefix}/dashboard`;
        a.textContent = c.issuePrefix;
        a.title = c.name;
        linksEl.appendChild(a);
      });
    }

    const dashboards = await Promise.all(companies.map(c => jget(`/api/companies/${c.id}/dashboard`)));
    let open = 0, running = 0, spend = 0, done = 0, total = 0, active = 0;
    let veloThis = 0, veloPrev = 0, todayRuns = 0;
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const d of dashboards) {
      if (!d) continue;
      open    += d.tasks?.open       ?? 0;
      running += d.agents?.running    ?? 0;
      active  += d.agents?.active     ?? 0;
      spend   += d.costs?.monthSpendCents ?? 0;
      done    += d.tasks?.done        ?? 0;
      total   += (d.tasks?.open ?? 0) + (d.tasks?.inProgress ?? 0) +
                 (d.tasks?.blocked ?? 0) + (d.tasks?.done ?? 0);

      /* velocity: succeeded runs, last 7 days vs prior 7 days; + today's total runs */
      const act = d.runActivity || [];
      const n = act.length;
      for (let i = 0; i < n; i++) {
        const s = act[i].succeeded ?? 0;
        if (i >= n - 7) veloThis += s;
        else if (i >= n - 14) veloPrev += s;
        if (act[i].date === todayStr) todayRuns += act[i].total ?? 0;
      }
    }

    /* QUOTA estimate: count runs SINCE the current 5h session window started, so
     * it resets to ~0 at each session boundary (like claude.ai). We baseline
     * today's run total at the window start in localStorage, then track the delta. */
    const reset = nextResetMs();
    const winStart = reset - QUOTA_WINDOW_MS;
    let store = {};
    try { store = JSON.parse(localStorage.getItem('cockpit-quota-window') || '{}'); } catch {}
    if (store.winStart !== winStart) {
      store = { winStart, baseline: todayRuns };        /* new session → rebaseline */
      try { localStorage.setItem('cockpit-quota-window', JSON.stringify(store)); } catch {}
    }
    let windowRuns = todayRuns - (store.baseline ?? todayRuns);
    if (windowRuns < 0) {                               /* midnight bucket rollover */
      store.baseline = todayRuns; windowRuns = 0;
      try { localStorage.setItem('cockpit-quota-window', JSON.stringify(store)); } catch {}
    }
    const quotaPct = Math.min(99, Math.round((windowRuns / MAX20X_SESSION_RUN_BUDGET) * 100));
    /* only show the estimate when the real scrape isn't live this cycle. */
    if (!quotaIsLive) setQuotaPct(quotaPct);

    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('cmd-open', open);
    set('cmd-running', running);
    set('cmd-agents-active', active);
    set('cmd-spend', fmtUSD(spend));

    /* goal % */
    const pct = total ? Math.round((done / total) * 100) : 0;
    set('cmd-goal', pct + '%');
    const barEl = document.getElementById('cmd-goal-bar');
    if (barEl) barEl.style.width = pct + '%';

    /* velocity ▲▼ */
    const veloEl = document.getElementById('cmd-velo');
    if (veloEl) {
      const delta = veloThis - veloPrev;
      const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '▬';
      const cls   = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
      veloEl.innerHTML = `${veloThis} <span class="cmd-velo-delta ${cls}">${arrow}${Math.abs(delta)}</span>`;
    }
  }

  /* ── bootstrap ────────────────────────────────────────────── */
  async function boot() {
    buildWidget();
    syncAuthVisibility();
    syncBarHeight();

    /* SPA-safe auth-page detection: patch history + poll as a fallback */
    ['pushState', 'replaceState'].forEach((m) => {
      const orig = history[m];
      history[m] = function (...a) { const r = orig.apply(this, a); syncAuthVisibility(); syncBarHeight(); return r; };
    });
    window.addEventListener('popstate', () => { syncAuthVisibility(); syncBarHeight(); });
    setInterval(syncAuthVisibility, 1500);

    /* keep body padding == real (possibly multi-row) header height */
    window.addEventListener('resize', syncBarHeight);
    const bar = document.getElementById('cockpit-command-header');
    if (bar && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(syncBarHeight).observe(bar);   /* fires when cells wrap / data loads */
    }

    await fetchLocation();        /* resolve location first… */
    fetchWeather();               /* …then weather for that location */
    fetchBooking();
    fetchRevenue();
    refreshMetrics();

    setInterval(fetchLocation,  6 * 60 * 60 * 1000);  /* 6h */
    setInterval(fetchWeather,   1 * 60 * 60 * 1000);  /* 1h */
    setInterval(fetchBooking,   30 * 60 * 1000);      /* 30m */
    setInterval(fetchRevenue,   1 * 60 * 60 * 1000);  /* 1h */
    setInterval(refreshMetrics, 1 * 60 * 60 * 1000);  /* 1h */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
