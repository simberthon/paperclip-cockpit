/* Cockpit theme injector
 * __THEME_VERSION__ is substituted by apply-theme.sh at inject time so the
 * version lives in exactly one place (apply-theme.sh THEME_VERSION). */
(async () => {
  const V = 'cockpit-__THEME_VERSION__';
  const HREF = '/assets/paperclip-cockpit-theme-__THEME_VERSION__.css';

  /* Load the display + mono webfonts here, in the injector, so the type pass
   * never falls back to whatever system fonts happen to exist.
   * Oswald = bold condensed display (headings/nav/buttons); JetBrains Mono =
   * the HUD/code face the cockpit references. display=swap avoids FOIT — text
   * shows in the fallback immediately, then swaps when loaded. */
  if (!document.querySelector('link[data-cockpit-fonts]')) {
    const pre1 = document.createElement('link');
    pre1.rel = 'preconnect'; pre1.href = 'https://fonts.googleapis.com';
    const pre2 = document.createElement('link');
    pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com'; pre2.crossOrigin = 'anonymous';
    const fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href = 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap';
    fonts.setAttribute('data-cockpit-fonts', '__THEME_VERSION__');
    document.head.appendChild(pre1);
    document.head.appendChild(pre2);
    document.head.appendChild(fonts);
  }

  /* Always inject stylesheet dynamically — bypasses any HTML link-tag loading issues */
  if (!document.querySelector('link[data-cockpit]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = HREF;
    link.setAttribute('data-cockpit', '__THEME_VERSION__');
    document.head.insertBefore(link, document.head.lastElementChild);
  }
  /* Clear SW caches on version change */
  if (localStorage.getItem('pc_theme') !== V) {
    localStorage.setItem('pc_theme', V);
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  }
})();
