// Minimi: scatters the mascot into the page background and into any empty gap inside cards.
(() => {
  const SRC = '/radio-mini.png';
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  function makeLayer() {
    if (document.querySelector('.minimi-layer')) return;
    const layer = document.createElement('div');
    layer.className = 'minimi-layer';
    layer.setAttribute('aria-hidden', 'true');
    const cols = innerWidth < 800 ? 3 : 7, rows = innerWidth < 800 ? 6 : 5;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if ((r + c) % 2) continue;
      const img = document.createElement('img');
      img.src = SRC; img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
      const w = 30 + Math.round(rnd() * 32);
      img.style.cssText = `left:${((c + 0.15 + rnd() * 0.7) / cols * 100).toFixed(1)}%;top:${((r + 0.15 + rnd() * 0.7) / rows * 100).toFixed(1)}%;width:${w}px;--r:${Math.round(rnd() * 24 - 12)}deg;--f:${rnd() < 0.5 ? 0 : 1};animation-delay:-${(rnd() * 5).toFixed(1)}s`;
      layer.appendChild(img);
    }
    document.body.prepend(layer);
  }
  function fillGaps() {
    for (const card of document.querySelectorAll('main .card:not(.playback-panel):not(.stat-card)')) {
      card.querySelectorAll(':scope > .minimi-gap').forEach(x => x.remove());
      const box = card.getBoundingClientRect();
      if (!box.height || card.offsetParent === null) continue;
      let last = box.top;
      for (const el of card.children) {
        if (getComputedStyle(el).position === 'absolute') continue;
        last = Math.max(last, el.getBoundingClientRect().bottom);
      }
      const pad = parseFloat(getComputedStyle(card).paddingBottom) || 20;
      const free = box.bottom - pad - last;
      if (free < 46) {
        // No vertical gap: fall back to the empty space to the right of the last row.
        let row = null;
        for (const el of card.children) if (getComputedStyle(el).position !== 'absolute' && el.getBoundingClientRect().height >= 24) row = el;
        if (!row) continue;
        const rr = row.getBoundingClientRect(), range = document.createRange();
        range.selectNodeContents(row);
        const used = range.getBoundingClientRect(), room = box.right - used.right - 20;
        if (room < 72 || rr.height > 90) continue;
        const size = Math.max(40, Math.min(60, Math.round(rr.height + 12)));
        const img = document.createElement('img');
        img.className = 'minimi-gap'; img.src = SRC; img.alt = ''; img.setAttribute('aria-hidden', 'true');
        img.style.cssText = `width:${size}px;right:${22 + Math.round(rnd() * 30)}px;top:${Math.round(rr.top + rr.height / 2 - box.top - size * 0.45)}px;--r:${Math.round(rnd() * 16 - 8)}deg;--f:${rnd() < 0.5 ? 0 : 1}`;
        card.appendChild(img);
        continue;
      }
      const size = Math.min(Math.round(free - 6), 72);
      const img = document.createElement('img');
      img.className = 'minimi-gap'; img.src = SRC; img.alt = ''; img.setAttribute('aria-hidden', 'true');
      img.style.cssText = `width:${size}px;right:${16 + Math.round(rnd() * 40)}px;bottom:${Math.max(6, pad - 8)}px;--r:${Math.round(rnd() * 16 - 8)}deg;--f:${rnd() < 0.5 ? 0 : 1}`;
      card.appendChild(img);
    }
  }
  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { observer.disconnect(); fillGaps(); observe(); }, 120); };
  const observer = new MutationObserver(schedule);
  const observe = () => { const m = document.querySelector('main'); if (m) observer.observe(m, { childList: true, subtree: true }); };
  const start = () => { makeLayer(); observe(); schedule(); addEventListener('resize', schedule); };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', start) : start();
})();
