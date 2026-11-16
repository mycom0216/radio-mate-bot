const paths={
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
function welcomeFriends(){return `<svg class="welcome-friends" viewBox="0 0 500 400" aria-hidden="true" focusable="false">
 <defs><linearGradient id="bunny-radio" x2="0" y2="1"><stop stop-color="#f3b9ce"/><stop offset="1" stop-color="#e4a9c8"/></linearGradient></defs>
 <ellipse cx="252" cy="351" rx="171" ry="27" fill="#fffaf8"/><ellipse cx="257" cy="350" rx="116" ry="12" fill="#d9c2df" opacity=".4"/>
 <g stroke="#af8db5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
 <path d="M185 143c-18-28-40-95-15-110 30-17 47 61 49 105" fill="#fff8fb"/><path d="M184 118c-9-22-23-65-12-70 12-5 23 47 25 67" fill="#f4ccdf" stroke="none"/>
 <path d="M275 135c0-40 4-109 33-103 33 6 8 89-5 115" fill="#fff8fb"/><path d="M288 114c5-35 11-70 20-66 13 5-7 59-10 70" fill="#f4ccdf" stroke="none"/>
 <path d="M169 286c-24 1-43-8-38-22m202 15c27 5 39-7 34-21" fill="none" stroke="#c99bc0" stroke-width="13"/>
 <rect x="188" y="321" width="42" height="20" rx="10" fill="#b69cc9"/><rect x="274" y="321" width="42" height="20" rx="10" fill="#b69cc9"/>
 <path d="M291 128c-42-35-57 2-15 17-35 28-3 47 26 9 30 33 61 13 25-10 42-18 18-48-22-15Z" fill="#d68fad" stroke="#b57598" stroke-width="3"/><circle cx="300" cy="142" r="10" fill="#f8cddd" stroke="#c080a0" stroke-width="3"/><rect x="145" y="135" width="205" height="193" rx="54" fill="url(#bunny-radio)"/>
 <path d="M157 185v-15c0-91 181-91 181 0v15" fill="none" stroke="#a58abd" stroke-width="13"/>
 <path d="M168 156c5-13 21-17 39-17h37" fill="none" stroke="#fff5fa" stroke-width="5"/>
 <rect x="161" y="170" width="174" height="100" rx="34" fill="#fffafd" stroke="#c6a1c9"/>
 <rect x="135" y="174" width="24" height="65" rx="12" fill="#c6dfd4"/><rect x="338" y="174" width="24" height="65" rx="12" fill="#c6dfd4"/>
 <ellipse cx="192" cy="234" rx="14" ry="8" fill="#f2bfd2" stroke="none"/><ellipse cx="305" cy="234" rx="14" ry="8" fill="#f2bfd2" stroke="none"/>
 <ellipse cx="215" cy="215" rx="7" ry="11" fill="#77587d" stroke="none"/><ellipse cx="282" cy="215" rx="7" ry="11" fill="#77587d" stroke="none"/>
 <circle cx="213" cy="211" r="2.5" fill="#fff" stroke="none"/><circle cx="280" cy="211" r="2.5" fill="#fff" stroke="none"/>
 <path d="M238 235q5 8 11 0 5 8 11 0" fill="none" stroke="#a5759d" stroke-width="3.5"/>
 <path d="M183 297h70" stroke="#b580ad" stroke-dasharray="1 8" stroke-width="5"/>
 <circle cx="305" cy="296" r="13" fill="#fff0c6"/><path d="M300 293h10m-5-5v10" stroke="#c2a179" stroke-width="2.5"/>
 </g>
 <g stroke="#c6b3d6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
 <path d="M90 293c-25-36-6-52 13-18 8-37 33-38 25 7 52-9 62 61 17 64H97c-44-1-43-50-7-53Z" fill="#fffdf9"/>
 <path d="M97 311v5m30-5v5m-23 9q8 7 15 0" fill="none" stroke="#9c7ba9"/>
 <ellipse cx="86" cy="323" rx="7" ry="4" fill="#f0c9d4" stroke="none"/><ellipse cx="138" cy="323" rx="7" ry="4" fill="#f0c9d4" stroke="none"/>
 <path d="M144 314c-11-13-26 3 0 20 26-17 11-33 0-20Z" fill="#edb4ca" stroke="#d69ab8"/>
 </g>
 <g transform="translate(392 91) rotate(10)" stroke="#d6bb82" stroke-width="3" stroke-linejoin="round">
 <path d="m0-37 12 22 25 5-18 19 2 27L0 25l-23 11 3-27-17-19 25-5Z" fill="#fff0b9"/>
 <path d="M-10 2v4m20-4v4m-14 5q4 5 8 0" stroke="#ad8b67" stroke-width="2.5" fill="none" stroke-linecap="round"/>
 <ellipse cx="-18" cy="10" rx="5" ry="3" fill="#ecc7aa" stroke="none"/><ellipse cx="18" cy="10" rx="5" ry="3" fill="#ecc7aa" stroke="none"/>
 </g>
 <g fill="#e4bfd8"><path d="m89 115 5 13 14 5-14 5-5 14-5-14-14-5 14-5Z"/><path d="m405 267 4 10 11 4-11 4-4 11-4-11-11-4 11-4Z"/></g>
 <g fill="#b4d8c9"><circle cx="109" cy="202" r="5"/><circle cx="381" cy="217" r="6"/><circle cx="356" cy="59" r="4"/></g>
 </svg>`;}
function radioBuddy(){return `<div class="radio-buddy" aria-hidden="true"><div class="buddy-caption">오늘도 좋은 방송 ♡</div><svg viewBox="0 0 190 170" focusable="false">
  <ellipse cx="97" cy="155" rx="54" ry="6" fill="#ddd1ec" opacity=".55"/>
  <path d="m40 22 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#e9c6ad"/><path d="m157 40 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#d0bcdf"/>
  <path d="M153 14c-8-9-18 2 0 13 18-11 8-22 0-13Z" fill="#e8b9ca"/>
  <path d="M65 48C47 18 54-6 66 5c9 8 12 29 13 40m33 0c-3-26 8-47 17-40 12 9-1 31-6 45" fill="#fff6fb" stroke="#bba1ce" stroke-width="2.5"/><path d="M68 48 56 27" stroke="#ac95c4" stroke-width="5" stroke-linecap="round"/><circle cx="54" cy="24" r="5" fill="#e6c6d8" stroke="#c6aedb" stroke-width="2"/>
  <path d="M41 91c-16-4-22 10-11 14m118-10c15-4 19 8 12 12" fill="none" stroke="#c9b1df" stroke-width="8" stroke-linecap="round"/>
  <path d="M66 139v10m58-10v10" stroke="#b9a0ce" stroke-width="9" stroke-linecap="round"/>
  <rect x="40" y="49" width="111" height="95" rx="29" fill="#cbb5e5" stroke="#b29acb" stroke-width="2.5"/>
  <path d="M49 76c0-13 10-20 23-20h44" fill="none" stroke="#eadff6" stroke-width="4" stroke-linecap="round"/>
  <rect x="52" y="65" width="88" height="55" rx="18" fill="#faf6ff" stroke="#bda6d5" stroke-width="2"/>
  <ellipse cx="71" cy="99" rx="8" ry="4" fill="#f1cbd8"/><ellipse cx="121" cy="99" rx="8" ry="4" fill="#f1cbd8"/>
  <path d="M78 88v5m35-5v5" stroke="#8f76a7" stroke-width="4" stroke-linecap="round"/>
  <path d="M89 98c4 6 10 6 14 0" fill="none" stroke="#a58bb9" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M69 132h39" stroke="#ac93c4" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 5"/><circle cx="128" cy="131" r="5" fill="#f9e8d9" stroke="#b69ace" stroke-width="2"/>
  <path d="M41 78v-9c0-34 28-46 55-46s57 12 57 46v9" fill="none" stroke="#a78cc1" stroke-width="8" stroke-linecap="round"/>
  <path d="M47 65v20m100-20v20" stroke="#e2d5f1" stroke-width="11" stroke-linecap="round"/>
  <path d="m19 62 2 5 5 2-5 2-2 5-2-5-5-2 5-2Zm151 59 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#c5dfd2"/>
  </svg></div>`;}
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
