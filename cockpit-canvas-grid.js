/* Cockpit — canvas grid overlay (z-index: 99998, pointer-events:none)
 * Drifting grid + corner radial glows, drawn behind the UI. */
(function() {
  function mountGrid() {
    if (document.getElementById('cockpit-grid')) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'cockpit-grid';
    canvas.style.cssText = [
      'position:fixed','top:0','left:0','width:100%','height:100%',
      'z-index:99998','pointer-events:none','opacity:1'
    ].join(';');
    document.body.appendChild(canvas);

    const GRID = 40;
    const RED = 'rgba(252,66,57,';
    let frame = 0;

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function draw() {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      /* Drifting grid lines */
      const off = (frame * 0.3) % GRID;
      ctx.strokeStyle = RED + '0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -GRID + off; x < W + GRID; x += GRID) {
        ctx.moveTo(x, 0); ctx.lineTo(x, H);
      }
      for (let y = -GRID + off; y < H + GRID; y += GRID) {
        ctx.moveTo(0, y); ctx.lineTo(W, y);
      }
      ctx.stroke();

      /* Top-right radial glow */
      const g1 = ctx.createRadialGradient(W*0.78, 0, 0, W*0.78, 0, W*0.55);
      g1.addColorStop(0, RED + '0.09)');
      g1.addColorStop(0.4, RED + '0.07)');
      g1.addColorStop(1, RED + '0)');
      ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);

      /* Bottom-left subtle glow */
      const g2 = ctx.createRadialGradient(W*0.1, H, 0, W*0.1, H, W*0.4);
      g2.addColorStop(0, RED + '0.04)');
      g2.addColorStop(1, RED + '0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

      frame++;
      requestAnimationFrame(draw);
    }
    draw();
  }
  if (document.body) { mountGrid(); }
  else { document.addEventListener('DOMContentLoaded', mountGrid); }
})();
