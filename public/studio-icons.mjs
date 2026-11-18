const paths={
 ai:'<path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2"/><circle cx="12" cy="12" r="5"/>',
 chat:'<path d="M21 11a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 0 1 8-12h2a8 8 0 0 1 8 8Z"/><path d="M7 9h10m-10 4h6"/>',
 lifestyle:'<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
 dashboard:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
 games:'<path d="M7 8h10c3 0 5 8 3 10-1 1-3-1-5-3H9c-2 2-4 4-5 3C2 16 4 8 7 8Z"/><path d="M7 10v4m-2-2h4m6-1h.01m3 2h.01"/>',
 shop:'<path d="M4 8h16l-1 13H5L4 8Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
 songs:'<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
 fans:'<circle cx="9" cy="8" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2m1-17a4 4 0 0 1 0 8m2 3a7 7 0 0 1 3 6"/>',
 notices:'<path d="m3 10 17-6v16L3 14v-4Z"/><path d="M8 16v4a1 1 0 0 1-2 0v-5m14-8 2-1m-2 11 2 1"/>',
 autoChat:'<path d="M21 11a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 0 1 8-12h2a8 8 0 0 1 8 8Z"/><path d="M7 9h10m-10 4h6"/>',
 voice:'<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
 records:'<rect x="4" y="3" width="16" height="19" rx="3"/><path d="M8 8h8m-8 5h8m-8 5h5"/>',
 settings:'<path d="m10 2-.6 3-2 .9-2.6-1.6L2 9l2.4 1.5v3L2 15l2.8 4.7 2.6-1.6 2 .9.6 3h4l.6-3 2-.9 2.6 1.6L22 15l-2.4-1.5v-3L22 9l-2.8-4.7-2.6 1.6-2-.9L14 2Z"/><circle cx="12" cy="12" r="3"/>',
 test:'<path d="m8 4 12 8-12 8V4Z"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3h.01"/>',
 exp:'<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z"/>',
 wave:'<path d="M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4"/>'
};
export const studioIcon=name=>`<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]||paths.dashboard}</svg>`;
export function decorateStudio(){
  document.querySelectorAll('nav button[data-page]').forEach(button=>{const label=button.querySelector('span');if(label){const icon=document.createElement('span');icon.innerHTML=studioIcon(button.dataset.page);button.replaceChildren(icon.firstChild,label);}});
  document.querySelectorAll('.brand-icon').forEach(icon=>icon.innerHTML=studioIcon('wave'));
  const headerLabel=document.querySelector('header .eyebrow');if(headerLabel)headerLabel.textContent='나의 방송 관리';
  const navLabel=document.querySelector('.nav-label');if(navLabel)navLabel.textContent='방송 메뉴';
  document.querySelectorAll('[data-welcome-icon]').forEach(el=>el.innerHTML=studioIcon(el.dataset.welcomeIcon));
  const welcome=document.querySelector('.welcome-mascot');if(welcome){welcome.innerHTML=welcomeFriends();const frame=welcome.closest('.welcome-stage');if(!frame.querySelector('.welcome-ribbon'))frame.insertAdjacentHTML('afterbegin',`<svg class="welcome-ribbon" viewBox="0 0 110 65" aria-hidden="true"><path d="M54 32C2-9-13 36 36 37L20 59l30-10 5-15 7 15 29 10-18-22c50-3 32-47-18-5Z" fill="#e8b4cc" stroke="#cc93b0" stroke-width="2.5" stroke-linejoin="round"/><path d="m15 22 31 11m49-11L64 33" stroke="#f9dbe7" stroke-width="4" stroke-linecap="round"/><rect x="45" y="23" width="20" height="20" rx="7" fill="#f5cedf" stroke="#ce99b6" stroke-width="2.5"/></svg>`);}
  for(const [selector,icon]of [['.orbit-song','songs'],['.orbit-star','exp'],['.orbit-voice','voice']]){const orbit=document.querySelector(selector);if(orbit)orbit.innerHTML=studioIcon(icon);}
  const voice=document.querySelector('.voice-compose');if(voice&&!voice.querySelector('.voice-welcome-art'))voice.insertAdjacentHTML('afterbegin',`<div class="voice-welcome-art">${radioBuddy()}</div>`);
}
function welcomeFriends(){return `<img class="radio-illustration" src="/radio-bloom.webp" alt="리본을 단 딸기우유빛 라디오가 구름 위에서 웃고 있어요" width="1024" height="1024" fetchpriority="high">`;}
function radioBuddy(){return `<div class="radio-buddy" aria-hidden="true"><img src="/radio-bloom.webp" alt="" width="1024" height="1024"><div class="buddy-caption">오늘도 다정한 방송 ♡</div></div>`;}
function pocketNote(icon){return `<svg viewBox="0 0 100 78" aria-hidden="true" focusable="false"><ellipse cx="50" cy="70" rx="29" ry="4" fill="#e9dff0"/><path d="m12 20 2 5 5 2-5 2-2 5-2-5-5-2 5-2Zm73-9 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" fill="#e4c29e"/><rect x="24" y="11" width="53" height="49" rx="11" fill="#fcf8ff" stroke="#c9b0df" stroke-width="2" transform="rotate(7 50 35)"/><g transform="translate(40 18) scale(.85)" stroke="#ae8cc5" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${paths[icon]||paths.wave}</g><path d="M18 33h64v25a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9Z" fill="#efe3f7" stroke="#c8aeda" stroke-width="2"/><path d="m19 35 25 17a11 11 0 0 0 12 0l25-17" fill="#f6eefa" stroke="#c8aeda" stroke-width="2"/><path d="M40 57v2m20-2v2m-13 1q3 4 6 0" stroke="#9e7db2" stroke-width="2.5" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="59" rx="4" ry="2" fill="#ecc4d3"/><ellipse cx="68" cy="59" rx="4" ry="2" fill="#ecc4d3"/></svg>`;}
export function decorateStats(page='dashboard'){
  document.querySelector('#shell').dataset.page=page;
  const heading=document.querySelector('#page-title');
  if(heading)heading.insertAdjacentHTML('afterbegin',`<span class="page-sticker" aria-hidden="true">${studioIcon(page)}</span>`);
  document.querySelectorAll('.stat-card>.small').forEach((label,i)=>{label.insertAdjacentHTML('afterbegin',`<span class="stat-icon">${studioIcon(['fans','exp','songs','records'][i])}</span>`);});
  const hero=document.querySelector('.dashboard-intro');if(hero){
    hero.classList.add('cute-hero');hero.querySelector('.eyebrow').textContent='우리의 작은 방송 공간';
    hero.insertAdjacentHTML('beforeend',radioBuddy()+`<div class="studio-shortcuts" aria-label="자주 쓰는 메뉴"><button data-page="songs">${studioIcon('songs')}신청곡 모아보기<span aria-hidden="true">↗</span></button><button data-page="games">${studioIcon('games')}함께 놀기 설정<span aria-hidden="true">↗</span></button><button data-page="voice">${studioIcon('voice')}음성 편지함<span aria-hidden="true">↗</span></button></div>`);
  }
  document.querySelectorAll('#content .section-head>h2').forEach(heading=>{
    const text=heading.textContent;
    const icon=/신청|재생|곡/.test(text)?'songs':/보상|기록|달성|킵/.test(text)?'records':/낚시|홀짝|룰렛|게임|도감/.test(text)?'games':/안내|인사|공지/.test(text)?'notices':/음성/.test(text)?'voice':/랭킹|청취자/.test(text)?'fans':/백업|운영|설정/.test(text)?'settings':/처음|명령어/.test(text)?'help':page;
    heading.insertAdjacentHTML('afterbegin',`<span class="section-sticker sticker-${icon}" aria-hidden="true">${studioIcon(icon)}</span>`);
  });
  document.querySelectorAll('#content .empty').forEach(el=>{
    if(el.querySelector('.empty-art'))return;
    el.classList.add('pocket-empty');
    const art=document.createElement('span');art.className='empty-art';art.setAttribute('aria-hidden','true');art.innerHTML=pocketNote(page==='dashboard'?'songs':page);
    el.prepend(art);
  });
}
