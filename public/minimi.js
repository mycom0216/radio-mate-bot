// Minimi: scatters the mascot into the page background and into any empty gap inside cards.
(() => {
  const SRC = '/radio-bloom-mini.webp';
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let wallpaperSize='';
  function sticker(layer,x,y,size,rotation,flip,index){
    const img=document.createElement('img');img.src=SRC;img.alt='';img.decoding='async';
    img.style.cssText=`left:${Math.round(x)}px;top:${Math.round(y)}px;width:${size}px;--r:${rotation}deg;--f:${flip};animation-delay:-${index*.47}s`;
    layer.appendChild(img);
  }
  function makeLayer() {
    let layer=document.querySelector('.minimi-layer');
    if(!layer){layer=document.createElement('div');layer.className='minimi-layer';layer.setAttribute('aria-hidden','true');document.body.prepend(layer);}
    // Exclude the previous wallpaper from page measurement so shorter menus shrink again.
    layer.style.height='0px';
    const width=document.documentElement.clientWidth,height=Math.max(document.body.scrollHeight,innerHeight),key=width+':'+height+':'+document.querySelector('#shell')?.dataset.page+':'+document.querySelector('#login')?.hidden;
    layer.style.height=height+'px';
    if(key===wallpaperSize)return;wallpaperSize=key;layer.replaceChildren();seed=7;
    const blocked=[...document.querySelectorAll('#page-title,.header-actions,.page-description,.banner,.welcome-top,.landing-copy,.welcome-footer,footer,body>p')].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top+scrollY,bottom:r.bottom+scrollY,width:r.width,height:r.height};}).filter(r=>r.width&&r.height);
    const mobile=width<800,stepX=mobile?105:170,stepY=mobile?155:180;
    let index=0;
    for(let y=22;y<height-30&&index<150;y+=stepY)for(let x=10;x<width-25&&index<150;x+=stepX){
      const size=Math.round((mobile?25:36)+rnd()*(mobile?9:20));
      const px=Math.max(3,Math.min(width-size-4,x+((Math.round(y/stepY)%2)?stepX*.4:0)+rnd()*20));
      const py=Math.min(height-size-4,y+rnd()*40);
      if(blocked.some(r=>px<r.right+10&&px+size>r.left-10&&py<r.bottom+10&&py+size>r.top-10))continue;
      sticker(layer,px,py,size,Math.round(rnd()*24-12),rnd()<.5?0:1,index++);
    }
  }
  function fillWelcomePaper(){
    const host=document.querySelector('.welcome-home');if(!host||host.hidden)return;
    let layer=host.querySelector(':scope > .minimi-wallpaper');
    if(!layer){layer=document.createElement('div');layer.className='minimi-wallpaper';layer.setAttribute('aria-hidden','true');host.prepend(layer);}
    layer.replaceChildren();
    const box=host.getBoundingClientRect(),blocked=[];
    for(const el of host.querySelectorAll('button,a,input,.welcome-stage,.welcome-features article')){
      const r=el.getBoundingClientRect();if(r.width&&r.height)blocked.push(r);
    }
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;if(!node.textContent.trim()||node.parentElement.closest('.minimi-wallpaper'))continue;
      const range=document.createRange();range.selectNodeContents(node);
      for(const rect of range.getClientRects())if(rect.width&&rect.height)blocked.push(rect);
    }
    const mobile=box.width<700,size=mobile?30:38,stepX=mobile?75:125,stepY=mobile?100:105;
    let index=0;
    for(let y=55;y<box.height-40;y+=stepY)for(let x=18;x<box.width-size-16;x+=stepX){
      const px=x+(Math.round(y/stepY)%2)*12,py=y;
      const left=box.left+px,top=box.top+py;
      if(blocked.some(r=>left<r.right+12&&left+size>r.left-12&&top<r.bottom+12&&top+size>r.top-12))continue;
      sticker(layer,px,py,size,index%2?-9:8,index%3===0?1:0,index++);
    }
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
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { observer.disconnect(); makeLayer(); fillWelcomePaper(); fillGaps(); observe(); }, 120); };
  const observer = new MutationObserver(schedule);
  const observe = () => { const m = document.querySelector('main'); if (m) observer.observe(m, { childList: true, subtree: true }); for(const host of document.querySelectorAll('#login,#shell'))observer.observe(host,{attributes:true,attributeFilter:['hidden']}); };
  const start = () => { makeLayer(); observe(); schedule(); addEventListener('resize', schedule); document.fonts?.ready.then(schedule); };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', start) : start();
})();
