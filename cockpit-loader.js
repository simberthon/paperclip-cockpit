/* Cockpit — boot/loading screen HUD
 * Black bg + red radial glow, brand mark, "● INITIALIZING…" with pulsing dot,
 * a filling progress bar, 3 mono readouts, footer caption — then fades out.
 *
 * Shows on every full document load (fresh load / hard refresh), NOT on SPA
 * route changes — the defer script only runs once per page parse, so in-app
 * navigation never replays it.
 * Brief (~1.7s) so it never gets in the way. Mobile-viable: centered + responsive.
 */
(() => {
  'use strict';

  /* BRAND (single config point) — shared with cockpit-command-center.js. Set
   * `window.__COCKPIT_BRAND__ = { name, sub, boot }` BEFORE this script loads
   * to rename the boot screen. Defaults below are placeholders. */
  const BRAND = (typeof window !== 'undefined' && window.__COCKPIT_BRAND__) || {};
  const B_NAME = BRAND.name || 'COCKPIT';              /* __YOUR_BRAND_NAME__ */
  const B_SUB  = BRAND.sub  || 'COMMAND CENTER';       /* __YOUR_BRAND_SUBTITLE__ */
  const B_BOOT = BRAND.boot || 'COCKPIT BOOT SEQUENCE';/* __YOUR_BOOT_CAPTION__ */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const B_SUB_HTML = esc(B_SUB).replace(/ /g, '&nbsp;');

  /* guard against double-mount within a single page load only */
  if (document.getElementById('cockpit-boot')) return;

  const el = document.createElement('div');
  el.id = 'cockpit-boot';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="cockpit-boot-glow"></div>
    <div class="cockpit-boot-grid"></div>
    <div class="cockpit-boot-core">
      <div class="cockpit-boot-brand" style="animation-delay:0s">
        <span class="cockpit-boot-mark">◤</span>
        <span class="cockpit-boot-name">${esc(B_NAME)}</span>
        <span class="cockpit-boot-sub">${B_SUB_HTML}</span>
      </div>

      <div class="cockpit-boot-status" style="animation-delay:.1s">
        <span class="cockpit-boot-dot"></span> INITIALIZING ${esc(B_SUB)}
      </div>

      <div class="cockpit-boot-bar" style="animation-delay:.2s">
        <span class="cockpit-boot-fill"></span>
      </div>

      <div class="cockpit-boot-readouts" style="animation-delay:.3s">
        <div><span class="k">SYS</span> <span class="v">ONLINE</span></div>
        <div><span class="k">NET</span> <span class="v">SECURE</span></div>
        <div><span class="k">BOOT</span> <span class="v" id="cockpit-boot-ms">0.00s</span></div>
      </div>

      <div class="cockpit-boot-foot" style="animation-delay:.4s">
        ${esc(B_BOOT)} · v1.0
      </div>
    </div>
  `;

  const mount = () => {
    (document.body || document.documentElement).appendChild(el);

    /* live boot timer */
    const msEl = document.getElementById('cockpit-boot-ms');
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (!msEl) return;
      msEl.textContent = ((Date.now() - t0) / 1000).toFixed(2) + 's';
    }, 60);

    /* fade out after the fill completes (~1.2s) + a beat */
    setTimeout(() => {
      clearInterval(timer);
      el.classList.add('cockpit-boot-out');
      setTimeout(() => el.remove(), 600);
    }, 1650);
  };

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
