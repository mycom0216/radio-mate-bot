import {mountCommunity} from './community.mjs';
import {spoonChargeUrl} from './spoon-charge.mjs';
import {affinityScore} from './affinity.mjs';
import {temperatureLabel,temperatureReceivedTime,temperatureRank} from './affinity.mjs';
import {operationsPanel,runtimeSummary} from './operations-ui.mjs';
import {levelProgress,commandWait,suppressionMessage,parseTestHistory,sharedSettingsAction} from './studio-state.mjs';
import {decorateStudio,decorateStats,studioIcon} from './studio-icons.mjs';
import {createExtraUI} from './extra-ui.mjs';
import {Playback} from './playback.mjs';
import {YouTubePlayer} from './youtube-player.mjs';
import {PlaybackPosition} from './playback-position.mjs';
import {groupKeeps,songVideoId,keepExpiryLabel} from './song-utils.mjs';
import {requestJSON} from './request-json.mjs';
import {diagnosticsHTML} from './diagnostics-ui.mjs';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),num=v=>Number(v||0).toLocaleString('ko-KR');
let session,room,page=location.pathname==='/player'?'songs':'dashboard',chats=[],toastTimer,dirty=false,savedRoom,busy=false;
let voiceInbox=null,historyRoom=null,navigationVersion=0,diagnostics=null;
function persistHistory(){if(historyRoom)try{sessionStorage.setItem('studio-test:'+historyRoom,JSON.stringify({chats,identity:testIdentity}));}catch{}}
function restoreHistory(id){if(historyRoom===id)return;historyRoom=id;try{const data=parseTestHistory(sessionStorage.getItem('studio-test:'+id));chats=data?.chats||[];if(data?.identity)testIdentity=data.identity;}catch{chats=[];}}
const filters={fans:'',records:'',help:''};
let testIdentity={user:'listener-1',name:'청취자1',dj:false};
const titles={ai:'AI와 다정한 대화',chat:'방송 채팅방',lifestyle:'날씨 · 여행 · 교통',dashboard:'방송 대시보드',games:'게임 설정',shop:'아이템 상점',songs:'신청곡 관리',fans:'청취자 · 팬랭킹',notices:'공지 · 자동 안내',records:'기록 · 보상 관리',settings:'운영 · 백업',autoChat:'자동채팅',voice:'음성메시지 수신함',test:'명령어 테스트',help:'명령어 안내'};
const rarities=['일반','고급','희귀','영웅','전설'];
async function api(path,data){return requestJSON(path,data,{csrf:session?.csrf||'',timeoutMs:(path.startsWith('/api/test')||path.startsWith('/api/ai-talk')||path.startsWith('/api/lifestyle'))?30000:15000,onUnauthorized:()=>{if($('#session-alert'))$('#session-alert').hidden=false;}});}
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function card(title,body,extra=''){return `<section class="card"><div class="section-head"><h2>${title}</h2>${extra}</div>${body}</section>`;}
function toggle(key,label,value=room.settings[key]){return `<label class="switch"><input type="checkbox" data-setting="${key}" ${value?'checked':''}>${label}</label>`;}
function field(label,key,value=room.settings[key],type='number',hint=''){return `<label class="field">${label}<input data-field="${key}" type="${type}" value="${esc(value)}">${hint?`<span class="small">${hint}</span>`:''}</label>`;}
function empty(t){return `<div class="empty">${t}</div>`;}
function screenCapturePanel(){const config=room.screenCapture,enabled=config&&config.expiresAt>Date.now();return card('후원 순간 실제 방송 화면 캡처',`<p>기준 스푼(기본 300스푼) 이상 후원 이벤트를 수신하면 PC Chrome·Edge 확장 기능이 선택한 스푼 방송 탭의 보이는 영역을 즉시부터 1초 간격으로 최대 5장 연속 PNG로 저장해 후원 모션 전후 화면을 담습니다. 결제 영수증이나 생성 이미지가 아닌 실제 화면입니다.</p><p class="small">1. <a href="/extensions/donation-capture.zip" download>캡처 확장 ZIP 다운로드</a> 후 압축을 풀고 브라우저 확장 관리 화면에서 개발자 모드 → 압축해제된 확장 로드로 설치하세요.<br>2. 아래에서 연결 정보를 발급·복사한 뒤, PC 스푼 방송 탭에서 확장 아이콘을 누르고 붙여넣으세요.<br>3. 대상 DJ 방송인지 확인하고 연결 → 5장 연속 테스트 캡처를 누른 뒤 방송 탭을 활성 상태로 유지하세요.</p><p>대상 DJ: <strong>${esc(room.name)}</strong> · ${enabled?'후원 감지 연결 발급됨 · '+new Date(config.expiresAt).toLocaleString('ko-KR')+'까지':'연결 정보 미발급 또는 만료'}</p>${captureStatusHtml(room.captureStatus,Date.now())}${field('캡처할 후원 기준 (스푼 이상, 한 번에)','screenCaptureMin')}<p class="small">후원 한 건이 이 스푼 이상일 때만 캡처합니다. 기본 300스푼이며, 더 작은 후원은 캡처하지 않습니다. 값을 바꾼 뒤 아래 저장을 눌러 주세요.</p>${saveButton()}<div class="actions"><button data-action="capture-issue" ${room.id==='demo'?'disabled':''}>캡처 연결 정보 발급</button><button data-action="capture-revoke" ${room.id==='demo'?'disabled':''}>서버 연결 해제</button></div><label class="field">확장 기능에 붙여넣을 연결 정보<textarea id="capture-setup" rows="4" readonly placeholder="연결 정보를 발급하면 표시됩니다. 다른 사람에게 공유하지 마세요."></textarea></label><button data-action="capture-copy">연결 정보 복사</button><p class="small">12시간 유효하며 발급할 때 이전 연결은 해제됩니다. 확장 기능이 찍은 PNG는 그 PC의 다운로드/RadioMate-Captures에 저장하고, 서버 업로드가 켜져 있으면 이 서버에도 보관합니다(확장 버전 1.2.0 이상). 서버에 보관된 캡처는 아래에서 태블릿·폰을 포함한 어떤 기기에서든 내려받을 수 있습니다. 다른 탭·최소화·10초 지난 후원은 건너뜁니다. 브라우저·탭을 닫으면 캡처가 중지됩니다. 후원 모션을 인식하는 방식이 아닌 약 4초간 연속 화면 저장입니다. 모션이 늦거나 꺼져 있으면 포함되지 않을 수 있습니다. 기존 확장은 ZIP을 다시 받아 교체하고 확장 관리 화면에서 새로고침 후 방송 탭에 재연결하세요(버전 1.2.0). 모바일 스푼 앱의 자동 화면 캡처는 지원하지 않습니다(태블릿·폰의 스푼 앱 화면은 직접 찍을 수 없고, 방송을 PC 브라우저로 보고 있는 곳에 확장 기능을 설치해야 합니다). 충전·결제 정보는 수집하지 않고 DJ에게 전달된 후원을 감지합니다.</p>`)+card('서버에 보관된 후원 캡처',`<p class="small">확장 기능이 올린 캡처를 이 서버가 돌아가는 PC에 보관합니다(방마다 최근 30일·1000장). 사진 아래 <b>저장</b>을 누르면 지금 보고 있는 기기(태블릿·폰은 갤러리/다운로드)에 내려받습니다. 후원 한 건의 5장은 <b>ZIP</b>으로 한 번에 받을 수 있어요.</p><div class="actions"><button data-action="capture-files-refresh">상태·목록 새로고침</button><button data-action="capture-files-clear">서버 캡처 모두 지우기</button></div><div id="capture-files" class="capture-files" aria-live="polite"><p class="small">불러오는 중…</p></div>`);}
// 캡처가 안 될 때 어디서 막혔는지 보여 주는 진단: 확장이 서버에 마지막으로 접속한 때와, 마지막으로 받은 후원이 캡처 대상이 되었는지(아니면 이유)를 표시합니다.
// (서버를 다시 시작하면 초기화되는 값입니다)
function captureStatusHtml(status,now){
  if(!status)return '';
  const ago=ms=>{const sec=Math.max(0,Math.round((now-ms)/1000));return sec<10?'방금':sec<60?sec+'초 전':sec<3600?Math.floor(sec/60)+'분 전':Math.floor(sec/3600)+'시간 전';};
  const connection=!status.enabled?'캡처 연결이 없거나 만료되었습니다. 아래에서 연결 정보를 발급해 확장 프로그램에 붙여넣으세요.':status.lastPollAt?(now-status.lastPollAt<=15000?`연결 중 (${ago(status.lastPollAt)} 확인)`:`${ago(status.lastPollAt)}부터 확인하지 않았습니다 — 방송 탭이 닫혔거나 확장이 멈췄을 수 있어요. 방송 탭에서 다시 연결하세요.`):'확장 프로그램이 아직 서버에 접속하지 않았습니다. (서버를 다시 시작했거나 방송 탭에 연결하지 않았습니다)';
  const last=status.lastDonation,reasons={recorded:'캡처 대상으로 기록됨 — 연결된 확장이 곧바로 가져가 5장을 찍습니다','below-min':`기준(${num(last?.min)}스푼)에 못 미쳐 캡처하지 않음`,'not-connected':'캡처 연결이 없거나 만료되어 기록하지 않음 — 연결 정보를 다시 발급하세요','bad-user':'후원 알림에 후원자 정보가 없어 기록하지 못함','bad-amount':'후원 알림의 스푼 수를 읽지 못해 기록하지 못함',stale:'후원 시각이 2분 넘게 어긋나 기록하지 않음',duplicate:'이미 기록된 후원이라 다시 기록하지 않음'};
  const donation=last?`${ago(last.at)} · ${esc(last.nickname)} · ${last.amount===null?'?':num(last.amount)}스푼 → ${reasons[last.result]||esc(last.result)}`:'서버를 다시 시작한 뒤 받은 후원이 없습니다.';
  return `<div class="capture-status" role="status"><p><strong>확장 연결</strong>: ${connection}</p><p><strong>마지막 후원</strong>: ${donation}</p>${status.stored?`<p class="small">서버에 보관된 캡처 ${num(status.stored.count)}장</p>`:''}</div>`;
}
// 서버에 보관된 캡처 목록을 후원 한 건씩 묶어 보여 줍니다. 이미지는 로그인 쿠키로만 열리는 주소를 쓰고, 저장 버튼은 download 속성으로 기기에 내려받습니다.
function captureFilesHtml(data){
  const files=data?.files||[];if(!files.length)return '<p class="small">아직 서버에 보관된 캡처가 없습니다. 확장 기능을 연결하고 기준 스푼 이상 후원이 오면 여기에 나타납니다.</p>';
  const groups=new Map();for(const file of files){if(!groups.has(file.eventId))groups.set(file.eventId,[]);groups.get(file.eventId).push(file);}
  for(const frames of groups.values())frames.sort((x,y)=>x.frame-y.frame); // 한 후원의 장은 번호 순서로
  const mb=bytes=>(bytes/1048576).toFixed(1)+'MB',time=ms=>new Date(ms).toLocaleString('ko-KR',{hour12:false});
  const usage=data.usage?`<p class="small">보관 중 ${num(data.usage.count)}장 · ${mb(data.usage.bytes)}</p>`:'';
  return usage+[...groups.entries()].map(([eventId,frames])=>{const first=frames[0];return `<article class="capture-event"><h3>${esc(first.nickname)} · ${num(first.amount)}스푼${first.amount===0?' (테스트)':''}</h3><p class="small">${esc(time(first.time))} · ${frames.length}장</p><div class="capture-grid">${frames.map(file=>`<figure><a href="/api/screen-capture/files/${file.id}" target="_blank" rel="noopener"><img src="/api/screen-capture/files/${file.id}" alt="${esc(first.nickname)} ${num(first.amount)}스푼 후원 ${file.frame}번째 화면" loading="lazy" width="160"></a><figcaption>${file.frame}번째 · ${mb(file.size)}<br><a class="button" href="/api/screen-capture/files/${file.id}?download=1" download>저장</a> <button data-action="capture-file-delete" data-id="${file.id}">삭제</button></figcaption></figure>`).join('')}</div><div class="actions"><a class="button" href="/api/screen-capture/zip/${encodeURIComponent(eventId)}" download>${frames.length}장 ZIP으로 저장</a></div></article>`;}).join('');
}
async function loadCaptureFiles(){const box=$('#capture-files');if(!box||room.id==='demo')return;try{const data=await requestJSON('/api/screen-capture/files',undefined,{csrf:session?.csrf||'',timeoutMs:15000});if($('#capture-files'))$('#capture-files').innerHTML=captureFilesHtml(data);}catch(error){if($('#capture-files'))$('#capture-files').innerHTML='<p class="small">캡처 목록을 불러오지 못했습니다: '+esc(error.message)+'</p>';}}

function saveButton(){return '<div class="actions"><button class="primary" data-action="save">설정 저장</button><span class="small">저장 전 기존 설정은 자동 백업됩니다.</span></div>';}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
function render(){
 if($('#shared-settings-status'))$('#shared-settings-status').textContent=room.name+' · 방송 설정 v'+(room.settingsRevision||0)+' · 같은 DJ 계정의 PC·모바일 공유 (약 4초마다 확인)';
 $('#page-title').textContent=titles[page];$('#connection').textContent=room.connection;$('#demo-banner').hidden=room.id!=='demo';document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 const users=Object.values(room.users),s=room.settings;
 let html='';
 if(page==='dashboard'){
  const stats=[['등록 청취자',users.length,'방송별 독립 프로필'],['누적 애청지수',num(users.reduce((a,u)=>a+affinityScore(u),0)),'청취 시간 + 시간별 채팅 참여'],['대기 신청곡',room.songs.length,'1인 연속 최대 2곡'],['보상 확인 대기',room.special.filter(x=>['pending','policy-pending'].includes(x.status)).length,'전설 물고기 · 황금주사위']];
  const waiting=room.special.filter(x=>['pending','policy-pending'].includes(x.status)).length;
  html=`<div class="dashboard-intro"><div><span class="eyebrow">MY BROADCAST</span><h2>${esc(room.name)}</h2><p>${room.id==='demo'?'테스트 공간입니다. 실제 방송에는 전송되지 않아요.':'방송 상태와 자주 쓰는 기능을 한곳에서 관리하세요.'}</p></div><button data-page="${room.id==='demo'?'test':'settings'}" class="primary">${room.id==='demo'?'명령어 테스트하기 →':'방송 연결 관리 →'}</button></div>
  ${card('방송 중에도 봇 호출',`<p>이 DJ 방송에 봇을 연결하거나 다른 DJ에게 호출 링크를 보내세요. 처음 연결하는 DJ는 본인 계정으로 동의해야 합니다.</p><div class="actions"><button data-action="reconnect" class="primary">내 방송에 봇 호출</button><button data-action="copy-invite">다른 DJ 호출 링크 복사</button><button data-action="copy-bot-call">로그인 없는 내 방송 호출 링크</button><a href="/mobile">휴대폰 연결 →</a><a href="/invite" target="_blank" rel="noopener">호출 안내 열기 ↗</a></div>`)}
  <div class="grid stats">${stats.map(([l,v,n],i)=>`<button class="card stat-card" data-page="${['fans','fans','songs','records'][i]}"><span class="small">${l}</span><div class="stat-value">${v}</div><span class="stat-note">${n} <span aria-hidden="true">↗</span></span></button>`).join('')}</div>
  <div class="grid two"><div class="stack">${card('방송 빠른 설정',`<p class="small">스위치를 바꾼 후 저장해 주세요.</p><div class="line"><div><strong>조용 모드</strong><div class="small">게임 명령과 자동 안내 응답을 잠시 멈춥니다.</div></div>${toggle('quiet','조용 모드')}</div><div class="line"><strong>낚시 게임</strong>${toggle('fishing','낚시')}</div><div class="line"><strong>홀짝 게임</strong>${toggle('odd','홀짝')}</div><div class="line"><strong>신청곡 접수</strong>${toggle('requests','신청곡 접수')}</div>${saveButton()}`)}
  ${card('신청곡 대기열',(room.current?`<span class="pill">현재곡</span><h3 class="current-song">${esc(room.current.title)}</h3><p class="small">${esc(room.current.name)}님의 신청곡</p>`:empty('현재 재생 중인 곡이 없습니다.'))+(room.songs.length?`<p>다음 곡: <strong>${esc(room.songs[0].title)}</strong></p>`:''),'<button data-page="songs">대기열 관리 →</button>')}</div>
  <div class="stack">${card('운영 체크',`<div class="check-row"><span class="status-dot ${s.quiet?'warning':''}"></span><div><strong>${s.quiet?'조용 모드가 켜져 있어요':'게임 응답이 가능한 상태예요'}</strong><p class="small">${s.quiet?'게임과 자동 안내를 다시 시작하려면 조용 모드를 꺼 주세요.':'각 게임을 켜고 저장하면 청취자가 이용할 수 있어요.'}</p></div></div><div class="check-row"><span class="status-dot ${waiting?'warning':''}"></span><div><strong>확인 대기 보상 ${waiting}건</strong><p class="small">전설 물고기와 황금주사위 보상을 확인하세요.</p></div><button data-page="records">확인</button></div><div class="check-row"><span class="status-dot"></span><div><strong>명령어 대기 ${s.cooldown}초</strong><p class="small">방송 전체 응답 간격은 ${s.responseGap}초입니다.</p></div><button data-page="settings">변경</button></div>`)}
  ${card('처음 사용하는 분께',`<ol class="steps"><li><span>1</span><div><strong>명령어를 먼저 확인하세요</strong><p>청취자가 쓰는 명령과 DJ 전용 명령을 모았습니다.</p><button data-page="help">명령어 안내 →</button></div></li><li><span>2</span><div><strong>게임과 보상 정책을 정하세요</strong><p>게임은 기본 OFF입니다. 물고기와 황금주사위 정책을 확인하세요.</p><button data-page="games">게임 설정 →</button></div></li></ol>`)}
  <details class="card"><summary>일일 한도와 미확정 정책</summary><p class="small">낚시 20만 EXP·20만 PT / 홀짝 당첨 이익 50만 PT / 전체 게임 보상 100만 PT</p><ul class="list">${s.pending.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></details></div></div>`;

 }
 if(page==='games')html=`<div class="grid two">${card('낚시',`${toggle('fishing','낚시 사용')}${fishingWhoField()}<p class="small">1회 60 EXP · 2배 적용 시 120 EXP / 하루 최대 20만 EXP</p><p class="small">낚시 행운 보너스는 고급 이상 물고기(황금주사위 제외)의 확률을 (1 + 보너스%)배로 늘려 PT를 더 많이 주는 물고기가 자주 나오게 합니다. 0이면 보너스 없음. ${fishOddsLine()}</p><div class="fields">${field('꽝 확률 (%)','miss')}${field('낚시 행운 보너스 (%)','fishingLuck')}${field('명령어 대기시간 (초)','cooldown')}</div><label class="field">물고기 보상 방식<select data-field="payout"><option value="random" ${s.payout==='random'?'selected':''}>범위 내 무작위 (임시 기본값)</option><option value="fixed" ${s.payout==='fixed'?'selected':''}>물고기 최소 PT를 고정 단가로 사용</option></select></label><label class="field">황금주사위 한도 정책<select data-field="goldenPolicy"><option value="pending" ${s.goldenPolicy==='pending'?'selected':''}>미정 — 자동으로 굴리고 보상은 보류</option><option value="fishing" ${s.goldenPolicy==='fishing'?'selected':''}>낚시 20만 + 전체 100만 한도 적용</option><option value="special" ${s.goldenPolicy==='special'?'selected':''}>전체 100만 한도만 적용</option></select></label><div class="note">꽝은 현재 EXP만 지급합니다. 확률 UP 사용 시 낚시 성공 중 희귀 이상 70%·미만 30%로 배분합니다.</div>`)}${card('홀짝',`${toggle('odd','홀짝 사용')}<p class="small">!홀 20000 / !짝 20000 · 성공 시 원금 포함 2배 반환</p><div class="fields">${field('최소 베팅 PT (임시)','betMin')}${field('최대 베팅 PT (임시)','betMax')}</div><div class="line"><span>기본 확률</span><strong>홀 50% · 짝 50%</strong></div><div class="line"><span>아이템 적용</span><strong>홀 65% · 짝 35%</strong></div><div class="note">일일 한도는 원금 제외 당첨 이익의 합계입니다. 패배해도 누적 이익은 줄지 않습니다. 남은 한도보다 큰 베팅은 차단합니다.</div><p class="small">미니게임 주사위는 별도로 켤 수 있으며 PT·EXP 정산은 없습니다. 황금주사위를 낚으면 보상 주사위가 자동으로 굴러갑니다.</p>`)}</div><div class="card" style="margin-top:20px"><div class="section-head"><h2>물고기 도감 설정</h2><button data-action="add-fish">+ 물고기 추가</button></div><p class="small">기본 목록·가중치는 예시입니다. 일반/고급/희귀/영웅/전설 PT 범위는 합의한 범위로 검증됩니다.</p>${fishTable()}${saveButton()}</div>`;
 if(page==='games')html+=roulettePanel()+battlePanel()+lotteryRewardPanel()+card('청취 시간 · 복권 자동 지급',`${toggle('listenRewards','청취 자동 보상 사용')}${toggle('affinityNotices','자체 애청지수 상승 안내 (5분 간격)')}${field('복권 지급 간격 (분)','listenMinutes')}${field('매회 지급 복권 (장)','listenTickets')}${field('하루 지급 한도 (장)','listenDailyCap')}<p class="small">5분마다 증가분과 누적 자체 지수를 점수로 안내합니다. 공식 온도는 !애청온도 또는 !온도로 조회합니다. 복권 일일 한도 도달 후에도 상승 안내는 계속합니다. 1분 간격 청취자 목록으로 접속 시간을 추정합니다. 확인된 청취 1분마다 애청지수 1점, 매시간 첫 채팅에 5점이 쌓이며 스푼 공식 애청온도와는 별개입니다. 서버 중단·목록 확인 실패 시간은 적립하지 않습니다.</p><p class="small">${esc(room.listeningStatus||'listeners.read 권한으로 스푼 연결이 필요합니다.')}</p>${saveButton()}`);
 if(page==='games')html=extraUI.miniGames(s)+html;
 if(page==='shop')html=`<p class="muted">경험치는 쌓이고, 포인트는 즐거움이 됩니다. 모든 효과는 20분간 개인에게 적용돼요.</p><div class="grid three">${s.items.map((i,index)=>card(i.name,`<div class="item-icon">${['♧','×2','◐'][index]}</div><p class="small">${['낚시 성공 시 희귀 등급 이상 70%. 꽝 확률 유지.','낚싯대 던지기 60 → 120 EXP. 일일 한도 유지.','홀짝 결과를 홀 65% · 짝 35%로 적용.'][index]}</p>${field('가격 (PT)',`item-${i.id}`,i.price)}<label class="switch"><input data-item-enabled="${i.id}" type="checkbox" ${i.enabled?'checked':''}>판매 중</label><div class="line"><span>지속시간</span><strong>20분</strong></div>`)).join('')}</div><div class="note">같은 효과 재사용 시 배율 대신 시간이 연장됩니다. ${s.pauseItems?'관련 게임 OFF·조용 모드·방송 미연결 동안 아이템 시간이 일시정지됩니다.':'현재 설정에서는 게임 OFF·방송 종료 중에도 시간이 흐릅니다. 운영 설정에서 일시정지를 켤 수 있습니다.'} 홀짝 EXP 2배는 EXP 획득 경로와 맞지 않아 미제공 상태입니다.</div>${saveButton()}`;
 if(page==='songs')html=`<div class="grid two">${card('신청곡 접수',`${toggle('requests','신청곡 받기')}<div class="line"><strong>연속 신청</strong><span>같은 청취자 최대 2곡</span></div><p class="small">다른 청취자의 신청이 들어오면 다시 신청할 수 있습니다.</p>${toggle('duplicateSongs','같은 곡 중복 허용')}${field('1인당 대기열 보유 한도 (임시)','requestMax')}${saveButton()}`)}${card('현재 재생 중',room.current?`<h2>${esc(room.current.title)}</h2><p class="small">신청: ${esc(room.current.name)}</p><button data-link-song="${esc(room.current.id)}">영상 연결·변경</button> <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(room.current.title)}" target="_blank" rel="noopener noreferrer">YouTube 검색 ↗</a>`:empty('현재곡이 없습니다.'),`<button data-action="song-finish" ${room.current?'':'disabled'}>완료</button>`)}</div><div class="card" style="margin-top:20px"><div class="section-head"><h2>신청곡 대기열 <span class="count">${room.songs.length}</span></h2><button class="primary" data-action="song-next" ${room.songs.length?'':'disabled'}>다음 곡을 현재곡으로 →</button></div>${room.songs.length?table(['순서','곡명','신청자','관리'],room.songs.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.title)}<br><span class="small">${songVideoId(x)?'YouTube 재생 가능':'제목 검색 또는 영상 링크 연결 필요'}</span></td><td>${esc(x.name)}</td><td><div class="queue-actions"><button class="primary" data-play-song="${esc(x.id)}">이 곡 재생</button><button data-link-song="${esc(x.id)}">영상 연결</button><a href="https://www.youtube.com/results?search_query=${encodeURIComponent(x.title)}" target="_blank" rel="noopener noreferrer">YouTube 검색 ↗</a><button data-move-song="${esc(x.id)}" data-direction="-1" aria-label="${esc(x.title)} 위로" ${i===0?'disabled':''}>↑</button><button data-move-song="${esc(x.id)}" data-direction="1" aria-label="${esc(x.title)} 아래로" ${i===room.songs.length-1?'disabled':''}>↓</button><button data-remove-song="${esc(x.id)}">삭제</button></div></td></tr>`)):empty('신청곡이 들어오면 여기에 표시됩니다.')}${room.songUndo&&room.songUndo.expires>Date.now()?'<div class="note">마지막으로 삭제한 곡을 5분 이내에 복원할 수 있습니다. 대기열이 바뀌면 취소됩니다. <button data-action="song-undo">삭제 되돌리기</button></div>':''}<p class="small">이전곡: ${esc(room.previous?.title||'이전에 재생한 곡이 없습니다.')} </p><p class="small">DJ의 !이전곡·!다음곡은 재생할 곡을 선택합니다. !재생으로 시작하고 !멈춤으로 정지합니다. !삭제 → 번호 입력 또는 !삭제 2로 삭제합니다. !이전곡 삭제·!다음곡 삭제 뒤에는 가수·곡명을 입력하세요. 청취자는 곡 정보만 조회합니다. YouTube 링크는 !신청곡 https://youtu.be/영상ID 형식으로 신청할 수 있습니다. 재생 시작은 상단 플레이어를 사용하세요. 제목만 신청한 곡은 영상 연결 버튼으로 링크를 붙여넣으세요. 서버에 YouTube 검색 키가 있으면 제목을 자동 검색합니다.</p></div>`;
 if(page==='songs')html+=card('완료된 신청곡',room.songHistory?.length?table(['곡명','신청자','완료 시각','관리'],room.songHistory.map(song=>`<tr><td>${esc(song.title)}</td><td>${esc(song.name)}</td><td>${new Date(song.completedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</td><td><button data-remove-song="${esc(song.id)}">삭제</button></td></tr>`)):empty('재생이 끝나거나 다른 곡으로 넘어가면 완료 목록에 남습니다.'));
 if(page==='fans'){
  const sorted=temperatureRank(room.users);
  html=djRankPanel()+card('공식 온도 수신 안내','<p>스푼이 입장 이벤트로 제공한 애청온도를 그대로 표시합니다. 입장 후 변동이 계속 갱신되는 값은 아니며, 수신한 온도가 높은 순서로 표시합니다(스푼 공식 랭킹 아님). 미수신·미제공은 0도로 간주하지 않습니다. events.presence 권한과 봇 매니저 지정이 필요합니다. !애청온도 · !온도로 본인 값을 확인할 수 있습니다.</p>')+searchBox('fans','닉네임 또는 고유 ID 검색')+card('청취자 · 스푼 애청온도',sorted.length?table(['표시 순서','청취자 / ID','스푼 애청온도 · 마지막 입장값','자체 애청지수','레벨','EXP','PT','복권'],sorted.map((u,i)=>`<tr data-search="${esc(u.name+' '+u.id)}"><td>${i+1}</td><td>${esc(u.name)}<br><span class="small mono">${esc(u.id)}</span></td><td>${esc(temperatureLabel(u))}<br><span class="small">${temperatureReceivedTime(u)?'수신 '+esc(temperatureReceivedTime(u)):'입장 이벤트 미수신'}</span></td><td>${num(affinityScore(u))}점<br><span class="small">청취 ${Math.floor((u.listeningMs||0)/60000)}분 · 채팅 ${u.chatAffinityPoints||0}점</span></td><td><strong>Lv.${Math.floor(u.exp/s.levelStep)+1}</strong><progress class="exp-progress compact" value="${u.exp%s.levelStep}" max="${s.levelStep}" aria-label="${esc(u.name)} 레벨 진행도"></progress></td><td>${num(u.exp)}</td><td>${num(u.pt)}</td><td>${num(u.tickets)}</td></tr>`)):empty('!내정보를 입력하면 청취자 프로필이 자동으로 만들어집니다.'));
  html+=`<div class="grid two" style="margin-top:20px">${card('DJ 수동 지급 · 회수',`<p class="small">수동 PT 지급은 일일 획득 한도 집계에서 제외됩니다. 복권은 양수로 지급, 음수로 회수하며 0은 변경하지 않습니다. 정수로 입력하세요. 전체 지급은 복권만, 1~1,000장 범위의 양수만 가능합니다.</p><form id="grant-form"><label class="field">닉네임·ID·연결한 @스푼아이디·이메일 (입력 시 우선 사용)<input name="target" maxlength="254" autocomplete="off" placeholder="@닉네임 일부 또는 연결한 @스푼아이디·이메일"></label>${userSelect(users)}<label class="field">종류<select name="kind"><option value="pt">PT</option><option value="tickets">복권</option></select></label><label class="field">수량<input name="amount" type="number" required></label><label class="field">사유<input name="reason" required maxlength="200"></label><label class="switch"><input type="checkbox" name="all">등록된 청취자 전체에게 복권 지급 (체크하면 위의 청취자 선택은 무시됩니다)</label><button class="primary" ${users.length?'':'disabled'}>지급 / 회수</button></form>`)}${card('보유 킵 관리',`<p class="small">유효기간: ${keepExpiryLabel()} · 다음 달 1일 00:00 초기화. 같은 보상은 수량으로 정리하며 사용 완료·취소 내역은 아래에 보관합니다. 청취자도 !킵 사용 번호 / !킵 취소로 이용할 수 있습니다.</p><form id="keep-form">${userSelect(users)}<label class="field">보상 이름<input name="text" required maxlength="100"></label><button ${users.length?'':'disabled'}>킵 등록</button></form><div style="margin-top:15px">${users.flatMap(u=>groupKeeps(u.keeps).map(k=>`<div class="line"><span>${esc(u.name)} · ${esc(k.name)} <strong>×${k.count}</strong></span><button data-keep-user="${esc(u.id)}" data-keep-name="${esc(k.name)}" data-keep-count="${k.count}">1개 사용</button></div>`)).join('')||empty('보유 중인 킵이 없습니다.')}</div>`)}</div>`;
 }
 if(page==='fans')html+=card('계정 ID·이메일 비공개 연결',`<p class="small">스푼 공식 API는 이메일·계정 태그를 제공하지 않습니다. DJ가 확인한 정보를 한 번 연결하면 닉네임·ID·등록한 이메일로 지급할 수 있습니다. 이메일은 원문을 저장하거나 표시하지 않습니다. 채팅에 개인정보를 입력하기보다는 이 관리 화면에서 지급하세요.</p><form id="identity-form">${userSelect(users)}<label class="field">추가 계정 ID<input name="alias" maxlength="100" autocomplete="off"></label><label class="field">연결할 이메일<input name="email" type="email" maxlength="254" autocomplete="off"></label><div class="actions"><button class="primary" type="submit" value="set">비공개 연결 저장</button><button type="submit" value="clear">선택 청취자 연결 해제</button></div></form><p class="small">${users.map(user=>`${esc(user.name)}: ${user.accountAlias?'ID 연결 ':''}${user.emailAlias?'이메일 연결됨':''}`).filter(line=>/연결/.test(line)).join(' / ')||'아직 연결한 정보가 없습니다.'}</p>`)+keepHistoryPanel(users);
 if(page==='notices')html=card('스푼 충전 안내 · !스푼',`${field('충전 안내 문구 (최종 응답 200자 이내)','spoonNotice',s.spoonNotice,'text')}<p><a href="${spoonChargeUrl(session.chargeRegion||'kr')}" target="_blank" rel="noopener noreferrer" class="charge-link">공식 스푼 충전창 열기 ↗</a></p><p class="small">!스푼 입력 시 안내와 공식 충전 링크를 함께 보냅니다. 청취자·DJ 모두 링크를 눌러 이동할 수 있습니다. 봇이 모바일 앱이나 웹 화면을 자동으로 열거나 /스푼을 대신 실행하지는 않습니다. 할인 조건·최종 결제 금액은 공식 화면에서 확인하세요.</p>${saveButton()}`)+card('프로그램 소개 · 10분 자동 안내',`${toggle('introEnabled','프로그램 소개 안내 사용')}${field('소개 멘트 (200자 이내)','introText',s.introText,'text')}<p class="small">방송 연결 후 10분부터 전송합니다. 조용 모드·방송 종료 시 보내지 않으며, 전송 성공 시점부터 다음 10분을 계산합니다.</p>${saveButton()}`)+card('좋아요 자동 인사',`${toggle('likeGreetingEnabled','무료 좋아요 인사 사용')}${field('인사 문구 — {name}, {amount} 사용 가능','likeGreeting',s.likeGreeting,'text')}<p class="small">같은 청취자에게 10분에 한 번 인사합니다. 조용 모드와 전체 응답 간격을 지키며, 실제 연동에는 events.like 권한으로 스푼 계정 재연결이 필요합니다.</p>${saveButton()}`)+`<div class="grid two">${card('방송 안내',`${field('!공지 문구','notice',s.notice,'text')}${field('입장 인사 — {name} 사용 가능','welcome',s.welcome,'text')}${field('후원 반응 — {name}, {amount} 사용 가능','donation',s.donation,'text')}<p class="small">입장 인사는 봇 매니저 지정이 필요합니다. 방송 연결 중 같은 청취자의 재입장은 중복 환영하지 않습니다.</p>`)}${card('플레이리스트 공지 초안',`${toggle('playlistMode','플레이리스트 모드')}${field('방송 제목','playlistTitle',s.playlistTitle,'text')}<button data-action="draft">현재 설정으로 공지 초안 만들기</button><label class="field" style="margin-top:15px">생성된 초안<textarea id="draft" rows="4" placeholder="제목과 신청곡 접수 여부로 안내 문구를 만듭니다."></textarea></label><button data-action="add-draft">초안을 10분 자동 안내로 추가</button>`)}</div>${menuBoardPanel()}${donationDonorTicketPanel()}${donationTicketPanel()}${donationExpPanel()}<div class="card" style="margin-top:20px"><div class="section-head"><h2>자동 안내</h2><button data-action="add-notice">+ 안내 추가</button></div>${noticeTable()}${saveButton()}</div>`;
 if(page==='records'){
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),ach=room.achievers.filter(a=>a.day===today);
  html=searchBox('records','청취자, 기록 종류, 내역 검색')+`<div class="grid two">${card('오늘의 100만 PT 달성자',ach.length?ach.map((a,i)=>`<div class="line"><span>${i+1}. ${esc(a.name)}</span><span class="small">${new Date(a.time).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})}</span></div>`).join(''):empty('아직 달성자가 없습니다.'))}${card('전설 특별 보상 · 확인 대기',room.special.filter(x=>['pending','policy-pending'].includes(x.status)).map(x=>`<div class="line"><div><strong>${esc(x.name)} (@${esc(x.user)}) · ${esc(x.fish)}</strong><div class="small">${esc(x.day)} ${x.die?`/ ${num(x.base)} × ${x.die} = ${num(x.amount)} PT`:''}</div></div><div class="inline"><button data-special="${esc(x.id)}" data-amount="${x.amount}">지급</button><button data-reject="${esc(x.id)}">제외</button></div></div>`).join('')||empty('확인할 보상이 없습니다.'))}</div><div class="card" style="margin-top:20px"><div class="section-head"><h2>지급 · 구매 · 사용 기록</h2></div>${table(['시간 (한국)','청취자','종류','내역'],room.logs.map(l=>`<tr data-search="${esc((room.users[l.user]?.name||l.user)+' '+l.user+' '+(logNames[l.type]||l.type)+' '+JSON.stringify(l.data))}"><td>${new Date(l.time).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</td><td>${esc(room.users[l.user]?.name||l.user)}${room.users[l.user]?`<div class="small mono">@${esc(l.user)}</div>`:''}</td><td>${esc(logNames[l.type]||l.type)}</td><td>${logDetail(l)}</td></tr>`))}</div>`;
 }
 if(page==='records')html=screenCapturePanel()+html;
 if(page==='settings')html=`<div class="grid two">${card('운영 설정',`${field('방송 표시 이름','roomName',room.name,'text')}${field('개인별 명령어 대기시간 (초)','cooldown')}${field('방송 전체 응답 최소 간격 (초)','responseGap')}${field('레벨당 필요 EXP (임시)','levelStep')}${toggle('attendance','출석 ON — 하루 복권 20장')}${toggle('pauseItems','아이템 시간 일시정지 — 게임 OFF·방송 종료·조용 모드')}<p class="small">이 설정을 켜면 관련 게임을 쓸 수 있는 동안만 효과 시간이 줄어듭니다. 기존 운영과의 호환을 위해 기본 OFF입니다.</p><label class="field" style="margin-top:15px">금칙어 — 한 줄에 하나<textarea id="banned" rows="3">${esc(s.bannedWords.join('\n'))}</textarea></label><p class="small">금칙어는 감지·기록하며 해당 명령은 처리하지 않습니다. 공식 봇 API에 채팅 삭제·강퇴 기능이 없어 스푼에서 직접 조치해야 합니다. 기록 메뉴에서 banned-word로 검색하세요.</p>${saveButton()}`)}${card('백업 · 복원',`<p class="small">물고기·상점·방송 설정만 복원합니다. 청취자의 잔액이나 EXP는 변경하지 않습니다.</p><button data-action="backup">지금 설정 백업</button><div style="margin-top:18px">${room.backups.map(b=>`<div class="line"><span class="small">${new Date(b.time).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</span><button data-restore="${esc(b.id)}">복원</button></div>`).join('')||empty('설정을 저장하면 자동 백업됩니다.')}</div>`)}</div><div class="card" style="margin-top:20px"><h2>스푼 연결 · 월간 순위</h2><p class="small">넥스트초이스 월 순위 API는 확인되지 않아 DJ가 직접 등록합니다. 지난달 순위는 이번 달에 표시하지 않습니다.</p><div class="fields">${field('이번 달 순위','monthlyRank',s.monthlyRank,'text')}${field('순위 기준 월','monthlyRankMonth',s.monthlyRankMonth||new Date(Date.now()+9*3600000).toISOString().slice(0,7),'month')}</div><div class="actions"><button data-action="save" class="primary">설정 저장</button><button data-action="reconnect">내 방송에 봇 호출</button><a href="/invite" target="_blank" rel="noopener">다른 DJ 호출 안내 ↗</a><a href="/oauth/start"><button>스푼 계정 연결 ↗</button></a></div></div>`;
 if(page==='settings')html+=operationsPanel(room,esc);
 if(page==='settings')html=card('방송 운영 준비 점검',`<div id="diagnostics-panel">${diagnosticsHTML(diagnostics,esc)}</div>`)+html;
 if(page==='autoChat')html=extraUI.autoChat(room.settings);
 if(page==='voice')html=extraUI.voice(voiceInbox);
 if(page==='test')html=testWorkspace();
 if(page==='help')html=helpWorkspace();
 if(page==='chat'||page==='lifestyle'||page==='ai')html='<section id="community-panel"></section>';
 $('#content').innerHTML=html;decorateStats(page);if(page==='records')void loadCaptureFiles();if(page==='chat'||page==='lifestyle'||page==='ai')mountCommunity($('#community-panel'),{page,api});
 $('#page-description').textContent=descriptions[page]||'';
 document.querySelector('nav [data-page="test"]').hidden=room.id!=='demo';
 document.querySelectorAll('nav button').forEach(b=>{if(b.dataset.page===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 updateDirty();applyFilter();
 if(page==='shop')document.querySelectorAll('.grid.three .card').forEach((card,index)=>{
  const item=s.items[index];
  card.querySelector('.item-icon').insertAdjacentHTML('afterend',field('상품 표시 이름',`name-${item.id}`,item.name,'text')+field('남은 재고 — 비우면 무제한',`stock-${item.id}`,item.stock??'','number'));
 });
 $('#playback-panel').hidden=page!=='songs'&&!playback.running&&!youtube.player&&!room.current&&!room.songs.length&&!room.songSelection;$('#playback-song').textContent=room.songSelection?`선택한 곡: ${room.songSelection.title} · 재생 시작을 누르세요.`:room.current?`현재곡: ${room.current.title}`:'현재곡이 없습니다.';
 $('#playback-setup').textContent=(!playback.running?'자동재생 설정을 켜두면 새 신청곡의 재생을 시도합니다. 최초 재생이 차단되거나 일시정지한 경우 재생 시작을 눌러 주세요. ':'')+(session.youtubeSearchConfigured?'곡 제목 자동 검색이 설정되어 있습니다. 재생할 곡을 선택하세요.':'영상 링크 신청은 바로 재생할 수 있습니다. 제목만 입력한 새 곡은 YouTube 검색 후 영상 연결을 눌러 주세요. 한 번 연결한 제목은 기억합니다. 모든 제목 자동 검색에는 서버 검색 키가 필요합니다.');
 const watchId=songVideoId(room.current||room.songs[0]);$('#playback-watch').hidden=!watchId;if(watchId)$('#playback-watch').href='https://www.youtube.com/watch?v='+watchId;
 bindForms();if(page==='test'){renderChats();$('#test-dj').checked=testIdentity.dj;updateTestReadiness();}
}
function fishTable(){return table(['이름','등급','가중치','최소 cm','최대 cm','최소 PT','최대 PT','황금주사위',''],room.settings.fish.map((f,i)=>`<tr data-fish-row="${i}"><td><input class="name-input" data-fish="name" value="${esc(f.name)}" aria-label="물고기 이름"></td><td><select data-fish="rarity">${rarities.map((r,j)=>`<option value="${j}" ${f.rarity===j?'selected':''}>${r}</option>`).join('')}</select></td>${['weight','minSize','maxSize','minPt','maxPt'].map(k=>`<td><input type="number" data-fish="${k}" value="${f[k]}" aria-label="${k}"></td>`).join('')}<td><input type="checkbox" data-fish="golden" ${f.golden?'checked':''} aria-label="황금주사위 자동 굴리기"></td><td><button data-delete-fish="${i}">삭제</button></td></tr>`));}
function noticeTable(){return table(['사용','간격 (분)','문구 (200자 이내)',''],room.settings.announcements.map((a,i)=>`<tr data-notice-row="${i}"><td><input type="checkbox" data-notice="enabled" ${a.enabled?'checked':''} aria-label="안내 사용"></td><td><input data-notice="minutes" type="number" value="${a.minutes}" aria-label="간격"></td><td><input data-notice="text" value="${esc(a.text)}" maxlength="200" style="max-width:none;width:100%;min-width:240px" aria-label="안내 문구"></td><td><button data-delete-notice="${i}">삭제</button></td></tr>`));}
function userSelect(users){return `<label class="field">청취자<select name="user">${users.map(u=>`<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.id)})</option>`).join('')}</select></label>`;}
function testPanel(){return card('명령어 테스트',`<div class="fields"><label class="field">고유 ID<input id="test-user" maxlength="100" value="${esc(testIdentity.user)}"></label><label class="field">닉네임<input id="test-name" maxlength="40" value="${esc(testIdentity.name)}"></label></div><label class="switch"><input id="test-dj" type="checkbox">DJ 권한으로 테스트</label><p class="small">!게임 on은 청취자도 사용할 수 있어요. !게임 off만 DJ 권한이 필요합니다.</p><div id="command-feedback" class="command-feedback" role="status"></div><div class="test-history-head"><span class="small">이 탭의 테스트 대화는 새로고침해도 유지돼요.</span><button type="button" data-action="clear-test">대화 비우기</button></div><div id="chat" class="test-chat"></div><form id="test-form" class="chat-form"><input name="message" placeholder="!내정보 생성" autocomplete="off" required aria-label="테스트 명령어"><button class="primary">전송</button></form>`);}
function renderChats(){persistHistory();const c=$('#chat');if(c){c.innerHTML=chats.map(x=>`<div class="message-row ${x.bot?'bot-row':'user-row'}"><span class="chat-avatar" aria-hidden="true">${studioIcon(x.bot?'wave':'fans')}</span><p class="chat-msg ${x.bot?'bot':''}">${x.bot?esc(x.text).replace(/https:\/\/billing\.spooncast\.net\/payment\/spoon\?country=(?:kr|jp)(?![a-z])/g,url=>`<a href="${url}" target="_blank" rel="noopener noreferrer" class="charge-link">공식 스푼 충전창 열기 ↗</a>`):esc(x.text)}</p></div>`).join('');c.scrollTop=c.scrollHeight;}}
// ── 후원 메뉴판 시작: 스푼 금액별 리액션 문구를 웹 화면에서 입력합니다 ──
// 입력칸의 스푼 금액을 저장용 이름표(키)로 바꿉니다.
// "010"처럼 앞에 0이 붙은 숫자는 "10"으로 맞추고, 숫자가 아니거나 비어 있으면 입력한 글자를 그대로 둡니다.
// (잘못된 값은 저장하기 전에 menuProblem()이 안내 문구로 알려 줍니다.)
function menuAmountKey(value){
  const text=String(value).trim();
  return /^\d+$/.test(text)?String(Number(text)):text;
}
// 화면에 보이는 메뉴판 줄들을 위에서 아래 순서대로 읽어 [{amount,text}] 목록으로 만듭니다.
function menuRows(){
  return [...document.querySelectorAll('[data-menu-row]')].map(row=>({
    amount:menuAmountKey(row.querySelector('[data-menu=amount]').value),
    text:row.querySelector('[data-menu=text]').value.trim()
  }));
}
// 저장하기 전에 메뉴판 입력값을 검사합니다. 문제가 없으면 빈 문자열, 있으면 사용자에게 보여 줄 안내 문구를 돌려줍니다.
// 서버(core.mjs)도 같은 규칙(최대 50개, 양의 정수 스푼, 1~100자 한 줄)으로 다시 검사합니다.
function menuProblem(){
  // 메뉴판 화면이 열려 있지 않으면 검사할 것이 없습니다.
  if(!$('[data-menu-board]'))return '';
  const rows=menuRows(),seen=new Set();
  if(rows.length>50)return '메뉴판에는 최대 50개까지 등록할 수 있습니다.';
  for(const {amount,text} of rows){
    if(!/^[1-9]\d*$/.test(amount)||!Number.isSafeInteger(Number(amount)))return '스푼 금액은 1 이상의 정수로 입력해 주세요.';
    // 같은 금액이 두 줄이면 하나가 덮어써져 사라지므로 저장 전에 막습니다.
    if(seen.has(amount))return `${amount}스푼이 두 번 이상 입력되어 있습니다. 같은 금액은 한 줄만 남겨 주세요.`;
    seen.add(amount);
    if(!text)return `${amount}스푼의 리액션 문구를 입력해 주세요.`;
    if(text.length>100)return `${amount}스푼의 리액션 문구는 100자 이내로 입력해 주세요.`;
  }
  return '';
}
// "안내" 화면에 보여 줄 메뉴판 카드입니다. 금액이 작은 순서로 한 줄씩 보여 줍니다.
function menuBoardPanel(){
  const entries=Object.entries(room.settings.donationReactions||{}).sort((a,b)=>Number(a[0])-Number(b[0]));
  const rows=entries.map(([amount,text],i)=>`<tr data-menu-row="${i}"><td><input data-menu="amount" type="number" min="1" step="1" value="${esc(amount)}" aria-label="스푼 금액"></td><td><input data-menu="text" value="${esc(text)}" maxlength="100" style="max-width:none;width:100%;min-width:240px" aria-label="리액션 문구"></td><td><button data-delete-menu="${i}">삭제</button></td></tr>`);
  return card('후원 메뉴판 · !메뉴판',`<p>후원받은 스푼 금액별로 채팅에 보낼 리액션 문구를 등록합니다. 후원 금액과 같은 줄이 있으면 그 문구를 보내고, 없으면 위 방송 안내의 &quot;후원 반응&quot; 문구를 보냅니다. 문구에는 {name}(후원자 이름)과 {amount}(스푼 금액)를 쓸 수 있습니다.</p><div data-menu-board>${rows.length?table(['스푼 금액','리액션 문구 (100자 이내)',''],rows):'<p class="small">등록된 메뉴가 없습니다. 아래 &quot;메뉴 추가&quot;를 눌러 시작하세요.</p>'}</div><div class="actions"><button data-action="add-menu">+ 메뉴 추가</button></div><p class="small">최대 50개까지 등록할 수 있고, 같은 금액은 한 번만 쓸 수 있습니다. 채팅의 !메뉴판 명령으로 등록한 항목도 여기에 함께 보입니다.</p>${saveButton()}`);
}
// ── 후원 메뉴판 끝 ──
// 낚시 결과에 누가 잡았는지 표시하는 방식을 고르는 선택 상자입니다. (게임 설정의 낚시 카드에 들어갑니다)
function fishingWhoField(){
  const options=[['both','닉네임 + 고유 ID'],['nickname','닉네임만'],['id','고유 ID만'],['off','표시 안 함']];
  return `<label class="field">낚시 결과에 표시할 청취자<select data-field="fishingWho">${options.map(([value,label])=>`<option value="${value}" ${room.settings.fishingWho===value?'selected':''}>${label}</option>`).join('')}</select><span class="small">낚시 결과 맨 앞에 누가 잡았는지 보여 줍니다. 고유 ID는 !복권지급 @고유ID처럼 지급 대상으로도 쓸 수 있습니다.</span></label>`;
}
// 낚시 카드 안에 보여 줄 '현재 등급별 확률' 한 줄입니다. 행운 보너스(고급 이상 물고기 가중치 증가)를 반영해 계산합니다.
function fishOddsLine(){
  const s=room.settings,luck=1+(Number(s.fishingLuck)||0)/100,sums=rarities.map(()=>0);
  let total=0;
  for(const f of s.fish){
    // 고급(등급 1) 이상이고 황금주사위가 아니면 행운 보너스만큼 가중치가 늘어납니다.
    const weight=Math.max(0,Number(f.weight)||0)*(f.rarity>=1&&!f.golden?luck:1);
    if(sums[f.rarity]!==undefined)sums[f.rarity]+=weight;
    total+=weight;
  }
  return `현재 등급별 확률(행운 보너스 반영, 꽝 제외): ${rarities.map((name,i)=>`${name} ${total?(sums[i]/total*100).toFixed(1):'0.0'}%`).join(' · ')}`;
}
// 후원 레벨 보상 설정 카드입니다. 기준 스푼 이상 후원한 청취자에게 EXP를 주어 레벨이 오르게 합니다.
function donationExpPanel(){
  const s=room.settings,step=Number(s.levelStep)||10000;
  return card('후원 레벨 · EXP 보상',`${toggle('donationExpEnabled','기준 스푼 이상 후원하면 후원자에게 EXP 지급 (레벨 상승)')}${field('후원 기준 (스푼 이상, 한 번에)','donationExpMin')}${field('후원 1스푼당 EXP','donationExpPerSpoon')}<p class="small">DJ에게 한 번에 기준 스푼 이상 후원하면 후원자에게 「스푼 수 × 스푼당 EXP」를 지급하고 채팅으로 레벨을 알립니다. 지금 설정: ${s.donationExpEnabled?`${num(s.donationExpMin)}스푼 이상 → ${num(s.donationExpMin*s.donationExpPerSpoon)} EXP부터 (레벨당 ${num(step)} EXP)`:'꺼짐'}. 아직 프로필이 없는 후원자는 프로필이 자동으로 만들어집니다. 같은 후원은 한 번만 지급되고 기록이 남으며, 점수는 !경험치랭킹과 !내정보의 EXP·레벨에 반영됩니다. 방송 연결이 끊긴 사이의 후원은 지급되지 않을 수 있습니다.</p>${saveButton()}`);
}
// 후원자 복권 지급 설정 카드입니다. 기준 스푼 이상 후원한 '후원자 본인'에게 복권을 줍니다.
function donationDonorTicketPanel(){
  const s=room.settings;
  return card('후원 시 복권 · 후원자',`${toggle('donationDonorTicketEnabled','DJ에게 후원하면 후원자에게 복권 지급')}${toggle('donationDonorTicketEvery','후원할 때마다 지급 (스푼 수와 상관없이, 1스푼도 지급)')}${field('후원 기준 (스푼 이상, 한 번에) — 위 「후원할 때마다」를 끄면 적용','donationDonorTicketMin')}${field('지급 복권 (장, 1~1,000)','donationDonorTicketCount')}<p class="small">DJ에게 후원할 때마다 후원자 본인에게 복권을 지급하고 채팅으로 알립니다. 별도의 명령이나 아이디(@) 입력이 필요 없고, 후원 알림의 후원자에게 바로 지급됩니다. 지금 설정: ${s.donationDonorTicketEnabled?(s.donationDonorTicketEvery?`후원할 때마다 ${num(s.donationDonorTicketCount)}장`:`${num(s.donationDonorTicketMin)}스푼 이상 → ${num(s.donationDonorTicketCount)}장`):'꺼짐'}. 아직 프로필이 없는 후원자는 프로필이 자동으로 만들어지고, 같은 후원은 한 번만 지급됩니다. 모든 청취자에게 주려면 아래 「큰 후원 · 복권 전체 지급」을 사용하세요. 방송 연결이 끊긴 사이의 후원은 지급되지 않을 수 있습니다.</p>${saveButton()}`);
}
// 후원 대결 설정 카드입니다. !대결로 참가한 사람들이 정해진 시간 동안 DJ에게 후원한 스푼 합계로 1·2·3등을 겨룹니다.
function battlePanel(){
  const s=room.settings;
  return card('후원 대결 · !대결',`${toggle('battleEnabled','후원 대결 사용')}${field('기본 대결 시간 (분, 1~120)','battleMinutes')}${field('팀 대결 목표 스푼 (먼저 모으는 팀 승리)','battleTargetSpoons')}${field('팀 대결 선물 약속 안내 (스푼, 0이면 안내 없음)','battleTeamGiftSpoons')}${field('승리 팀 후원자 보상 PT (= 1등 PT)','battleFirstPt')}${field('승리 팀 후원자 보상 EXP (= 1등 EXP)','battleFirstExp')}<p class="small">개인 대결 순위 보상: 2등과 3등 · 1등 보상은 위 승리 팀 보상과 같은 값을 씁니다.</p>${field('2등 PT','battleSecondPt')}${field('2등 EXP','battleSecondExp')}${field('3등 PT','battleThirdPt')}${field('3등 EXP','battleThirdExp')}${field('개인 대결 선물 약속 안내 (스푼, 0이면 안내 없음)','battleGiftSpoons')}<p class="small"><b>팀 대결(기본)</b>: DJ가 채팅에 <b>!대결 시작 5</b>(분 생략 시 기본 시간, <b>!대결 시작 5 200</b>처럼 목표 스푼도 정할 수 있어요)를 입력하면 청팀·백팀 대결이 열리고, 청취자는 <b>!대결 청</b> 또는 <b>!대결 백</b>으로 팀을 골라 참가합니다. 참가한 뒤 DJ에게 후원한 스푼이 팀 합계에 더해지고, 목표 스푼(기본 100) 이상을 <b>먼저 모은 팀이 바로 승리</b>합니다(양 팀에 1명 이상 있어야 하고, 후원 전에는 팀을 바꿀 수 있어요). 승리 팀에서 후원한 사람에게 보상 PT·EXP를 주고, 결과에 「진 팀이 이긴 팀에 100스푼 — 직접 전달」 선물 약속이 안내됩니다. 시간이 끝날 때까지 목표에 닿은 팀이 없으면 승부 없음입니다. <b>!대결 현황</b>으로 팀별 스푼을 보고, DJ는 <b>!대결 종료</b> 또는 <b>!대결 취소</b>를 쓸 수 있습니다.</p><p class="small"><b>개인 대결</b>: <b>!대결 개인 시작 5</b>로 열고 <b>!대결</b>로 참가하면, 후원 합계가 큰 순서로 1·2·3등을 정합니다(후원한 참가자 2명 이상일 때만 보상). 지금 설정: ${s.battleEnabled?`${num(s.battleMinutes)}분 · 팀 목표 ${num(s.battleTargetSpoons)}스푼 · 승리 보상 ${num(s.battleFirstPt)}PT+${num(s.battleFirstExp)}EXP`:'꺼짐'}</p><p class="small">※ 봇은 스푼을 대신 보관하거나 사용자끼리 옮길 수 없습니다. 실제 스푼 선물은 결과 채팅의 안내를 보고 참가자끼리 직접 주고받는 약속이며, 봇이 지급을 보장하거나 확인하지 않습니다. 후원 알림을 받지 못한 시간(방송 연결 끊김)의 후원은 합산되지 않습니다.</p>${saveButton()}`);
}
// DJ 랭킹(일라디·월라디) 입력 카드입니다. 스푼이 순위를 API로 알려 주지 않아 DJ가 직접 입력하며, 넥스트초이스 등급은 월라디 순위로 자동 계산합니다.
// 청취자는 채팅에 !랭킹조회(순위·등급)와 !초이스(이번 달 방송일수·시간)를 입력해 봅니다.
function djRankPanel(){
  const s=room.settings,blank=value=>value===null||value===undefined?'':value,progress=room.choiceProgress||{days:0,minutes:0};
  // 스푼 Choice DJ 안내 기준표입니다. (코드의 CHOICE_TIERS와 같은 값이어야 하며 시험으로 확인합니다)
  const tiers=[
    ['Top Choice','1~10위','20일','45시간','70%','1일',['라이브 시 스푼이 선정한 DJ 상단 번들 노출','시그니처 스티커','최초 선정 시 순금 명함 지급','1위 선정 시 순금 숟가락 지급','랭킹 부스터 10개','방송시간 연장 10개','고정매니저+3 30일','퀵메시지+3 30일']],
    ['Star Choice','11~110위','20일','45시간','65%','2일',['라이브 시 스푼이 선정한 DJ 상단 번들 노출','방송시간 연장 5개','고정매니저+3 15일','퀵메시지+3 15일']],
    ['Normal Choice','111~410위','15일','30시간','60%','2일',['방송시간 연장 5개','고정매니저+3 7일','퀵메시지+3 7일']],
  ];
  return card('DJ 랭킹 · 넥스트초이스 등급',`<p>청취자가 채팅에 <b>!랭킹조회</b> 또는 <b>!랭크조회</b>를 입력하면 이 방송 DJ의 <b>일라디·월라디 순위</b>와 <b>이전 등급 → 현재 등급 → 다음 등급까지 남은 등수</b>를 순서대로 보여 줍니다. 스푼이 순위를 자동으로 알려 주지 않아 DJ가 직접 입력하고, 등급은 아래 스푼 공식 기준표대로 <b>월라디 순위로 자동 계산</b>합니다. 비워 두면 미등록으로 안내합니다.</p>${field('일라디 순위 (일간, 최근 24시간 기준)','djRankDaily',blank(s.djRankDaily))}${field('월라디 순위 (월간, 이번 달 1일~어제 누적) — 넥스트초이스 등급 계산에 사용','djRankMonthly',blank(s.djRankMonthly))}${field('지난달 월라디 순위 (이전 등급 표시용)','djRankPrevMonthly',blank(s.djRankPrevMonthly),'number','새 달 순위를 처음 입력하면 이전 달 순위가 자동으로 지난달 값이 됩니다.')}${table(['등급','월간 순위','방송일 수','방송 시간','정산 비율','환전 처리일','혜택'],tiers.map(([name,range,days,hours,settle,payout,benefits])=>`<tr><td>${name}</td><td>${range}</td><td>${days}</td><td>${hours}</td><td>${settle}</td><td>${payout}</td><td>${benefits.join(' · ')}</td></tr>`))}<p class="small">Choice DJ 선정 결과는 매월 1일 오후 6~7시 사이에 갱신되고, 환전 처리일은 영업일 기준입니다. 티어별 조건과 혜택은 스푼의 매월 이벤트 페이지에서 다시 확인하세요. 청취자는 채팅에 <b>!초이스안내</b>로 티어별 정산 비율을 볼 수 있습니다.</p><p class="small">선정 기준(스푼 안내): 전월 기준 라이브 활동을 충족하고 월간 순위 410위 이내이며, 최근 6개월간 제재 이력이 없어야 합니다. 순위는 라이브 중 받은 스푼과 좋아요 수의 합으로 정해집니다. 5분 이상 진행한 라이브만 집계하고, 하루 1시간 이상 방송하면 1일로 인정합니다. 방송 데이터(시간·스푼·좋아요)는 <b>방송을 시작한 날</b>의 기록으로 집계해, 전날 시작해 자정을 넘겨 끝난 방송도 전날 기록입니다.</p><p class="small">스푼의 순위 갱신 시각: 최근 7일·이번 달 순위는 매일 <b>오전 5시경</b> 갱신됩니다. 일간은 최근 24시간, 이번 달은 매월 1일부터 어제까지의 누적 기록이라 오늘 방송은 다음 날 아침에 반영됩니다. 갱신된 뒤 값을 입력하면 정확해요.</p><p class="small">이번 달 방송(봇이 연결된 동안만 집계, 공식 기록과 다를 수 있어요): <b>${num(progress.days)}일 · ${num(Math.floor(progress.minutes/6)/10)}시간</b> — 청취자는 <b>!초이스</b>로 확인합니다.</p><p class="small">방송 중에는 채팅으로도 입력할 수 있습니다(DJ 전용): <code>!랭킹등록 일 12</code> · <code>!랭킹등록 월 45</code> · <code>!랭킹등록 지난달 85</code> · <code>!랭킹등록 초기화</code>. 값을 입력한 날짜·달을 기록해 오래된 값에는 (기준일)이 붙습니다. 입력 기준일: 일라디 ${esc(s.djRankDailyDate||'-')} · 월라디 ${esc(s.djRankMonthlyMonth||'-')} · 지난달 ${esc(s.djRankPrevMonth||'-')}</p>${saveButton()}`);
}
// 복권 등수별 보상(EXP·PT)을 정하는 설정 카드입니다. 게임 설정 화면에 보입니다.
function lotteryRewardPanel(){
  return card('복권 등수 · 보상',`<p>복권은 숫자 3개를 고르는 게임입니다. 맞힌 개수에 따라 3개 일치 1등, 2개 일치 2등, 1개 일치 3등, 0개는 꽝입니다. 등수별 EXP·PT를 정하세요. 0으로 두면 그 보상은 지급하지 않습니다.</p>${field('1등 EXP (3개 일치)','lotteryFirstExp')}${field('1등 PT','lotteryFirstPt')}${field('2등 EXP (2개 일치)','lotterySecondExp')}${field('2등 PT','lotterySecondPt')}${field('3등 EXP (1개 일치)','lotteryThirdExp')}${field('3등 PT','lotteryThirdPt')}<p class="small">1장당 확률: 1등 약 1.2% · 2등 약 21.4% · 3등 약 53.6% · 꽝 약 23.8% (숫자 3개를 고르고 당첨 숫자 3개와 비교). 각 값은 0~1,000,000 사이 정수입니다. 복권으로 받는 PT는 일일 PT 획득 한도에 포함하지 않습니다. 변경한 보상은 저장한 뒤 추첨하는 복권부터 적용됩니다.</p>${saveButton()}`);
}
// 큰 후원이 들어오면 등록된 모든 청취자에게 복권을 지급하는 설정 카드입니다. (기본은 꺼짐)
function donationTicketPanel(){
  const s=room.settings;
  return card('큰 후원 · 복권 전체 지급',`${toggle('donationTicketEnabled','큰 후원이 들어오면 모든 청취자에게 복권 지급')}${field('후원 기준 (스푼 이상)','donationTicketMin')}${field('청취자 1명당 지급 복권 (장, 1~1,000)','donationTicketCount')}<p class="small">DJ에게 한 번에 기준 스푼 이상 후원하면, 그때 봇에 등록된 모든 청취자(후원자 포함)에게 복권을 지급하고 채팅으로 알립니다. 같은 후원은 한 번만 지급되며 지급 기록이 남습니다. 방송 중 연결이 끊긴 사이의 후원은 알림을 받지 못해 지급되지 않을 수 있습니다. 지금 설정: ${s.donationTicketEnabled?`${num(s.donationTicketMin)}스푼 이상 → 1명당 ${num(s.donationTicketCount)}장`:'꺼짐'}</p>${saveButton()}`);
}
function collect(){
 const s=structuredClone(room.settings);
 document.querySelectorAll('[data-setting]').forEach(el=>s[el.dataset.setting]=el.checked);
 document.querySelectorAll('[data-field]').forEach(el=>{const k=el.dataset.field;if(k==='roomName'){}else if(k.startsWith('item-'))s.items.find(i=>i.id===k.slice(5)).price=Number(el.value);else if(k.startsWith('name-'))s.items.find(i=>i.id===k.slice(5)).name=el.value;else if(k.startsWith('stock-'))s.items.find(i=>i.id===k.slice(6)).stock=el.value===''?null:Number(el.value);else s[k]=el.type==='number'?Number(el.value):el.value;});
 document.querySelectorAll('[data-item-enabled]').forEach(el=>s.items.find(i=>i.id===el.dataset.itemEnabled).enabled=el.checked);
 document.querySelectorAll('[data-fish-row]').forEach(row=>{const f=s.fish[Number(row.dataset.fishRow)];row.querySelectorAll('[data-fish]').forEach(el=>f[el.dataset.fish]=el.type==='checkbox'?el.checked:el.dataset.fish==='name'?el.value:Number(el.value));});
 document.querySelectorAll('[data-notice-row]').forEach(row=>{const a=s.announcements[Number(row.dataset.noticeRow)];row.querySelectorAll('[data-notice]').forEach(el=>a[el.dataset.notice]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value);});
 document.querySelectorAll('[data-roulette-row]').forEach(row=>{const r=s.rouletteRewards[Number(row.dataset.rouletteRow)];row.querySelectorAll('[data-roulette]').forEach(el=>r[el.dataset.roulette]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value);});
 document.querySelectorAll('[data-reply-row]').forEach(row=>{const rule=s.autoReplies[Number(row.dataset.replyRow)];row.querySelectorAll('[data-reply]').forEach(el=>rule[el.dataset.reply]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value);});
 document.querySelectorAll('[data-quiz-row]').forEach(row=>{const q=s.quizQuestions[Number(row.dataset.quizRow)];q.question=row.querySelector('[data-quiz=question]').value;q.answers=row.querySelector('[data-quiz=answers]').value.split(',').map(a=>a.trim()).filter(Boolean);q.category=row.querySelector('[data-quiz=category]')?.value.trim()||'';q.meaning=row.querySelector('[data-quiz=meaning]')?.value.trim()||'';});
 if($('#auto-chat-messages'))s.autoChatMessages=$('#auto-chat-messages').value.split('\n').map(t=>t.trim()).filter(Boolean);
 if($('#banned'))s.bannedWords=$('#banned').value.split('\n').map(x=>x.trim()).filter(Boolean);
 // 메뉴판 화면이 열려 있을 때만, 화면의 줄들로 메뉴판을 다시 만듭니다. 다른 화면에서는 기존 값을 그대로 둡니다.
 if($('[data-menu-board]')){
  s.donationReactions={};
  for(const {amount,text} of menuRows())s.donationReactions[amount]=text;
 }
 return s;
}
async function reload(){const nextRoom=await api('/api/room');if(page==='voice')voiceInbox=await api('/api/voice-inbox');room=nextRoom;restoreHistory(room.id);savedRoom=structuredClone(room);setDirty(false);if($('#settings-sync-alert'))$('#settings-sync-alert').hidden=true;render();void playback.sync(room).then(()=>requestAutoplay&&playback.receive(room));}
function bindForms(){
 $('#identity-form')?.addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.action=event.submitter?.value||'set';await run(async()=>{await api('/api/identity-alias',data);await reload();toast('계정 연결 정보를 저장했습니다.');});});
 $('#test-form')?.addEventListener('submit',async e=>{e.preventDefault();await sendTest(e.currentTarget.message.value);});
 for(const id of ['grant','keep'])$(`#${id}-form`)?.addEventListener('submit',async e=>{e.preventDefault();if(!mayLeave())return;const b=Object.fromEntries(new FormData(e.currentTarget));if(id==='grant'){
  b.amount=Number(b.amount);
  // 체크박스는 체크했을 때만 'on'이 들어오므로 참/거짓으로 바꿔 서버에 보냅니다.
  b.all=b.all==='on';
  if(b.all){
   if(b.kind!=='tickets'){toast('전체 지급은 복권만 가능합니다. 종류를 복권으로 바꿔 주세요.');return;}
   // 많은 사람에게 한꺼번에 지급하므로 실행 전에 한 번 더 확인합니다.
   if(!confirm(`등록된 청취자 전체에게 복권을 ${b.amount.toLocaleString('ko-KR')}장씩 지급할까요? 되돌리려면 한 명씩 회수해야 합니다.`))return;
  }
 }else b.action='add';
 if(busy)return;busy=true;const submit=e.currentTarget.querySelector('button');submit.disabled=true;try{await run(async()=>{const result=await api(`/api/${id}`,b);await reload();toast(result?.people?`복권을 ${result.people.toLocaleString('ko-KR')}명에게 지급했습니다.`:'반영했습니다.');});}finally{busy=false;if(submit.isConnected)submit.disabled=false;}});
}
async function run(fn){try{await fn();}catch(e){toast(e.message);}}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;void run(async()=>{
 if(b.dataset.page){if(busy){toast('처리 중입니다. 완료된 뒤 메뉴를 이동해 주세요.');return;}if(!mayLeave())return;const version=++navigationVersion,nextRoom=await api('/api/room'),nextVoice=b.dataset.page==='voice'?await api('/api/voice-inbox'):voiceInbox;if(version!==navigationVersion)return;voiceInbox=nextVoice;page=b.dataset.page;room=nextRoom;savedRoom=structuredClone(room);setDirty(false);render();void playback.sync(room);if(b.dataset.testCommand&&$('#test-form'))$('#test-form').message.value=b.dataset.testCommand;window.scrollTo({top:0,behavior:'instant'});return;}
 const a=b.dataset.action;
 if(a==='automation-enable'||a==='automation-disable'){if(!mayLeave())return;b.disabled=true;try{await api('/api/automation',{enabled:a==='automation-enable',expectedRevision:savedRoom.settingsRevision||0});await reload();toast('자동 운영 설정을 반영했습니다.');}finally{if(b.isConnected)b.disabled=false;}return;}
 if(a==='diagnostics-refresh'){b.disabled=true;try{diagnostics=await api('/api/diagnostics');const host=$('#diagnostics-panel');if(host)host.innerHTML=diagnosticsHTML(diagnostics,esc);}finally{if(b.isConnected)b.disabled=false;}return;}
 if((['song-next','song-finish','song-undo','backup','reconnect'].includes(a)||b.dataset.removeSong||b.dataset.moveSong||b.dataset.restore||b.dataset.special||b.dataset.reject||b.dataset.keepUser)&&!mayLeave())return;
 if(a==='reauth'){if(session.testing){await api('/api/demo',{});session=await api('/api/session');$('#session-alert').hidden=true;toast('다시 연결했습니다. 입력한 내용을 확인한 뒤 작업을 다시 실행해 주세요.');}else location.assign('/oauth/start');return;}
 if(a==='clear-test'){chats=[];renderChats();return;}
 if(a==='sync-settings'){if(busy)return;if(mayLeave())await reload();return;}
 if(a==='save'){if(busy)return;const menuError=menuProblem();if(menuError)throw Error(menuError);busy=true;b.disabled=true;try{await api('/api/settings',{settings:collect(),expectedRevision:savedRoom.settingsRevision||0,name:$('[data-field="roomName"]')?.value||room.name});await reload();toast('설정을 저장했습니다. PC·모바일에서 같은 DJ 설정을 사용합니다.');}finally{busy=false;if(b.isConnected)b.disabled=false;}return;}
 if(a==='discard'){if(confirm('저장하지 않은 변경사항을 취소할까요?')){room=structuredClone(savedRoom);setDirty(false);render();}return;}
 if(b.dataset.testCommand){$('#test-form').message.value=b.dataset.testCommand;$('#test-form').message.focus();return;}
 if(a==='test-like'){await sendTest('좋아요 이벤트',true);return;}
  if(a==='test-donation'){await sendDonation(Number(b.dataset.amount??$('#test-donation-amount').value));return;}
 if(a==='add-quiz'){room.settings=collect();if(room.settings.quizQuestions.length>=100)throw Error('최대 100문제까지 등록할 수 있습니다.');room.settings.quizQuestions.push({id:crypto.randomUUID(),question:'',answers:[]});setDirty(true);render();$('#quiz-bank').open=true;return;}
 if(b.dataset.deleteQuiz!==undefined){room.settings=collect();room.settings.quizQuestions.splice(Number(b.dataset.deleteQuiz),1);setDirty(true);render();$('#quiz-bank').open=true;return;}
 if(a==='add-reply'){room.settings=collect();room.settings.autoReplies.push({id:crypto.randomUUID(),keyword:'안녕',match:'contains',text:'{name}님, 반갑습니다!',enabled:false,cooldown:60});setDirty(true);render();return;}
 if(b.dataset.deleteReply!==undefined){room.settings=collect();room.settings.autoReplies.splice(Number(b.dataset.deleteReply),1);setDirty(true);render();return;}
 if(b.dataset.voiceLink){if(!mayLeave())return;if(b.dataset.voiceLink==='rotate'&&!confirm('기존 접수 링크를 중지하고 새 링크를 만들까요?'))return;await api('/api/voice-link',{action:b.dataset.voiceLink});await reload();toast('음성메시지 접수 상태를 변경했습니다.');return;}
 if(b.dataset.playSong){if(!mayLeave())return;await api('/api/song',{action:'select',id:b.dataset.playSong,expectedQueueRevision:room.queueRevision||0,expectedCurrentId:room.current?.id||null});await reload();await playback.start(room);return;}
 if(b.dataset.linkSong){if(!mayLeave())return;const url=prompt('재생할 YouTube 영상 링크를 붙여넣으세요.');if(!url)return;await api('/api/song-resolve',{id:b.dataset.linkSong,url});await reload();toast('YouTube 영상을 연결했습니다. 재생 시작을 누르세요.');return;}
 if(a==='voice-refresh'){if(mayLeave())await reload();return;}
 if(a==='copy-voice'){await navigator.clipboard.writeText(voiceInbox.url);toast('청취자용 접수 링크를 복사했습니다.');return;}
 if(b.dataset.voiceAction){if(b.dataset.voiceAction==='delete'&&!confirm('음성 파일과 메시지를 영구 삭제할까요?'))return;await api('/api/voice-action',{id:b.dataset.voiceId,action:b.dataset.voiceAction});await reload();toast('메시지를 처리했습니다.');return;}
 if(a==='add-roulette'){room.settings=collect();room.settings.rouletteRewards.push({id:crypto.randomUUID(),name:'새 보상',weight:1,miss:false});setDirty(true);render();return;}
 if(b.dataset.deleteRoulette!==undefined){room.settings=collect();room.settings.rouletteRewards.splice(Number(b.dataset.deleteRoulette),1);setDirty(true);render();return;}
 if(a==='add-fish'){room.settings=collect();setDirty(true);room.settings.fish.push({id:crypto.randomUUID(),name:'새 물고기',rarity:0,weight:1,minSize:10,maxSize:30,minPt:50,maxPt:2000,golden:false});render();}
 if(b.dataset.deleteFish!==undefined){room.settings=collect();setDirty(true);room.settings.fish.splice(Number(b.dataset.deleteFish),1);render();}
 if(a==='add-notice'){room.settings=collect();setDirty(true);room.settings.announcements.push({id:crypto.randomUUID(),enabled:false,minutes:10,text:'하트를 눌러주세요 ♥'});render();}
 if(b.dataset.deleteNotice!==undefined){room.settings=collect();setDirty(true);room.settings.announcements.splice(Number(b.dataset.deleteNotice),1);render();}
 // 메뉴 추가: 아직 쓰지 않은 가장 작은 10단위 금액(10, 20, 30...)으로 새 줄을 만듭니다.
 if(a==='add-menu'){
  room.settings=collect();
  room.settings.donationReactions??={};
  const menu=room.settings.donationReactions;
  if(Object.keys(menu).length>=50)throw Error('메뉴판에는 최대 50개까지 등록할 수 있습니다.');
  let amount=10;
  while(Object.hasOwn(menu,String(amount)))amount+=10;
  menu[String(amount)]='{name}님, {amount}스푼 감사합니다 💖';
  setDirty(true);render();return;
 }
 // 메뉴 삭제: 누른 줄만 빼고 나머지 줄로 메뉴판을 다시 만듭니다.
 if(b.dataset.deleteMenu!==undefined){
  const keep=menuRows().filter((_,i)=>i!==Number(b.dataset.deleteMenu));
  room.settings=collect();
  room.settings.donationReactions=Object.fromEntries(keep.map(r=>[r.amount,r.text]));
  setDirty(true);render();return;
 }
 if(a==='song-next'||a==='song-finish'||a==='song-undo'||b.dataset.removeSong||b.dataset.moveSong){
   if(b.dataset.removeSong&&!confirm('이 곡을 대기·이전곡·완료 기록에서 삭제할까요? 같은 곡의 기록과 선택 상태도 제거됩니다.'))return;
   await api('/api/song',{action:b.dataset.moveSong?'move':b.dataset.removeSong?'purge':a==='song-next'?'next':a==='song-undo'?'undo':'finish',id:b.dataset.moveSong||b.dataset.removeSong,direction:b.dataset.moveSong?Number(b.dataset.direction):undefined,expectedQueueRevision:room.queueRevision||0,expectedCurrentId:room.current?.id||null});await reload();return;
 }

 if(a==='draft'){const out=await api('/api/notice-draft',{settings:collect()});$('#draft').value=out.text;toast('초안을 만들었습니다. 설정은 저장하지 않았습니다.');}
 if(a==='add-draft'){const text=$('#draft').value.trim();if(!text)throw Error('먼저 공지 초안을 만들어주세요.');room.settings=collect();setDirty(true);room.settings.announcements.push({id:crypto.randomUUID(),enabled:false,minutes:10,text});render();toast('안내를 추가했어요. 확인 후 설정 저장을 눌러주세요.');}
 if(a==='operations-refresh'){if(mayLeave())await reload();return;}
 if(b.dataset.outboxCancel){await api('/api/outbox-cancel',{id:b.dataset.outboxCancel});await reload();return;}
 if(b.dataset.outboxRetry){if(!confirm('이미 채팅이 전달되었는지 확인했나요? 재전송하면 같은 메시지가 두 번 표시될 수 있습니다. 보상은 다시 지급하지 않습니다.'))return;await api('/api/outbox-retry',{id:b.dataset.outboxRetry,confirm:'중복 가능성 확인'});await reload();return;}
 if(a==='disconnect'){if(!confirm('스푼 자동 연결과 대기 중인 메시지를 중지할까요?'))return;const result=await api('/api/disconnect',{});await reload();toast(result.revoked?'스푼 연결을 해제했습니다.':'로컬 연결을 해제했습니다. 스푼 계정에서도 앱 동의를 해제하세요.');return;}
 if(a==='listener-delete'){if(!mayLeave())return;const user=prompt('삭제할 청취자의 고유 ID를 입력하세요.');if(!user)return;if(!confirm('청취자 프로필·보상·신청곡과 방송의 활동 기록·대기 메시지를 삭제합니다. 기존 백업은 보관 기간까지 남습니다. 계속할까요?'))return;await api('/api/listener-delete',{user,confirm:'청취자 삭제'});await reload();toast('청취자 데이터를 삭제했습니다.');return;}
 if(a==='account-delete'){if(!mayLeave())return;const phrase=prompt('현재 방송의 계정·청취자·음성·설정을 삭제합니다. 백업은 보관 기간까지 남을 수 있습니다. 계속하려면 방송 데이터 영구 삭제 를 입력하세요.');if(phrase!=='방송 데이터 영구 삭제')return;const result=await api('/api/account-delete',{confirm:phrase});if(!result.revoked)alert('로컬 데이터는 삭제되었습니다. 스푼 계정에서도 앱 동의를 해제하세요.');location.assign('/');return;}
 if(a==='capture-issue'){if(busy)return;busy=true;b.disabled=true;try{const setup=await api('/api/screen-capture',{action:'issue'});await reload();$('#capture-setup').value=JSON.stringify(setup);toast('현재 DJ의 후원 감지 연결을 발급했습니다. PC 스푼 방송 탭의 확장 기능에 붙여넣으세요.');}finally{busy=false;if(b.isConnected)b.disabled=false;}return;}
 if(a==='capture-copy'){const value=$('#capture-setup')?.value;if(!value){toast('먼저 캡처 연결 정보를 발급해주세요.');return;}try{await navigator.clipboard.writeText(value);toast('캡처 연결 정보를 복사했습니다.');}catch{$('#capture-setup').focus();$('#capture-setup').select();toast('선택된 연결 정보를 직접 복사해주세요.');}return;}
 if(a==='capture-files-refresh'){await reload();toast('캡처 연결 상태와 서버 캡처 목록을 새로 불러왔습니다.');return;}
  if(a==='capture-file-delete'){if(!confirm('이 캡처 1장을 서버에서 지울까요? 이미 내려받은 파일은 지워지지 않습니다.'))return;const out=await api('/api/screen-capture/files/delete',{ids:[b.dataset.id]});await loadCaptureFiles();toast(out.removed+'장을 서버에서 지웠습니다.');return;}
  if(a==='capture-files-clear'){if(!confirm('서버에 보관된 후원 캡처를 모두 지울까요? 이미 내려받은 파일은 지워지지 않고, 되돌릴 수 없습니다.'))return;const out=await api('/api/screen-capture/files/delete',{all:true});await loadCaptureFiles();toast(out.removed+'장을 서버에서 지웠습니다.');return;}
  if(a==='capture-revoke'){await api('/api/screen-capture',{action:'revoke'});await reload();toast('후원 감지 연결을 해제했습니다. 이미 저장한 PNG(이 PC·서버)는 그대로이니 필요 없으면 직접 지워주세요.');return;}
 if(a==='backup'){
await api('/api/backup',{});await reload();toast('백업했습니다.');}
 if(b.dataset.restore&&confirm('이 시점의 방송 설정으로 복원할까요? 현재 설정도 백업됩니다.')){await api('/api/restore',{id:b.dataset.restore,expectedRevision:savedRoom.settingsRevision||0});await reload();toast('복원했습니다.');}
 if(b.dataset.special){const amount=prompt('지급 PT (전체 일일 100만 한도에 포함)',b.dataset.amount==='0'?'50000':b.dataset.amount);if(amount!==null){await api('/api/special',{id:b.dataset.special,amount:Number(amount)});await reload();}}
 if(b.dataset.reject&&confirm('이 보상을 지급 대상에서 제외할까요?')){await api('/api/special',{id:b.dataset.reject,action:'reject'});await reload();}
 if(b.dataset.keepUser){if(busy)return;busy=true;b.disabled=true;try{await api('/api/keep',{user:b.dataset.keepUser,action:'use',text:b.dataset.keepName,expectedCount:Number(b.dataset.keepCount)});await reload();toast('킵 1개를 사용내역으로 이동했습니다.');}finally{busy=false;if(b.isConnected)b.disabled=false;}}
 if(a==='copy-bot-call'){const result=await api('/api/bot-call-link',{});try{await navigator.clipboard.writeText(result.url);toast('로그인 없이 내 방송만 호출할 링크를 복사했습니다.');}catch{toast('내 방송 호출 링크: '+result.url);}return;}
 if(a==='copy-invite'){const link=new URL('/invite',location.origin).href;try{await navigator.clipboard.writeText(link);toast('다른 DJ에게 보낼 호출 링크를 복사했습니다.');}catch{toast('호출 링크: '+link);}return;}
 if(a==='reconnect'){const result=await api('/api/reconnect',{});toast(result.preview?'테스트 공간입니다. 실제 방송에는 호출되지 않습니다.':result.connected?'이미 방송에 연결되어 있습니다.':'봇 연결을 요청했습니다. 방송 중이면 연결을 시도합니다.');}
});});
$('#connect-login').onclick=()=>location.assign('/oauth/start');
$('#demo-login').onclick=()=>void run(async()=>{await api('/api/demo',{});await init();});
$('#refresh').onclick=()=>{if(mayLeave())void run(reload);};
$('#logout').onclick=()=>mayLeave()&&void run(async()=>{playback.stop();checkpoint.clear();await api('/api/logout',{});location.reload();});
async function init(){session=await api('/api/session');$('#login').hidden=session.loggedIn;$('#shell').hidden=!session.loggedIn;$('#demo-login').hidden=!session.demo;$('#connect-login').disabled=!session.configured;$('#demo-login').classList.toggle('primary',!session.configured);$('#demo-login').classList.toggle('secondary',session.configured);$('#connect-login').classList.toggle('primary',session.configured);$('#connect-login').classList.toggle('secondary',!session.configured);$('#login').classList.toggle('demo-first',!session.configured);$('#login-note').textContent=session.publicDemo?'테스트는 방문자별 독립 공간에서 진행돼요. 1시간 후 또는 서버 재시작 시 초기화됩니다. 실제 방송에는 연결되지 않아요.':session.configured?'방송 중에도 DJ 본인 계정으로 동의하면 봇 연결을 시도합니다. 다른 DJ는 호출 안내 링크를 이용하세요.':'방송 연결 설정이 아직 완료되지 않았습니다. 테스트 화면은 바로 사용할 수 있어요.';if(session.loggedIn)await reload();}


const descriptions={ai:'OpenAI와 자유롭게 대화하고 앞선 이야기를 이어가세요.',chat:'우리 방송의 별도 채팅방을 열고 메시지를 관리하세요.',lifestyle:'전국 시·군·구 주간 날씨, 관광·숙박·교통과 계절별 옷차림을 확인하세요.',autoChat:'키워드 자동응답과 순차·무작위 주기 채팅을 설정하세요.',voice:'팬 관계 없이 접수한 음성메시지를 듣고 관리하세요. 스푼 앱 보이스카드와 별개입니다.',dashboard:'방송 상태를 확인하고 자주 쓰는 기능을 빠르게 조작하세요.',games:'게임 사용 여부와 보상 규칙을 설정하세요. 변경 후 저장이 필요합니다.',shop:'상품 가격, 재고, 판매 여부를 관리하세요.',songs:'접수 설정과 현재곡, 다음 곡을 한곳에서 관리하세요.',fans:'청취자를 찾고 포인트·복권과 킵을 관리하세요.',notices:'방송 안내 문구를 작성하고 자동 안내 간격을 설정하세요.',records:'보상 대기 목록과 최근 200건의 활동 기록을 확인하세요.',settings:'방송 연결과 기본 설정, 설정 백업을 관리하세요.',test:'실제 방송에 전송하지 않고 청취자 명령을 확인하세요.',help:'명령을 확인한 뒤 테스트 공간에서 직접 사용해 보세요.'};
const commandGroups=[
 ['AI · 채팅 · 오늘의 추천', [['!자동운영 on / off / 상태','DJ 자동 운영 프로필'],['!채팅 질문','AI와 자유로운 대화 (질문·최근 대화를 OpenAI에 전송, 서버 키 설정 필요)'],['!채팅 초기화','내 스푼 AI 대화 문맥 삭제'],['그냥 말하기 (! 없이)','"안녕하세요", "메이트야 뭐해?", "서울 날씨 어때?", "이번주 각 지역별 전국날씨", "광주 맛집 추천해줘"처럼 명령어 없이 말해도 대답 · 자동채팅 메뉴에서 대화 방식·봇 이름 설정'],['!채팅방','DJ가 열어둔 별도 앱 채팅방 주소'],['!전국날씨 1','17개 시·도 대표 지점 · 1~3페이지'],['!날씨 서울','지역의 현재 날씨'],['!전국날씨 내일','내일 17개 시·도 예보 (페이지 지원)'],['!전국날씨 이번주','전국 시·군·구별 월~일 예보 · 페이지 지원'],['!전국날씨 다음주','전국 시·군·구별 다음 주 월~일 예보'],['!전국날씨 다음주 화요일','해당 요일의 지역별 예보'],['!날씨 서울 다음주','서울 다음 주 일별 예보'],['!이번주 대한민국 각 지역별 전국날씨','전국 전체 지역 주간 예보'],['!전국날씨 다음주 서울 2','시·도별 세부 지역 페이지'],['!여행 서울 강남구 다음주','관광·숙박·교통·날씨 종합 안내'],['!관광 부산 해운대구','관광지 실제 검색 결과'],['!숙박 제주 서귀포시','숙소·업체 지도와 원문'],['!교통 서울 강남구','기차·버스·항공·지하철 시설 검색'],['!계절옷차림 서울 강남구 겨울','계절 준비물과 실제 예보에 따른 옷차림'],['!맛집 전국 1','전국 지역 안내 · 1~5페이지'],['!맛집 부산 국밥','지역·음식으로 검색, 앱에서 최대 15곳 탐색'],['!맛집 광주 점심','지역과 아침·점심·저녁으로 네이버 검색'],['!카페 동명동','지역 카페 검색'],['!맛집추천 / !추천맛집','맛집 별칭 · 지역 없이 입력 후 2분 내 지역 응답'],['!카페추천 / !추천카페','카페 별칭 · !취소로 지역 입력 취소'],['!맛집 도움말 / !카페 도움말','검색 사용법 · !카페 전국으로 전국 지역 안내']]],
 ['시작과 프로필',[['!내정보 생성','처음 이용하는 청취자 프로필 생성'],['!내정보','내 EXP·PT·복권 확인'],['!출석','하루 한 번 출석하고 복권 받기'],['!랭킹 [페이지]','누적 EXP 팬랭킹 확인'],['!랭킹조회 / !랭크조회','이 방송 DJ의 일라디·월라디 순위와 이전·현재 넥스트초이스 등급, 다음 등급까지 남은 등수'],['!초이스','이번 달 방송일수·시간과 넥스트초이스 등급별 기준(Normal 15일·30시간, Top·Star 20일·45시간) 비교'],['!초이스안내','Choice DJ 티어별 선정 순위·정산 비율·환전 처리일 안내']]],
 ['게임',[['!게임 상태','청취자도 게임 상태 확인 가능'],['!게임 on','청취자도 낚시·홀짝·미니게임 켜기 가능'],['!낚시 on','청취자도 낚시 켜기 가능'],['!홀짝 on','청취자도 홀짝 켜기 가능'],['!낚시','낚시 실행 · 게임 ON 필요'],['!복권 자동','보유 복권 전부 자동 추첨 · 총 EXP와 남은 수량 표시'],['!복권 3 6 9','복권 1장 사용 · 서로 다른 숫자 3개'],['!홀 100','홀에 100 PT 베팅 · 게임 ON 필요'],['!가위바위보 바위','가위바위보 한 판 · PT·EXP 변동 없음'],['!주사위','1~6 주사위 한 번 굴리기'],['!주사위 자동','주사위 한 번 굴리기 · !주사위와 같은 동작'],['!주사위 4','1~6 주사위 숫자 맞히기'],['!숫자맞히기 50','1~100 숫자를 7번 안에 맞히기'],['!퀴즈','초성·분류 힌트 · 30분 이내 정답 시 EXP/복권 확률 보상'],['서울  /  !서울','퀴즈가 진행 중이면 !정답 없이 정답만 입력해도 정답 처리(느낌표를 붙여도 됨) · 일반 채팅의 틀린 말에는 반응하지 않고, 개인 문제 중 틀린 !낱말에는 초성 힌트 · 보상은 회차당 한 번'],['!정답 서울','예전처럼 명령어로 입력해도 같은 결과 · 틀리면 초성 힌트를 다시 알려줌'],['!포기  /  !퀴즈 포기','개인 문제 정답 확인 후 종료'],['!자동퀴즈 on 10','DJ: 10분 간격 · 무정답이면 최대 5분 뒤 힌트와 정답 공개'],['!자동퀴즈 off','DJ: 자동 출제와 진행 중인 공용 문제 종료'],['!자동퀴즈 상태','DJ: 자동 출제 상태 확인'],['!도감 [페이지]','잡은 물고기 확인'],['!룰렛','DJ 설정 확률로 추첨 · 당첨은 킵, 꽝은 사용내역에 기록']]],
 ['아이템과 보유 정보',[['!아이템 상점','판매 상품 확인'],['!아이템 구매 exp','PT로 EXP 2배 아이템 구매'],['!구매 rare','ID·번호·아이템 이름으로 구매 가능'],['!아이템 사용 exp','보유 아이템 사용'],['!가방','보유 아이템 확인'],['!버프','남은 효과 시간 확인'],['!킵','DJ·청취자 모두 내 보유 보상 조회 · 프로필 자동 생성'],['!킵 사용 1','내 1번 보상 1개 사용 · 보유 목록에서 제거하고 완료 내역 저장'],['!킵 완료','내 킵 사용 완료 내역 조회'],['!킵 취소','가장 최근 사용 취소 · 보유 목록으로 복원'],['!킵 취소 1','완료 목록의 1번 사용 취소 · 번호·보상명 지정 가능']]],
 ['신청곡과 안내',[['!신청곡 가수 - 제목','신청곡 접수'],['!신청취소','마지막으로 신청한 본인 대기곡 취소'],['!신청취소 2','전체 대기열 2번 곡이 본인 신청곡일 때 취소'],['!신청곡목록 [페이지]','대기 중인 신청곡 확인'],['!이전곡','DJ: 이전곡 선택 → !재생 / 청취자: 제목 조회'],['!현재곡','현재곡 확인'],['!다음곡','DJ: 다음 대기곡 선택 → !재생 / 청취자: 제목 조회'],['!재생','DJ 전용 · 선택곡 재생 또는 현재곡 이어서 재생'],['!멈춤','DJ 전용 · 현재 재생 일시정지'],['!삭제 [번호]','DJ 전용 · !삭제 후 번호 입력 또는 !삭제 2'],['!이전곡 삭제','가수·곡명 입력 → 이전곡·완료 기록 삭제'],['!다음곡 삭제','가수·곡명 입력 → 대기곡 삭제'],['!보이스카드','DJ의 별도 음성메시지 접수 링크'],['!스푼','충전 안내와 공식 링크 · 링크를 눌러 이동'],['!공지','DJ 공지 확인'],['!도움말','사용 가능한 명령 확인']]],
 ['DJ 전용',[['!게임 off','게임 끄기는 DJ만 가능'],['!낚시 off','낚시 끄기는 DJ만 가능'],['!홀짝 off','홀짝 끄기는 DJ만 가능'],['!복권지급 닉네임 3','@닉네임 일부·ID·비공개 연결 이메일로 지급 · 여러 명 일치 시 더 구체적으로 입력 · 음수 회수'],['!복권지급 전체 3','등록된 모든 청취자에게 3장씩 지급 · 1~1,000장 · 수량 필수 · 회수는 불가'],['!계정연결 닉네임 @스푼아이디','스푼 프로필의 @아이디를 청취자와 한 번 연결 · 이후 !복권지급 @스푼아이디 3 으로 지급'],['!대결 청 / !대결 백','팀 대결 참가 · 참가 후 후원한 스푼이 팀 합계에 더해지고 목표 스푼(기본 100)을 먼저 모은 팀이 승리 · !대결 현황으로 확인'],['!대결 시작 5','DJ 전용 · 5분 청팀 vs 백팀 대결 시작 (!대결 시작 5 200처럼 목표 스푼 지정 가능) · !대결 종료 / !대결 취소 · !대결 개인 시작 5는 개인 순위 대결'],['!랭킹등록 월 45','DJ 전용 · 일라디·월라디·지난달 순위 입력 (!랭킹등록 일 12 · 지난달 85 · 초기화) · 초이스 등급은 월라디 순위로 자동 계산'],['!복권 초기화 @고유ID','지정 청취자의 복권을 0장으로 초기화 · EXP·PT 유지'],['!조용 on','조용 모드 켜기'],['!조용 off','조용 모드 끄기']]]
];
function searchBox(key,label){return `<div class="search-toolbar"><label class="search-field">검색<input type="search" data-filter="${key}" value="${esc(filters[key])}" placeholder="${label}" aria-label="${label}"></label><span id="filter-count" class="small"></span></div><p id="filter-empty" class="empty" hidden>검색 결과가 없습니다. 다른 검색어를 입력하세요.</p>`;}
function applyFilter(){const input=$('[data-filter]');if(!input)return;const q=input.value.trim().toLocaleLowerCase('ko-KR');let count=0;const rows=[...document.querySelectorAll('[data-search]')];rows.forEach(row=>{row.hidden=!row.dataset.search.toLocaleLowerCase('ko-KR').includes(q);if(!row.hidden)count++;});document.querySelectorAll('[data-command-group]').forEach(group=>group.closest('.card').hidden=![...group.querySelectorAll('[data-search]')].some(row=>!row.hidden));$('#filter-count').textContent=`${count} / ${rows.length}건`;$('#filter-empty').hidden=!q||count>0;}
function setDirty(value){dirty=value;updateDirty();}
function updateDirty(){const bar=$('#save-bar');if(bar)bar.hidden=!dirty;document.body.classList.toggle('has-unsaved',dirty);}
function mayLeave(){return !dirty||confirm('저장하지 않은 변경사항이 있습니다. 저장하지 않고 이동할까요?');}
document.addEventListener('input',e=>{const el=e.target;if(el.matches('#test-user,#test-name,#test-dj')){testIdentity={user:$('#test-user').value,name:$('#test-name').value,dj:$('#test-dj').checked};persistHistory();updateTestReadiness();}if(el.dataset.filter){filters[el.dataset.filter]=el.value;applyFilter();return;}if(el.matches('[data-roulette]'))updateRouletteOdds();if(el.matches('[data-setting],[data-field],[data-item-enabled],[data-fish],[data-notice],[data-menu],[data-roulette],[data-reply],[data-quiz],#auto-chat-messages,#banned'))setDirty(true);});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
function helpWorkspace(){return searchBox('help','명령어 또는 기능 검색')+`<div class="note">청취자는 먼저 <strong>!내정보 생성</strong>을 입력해야 합니다. 개인 대기시간 ${room.settings.cooldown}초와 방송 응답 간격 ${room.settings.responseGap}초가 적용됩니다.</div><div class="grid two">${commandGroups.map(([title,commands])=>card(title,`<div class="command-list" data-command-group>${commands.map(([cmd,desc])=>`<div class="command-entry" data-search="${esc(cmd+' '+desc)}"><div><code>${esc(cmd)}</code><p class="small">${esc(desc)}</p></div>${room.id==='demo'?`<button data-test-command="${esc(cmd)}" data-page="test">테스트</button>`:''}</div>`).join('')}</div>`)).join('')}</div>`;}
function testWorkspace(){if(room.id!=='demo')return empty('명령어 테스트는 로컬 테스트 모드에서만 사용할 수 있습니다.');return `<div class="grid test-layout"><div>${testPanel()}<button data-action="test-like" style="margin-top:12px">♥ 좋아요 이벤트 테스트</button>${donationTestPanel()}</div><div class="stack">${card('빠른 명령어',`<p class="small">명령을 선택하면 입력창에 채워집니다. 내용을 확인한 후 전송하세요.</p><div class="command-chips">${['!내정보 생성','!출석','!내정보','!게임 on','!게임 off','!낚시','!복권 자동','!복권 3 6 9','!복권 초기화 @고유ID','!아이템 상점','!룰렛','!가위바위보 바위','!주사위','!주사위 자동','!주사위 4','!숫자맞히기 50','!퀴즈','!정답 서울','!포기','!퀴즈 포기','!자동퀴즈 on 10','!자동퀴즈 상태','!자동퀴즈 off','!보이스카드','!스푼','!신청곡 가수 - 제목','!이전곡','!현재곡','!다음곡','!재생','!멈춤','!삭제 1','!게임 상태','!대결 시작 5','!대결 청','!대결 백','!대결 현황','!대결 종료','!대결 개인 시작 5','!랭킹조회','!초이스','!초이스안내','!랭킹등록 월 45','!복권지급 전체 3','!계정연결 닉네임 @아이디','!옷차림 서울','!옷차림 서울 강남구','!옷차림 전국'].map(cmd=>`<button data-test-command="${esc(cmd)}">${esc(cmd)}</button>`).join('')}</div>`)}<div id="listener-progress">${profileCard(testIdentity.user)}</div>${card('테스트 상태',`<div class="line"><span>등록 청취자</span><strong>${Object.keys(room.users).length}명</strong></div><div class="line"><span>낚시 / 홀짝</span><strong>${room.settings.fishing?'ON':'OFF'} / ${room.settings.odd?'ON':'OFF'}</strong></div><div class="line"><span>대기 신청곡</span><strong>${room.songs.length}곡</strong></div><div class="line"><span>퀴즈 / 정답 보상</span><strong>${room.settings.quiz?'ON':'OFF'} / ${num(room.settings.quizExp)} EXP</strong></div><p class="small">게임 ON: 청취자 가능 / 게임 OFF: DJ 전용. 명령 사이에는 ${room.settings.cooldown}초 기다리세요.</p><button data-page="games">게임 설정 열기 →</button>`)}${card('진행 순서','<ol class="list"><li>!내정보 (자동 생성) → 대기 → !출석</li><li>복권을 받으면 대기 후 복권 명령 실행</li><li>청취자도 !게임 on 또는 !낚시 on으로 게임 켜기 가능</li><li>PT는 청취자 메뉴에서 수동 지급 가능</li></ol>')}</div></div>`;}
function profileCard(id){
 const u=Object.hasOwn(room.users,id)?room.users[id]:null;if(!u)return card('나의 성장 기록','<p class="small">!내정보를 입력하면 프로필이 자동 생성되고 레벨과 경험치가 여기에 표시됩니다.</p>');
 const p=levelProgress(u.exp,room.settings.levelStep);
 return card('나의 성장 기록',`<div class="growth-heading"><span class="level-medal">Lv.${p.level}</span><div><strong>${esc(u.name)}</strong><div class="small">누적 ${num(u.exp)} EXP</div></div></div><progress class="exp-progress" value="${p.current}" max="${p.required}" aria-label="다음 레벨 진행도"></progress><p class="small">${p.percent}% · 다음 레벨까지 <strong>${num(p.remaining)} EXP</strong></p><div class="growth-wallet"><span>복권 <strong>${num(u.tickets)}장</strong></span><span>포인트 <strong>${num(u.pt)} PT</strong></span></div>${u.quizRound?`<p class="quiz-current">진행 중인 퀴즈<br><strong>${esc(u.quizRound.question)}</strong><br><span data-quiz-expiry="${u.quizRound.expiresAt}"></span></p>`:''}`);
}
function updateTestReadiness(){
 const feedback=$('#command-feedback');if(!feedback||!room)return;
 document.querySelectorAll('#test-form input,#test-form button,#test-user,#test-name,#test-dj').forEach(control=>control.disabled=busy);
 if($('#test-form button'))$('#test-form button').textContent=busy?'처리 중…':'전송';
 const id=$('#test-user').value,dj=$('#test-dj').checked,wait=commandWait(room,id,dj);
 feedback.classList.toggle('waiting',!dj&&wait>0);
 feedback.textContent=busy?'명령을 처리하고 있어요. 잠시만 기다려 주세요.':dj?'DJ 테스트 모드 · 프로필 생성·게임 참여·게임 끄기·복권 지급이 가능합니다.':wait?`청취자 모드 · 다음 명령까지 ${wait}초 남았어요. 권한 제한이 아닌 대기시간입니다.`:'청취자 모드 · 지금 명령을 보낼 수 있어요. !게임 on도 가능합니다.';
 const expiry=document.querySelector('[data-quiz-expiry]');if(expiry){const left=Math.ceil((Number(expiry.dataset.quizExpiry)-Date.now())/1000);expiry.textContent=left>0?`남은 시간 ${left}초`:'시간이 끝났어요. !퀴즈로 새 문제를 받아 주세요.';}
 const host=$('#listener-progress');if(host&&host.dataset.user!==id){host.innerHTML=profileCard(id);host.dataset.user=id;}
}
setInterval(updateTestReadiness,1000);
// 모의 후원: 결제 없이 후원 알림을 흉내 내서 봇의 반응(감사 인사·후원 보상·후원 대결 합산·큰 후원 복권)을 시험합니다. (로컬 테스트 화면 전용)
function donationTestPanel(){
  return card('모의 후원 (결제 없음)',`<p class="small">위에 입력한 고유 ID·닉네임이 후원자가 됩니다. 후원 대결은 먼저 <b>!대결 시작 2</b>(DJ 권한)와 <b>!대결</b>(참가)로 열어 두세요.</p><div class="command-chips">${[5,9,10,20,50,100,500].map(v=>`<button data-action="test-donation" data-amount="${v}">${v}스푼</button>`).join('')}</div><div class="chat-form" style="margin-top:10px"><input id="test-donation-amount" type="number" min="1" step="1" value="10" aria-label="모의 후원 스푼"><button class="primary" data-action="test-donation">모의 후원 보내기</button></div>`);
}
async function sendDonation(amount){
  if(busy)return;
  if(!Number.isSafeInteger(amount)||amount<1){toast('후원 스푼은 1 이상의 정수로 입력해 주세요.');return;}
  if(!$('#test-user').value.trim()||!$('#test-name').value.trim()){toast('위의 고유 ID와 닉네임을 입력해 주세요.');return;}
  testIdentity={user:$('#test-user').value,name:$('#test-name').value,dj:$('#test-dj').checked};
  busy=true;
  chats.push({text:`${testIdentity.name}: [모의 후원 ${amount}스푼]`});renderChats();
  try{
   const out=await api('/api/test-donation',{amount,user:testIdentity.user,name:testIdentity.name});
   // 실제 방송에서 채팅으로 나갈 메시지를 순서대로 보여 줍니다.
   if(out.messages.length)for(const text of out.messages)chats.push({bot:true,text});
   else chats.push({bot:true,text:'후원에 대한 반응이 없습니다. 메뉴판·감사 문구와 후원 보상 설정을 확인하세요.'});
   if(out.battleCounted)chats.push({bot:true,text:`(후원 대결에 ${amount}스푼이 합산되었습니다)`});
   chats=chats.slice(-100);renderChats();await reload();
  }catch(err){chats.push({bot:true,text:err.message});chats=chats.slice(-100);renderChats();toast(err.message);}
  finally{busy=false;updateTestReadiness();}
}
async function sendTest(message,like=false){
 if(busy||!message.trim())return;
 if(!$('#test-user').value.trim()||!$('#test-name').value.trim()){toast('고유 ID와 닉네임을 입력해 주세요.');return;}
 testIdentity={user:$('#test-user').value,name:$('#test-name').value,dj:$('#test-dj').checked};
 busy=true;const button=$('#test-form button');button.disabled=true;button.textContent='처리 중…';
 chats.push({text:`${testIdentity.name}: ${message}`});renderChats();updateTestReadiness();
 try{
  const out=await api(like?'/api/test-like':'/api/test',{message,...testIdentity});
  chats.push({bot:true,text:out.text||(like?'인사가 생략되었습니다. 같은 청취자의 10분 간격, 조용 모드, 전체 응답 간격과 인사 설정을 확인하세요.':suppressionMessage(out))});
  chats=chats.slice(-100);renderChats();await reload();$('#test-form')?.message.focus();
 }catch(err){
  const text=err.name==='TimeoutError'?'처리 응답이 지연되고 있습니다. 다시 보내기 전에 새로고침으로 보유 복권과 처리 기록을 확인해 주세요.':err.message;
  chats.push({bot:true,text});chats=chats.slice(-100);renderChats();toast(text);
 }finally{busy=false;if(button.isConnected){button.disabled=false;button.textContent='전송';}updateTestReadiness();}
}

const logNames={'monthly-reset':'월간 초기화','pt-reward':'게임 PT 지급','ticket-grant':'복권 지급·회수','donation-exp':'후원 레벨 보상','battle':'대결 보상','battle-result':'대결 결과','battle-start':'대결 시작','battle-cancel':'대결 취소','ticket-reset':'복권 초기화','attendance':'출석','lottery':'복권 추첨','fishing-miss':'낚시 꽝','fishing':'낚시','odd-even':'홀짝','purchase':'아이템 구매','item-use':'아이템 사용','settings-update':'설정 변경','game-control':'게임 ON/OFF 변경','song-action':'신청곡 관리','manual-adjust':'수동 지급·회수','keep-update':'킵 관리','roulette':'룰렛 추첨','like-greeting':'좋아요 인사','program-intro':'프로그램 소개 안내','auto-chat':'주기 자동채팅','announcement':'주기 안내','keyword-reply':'키워드 자동응답','minigame-rps':'가위바위보','minigame-dice':'주사위','minigame-numberGuess':'숫자맞히기','minigame-quiz':'퀴즈 정답 보상','voice-link':'음성 접수 링크 변경','voice-action':'음성메시지 처리','special-claim':'특별 보상 처리','settings-restore':'설정 복원','chat-suppressed':'응답 대기','chat-send-failed':'채팅 전송 실패','banned-word':'금칙어 감지','connection-error':'연결 오류'};
function logDetail(log){const d=log.data;let text='';if(log.type==='pt-reward')text=`${num(d.paid)} PT 지급 (요청 ${num(d.requested)} PT)`;else if(log.type==='manual-adjust')text=`${num(d.amount)} ${d.kind==='pt'?'PT':'장'} · ${d.reason}`;else if(log.type==='ticket-reset')text=`복권 ${num(d.previous)}장 → 0장 초기화 · 실행자 ${d.actor}`;else if(log.type==='ticket-grant')text=d.count===0?'복권 수량 변경 없음':`복권 ${num(Math.abs(d.count))}장 ${d.count<0?'회수':'지급'}`;else if(log.type==='battle')text=`${d.rank}등 · ${num(d.total)}스푼 · +${num(d.pt)} PT +${num(d.exp)} EXP`;else if(log.type==='donation-exp')text=`${num(d.amount)}스푼 후원 · +${num(d.exp)} EXP · Lv.${d.levelBefore}${d.levelAfter>d.levelBefore?` → Lv.${d.levelAfter}`:''}`;else if(log.type==='roulette')text=d.miss?`${d.name} · 사용내역에 기록`:`${d.name} · 킵 자동 등록`;else if(log.type==='like-greeting')text='좋아요 감사 인사를 전송했습니다.';else if(log.type==='program-intro')text='10분 프로그램 소개 안내를 전송했습니다.';else if(log.type==='attendance')text=`복권 ${d.tickets}장`;else if(log.type==='fishing')text=`${d.fish} · ${d.size}cm · ${num(d.exp)} EXP · ${num(d.paid)} PT${d.held?' · 보상 확인 대기':''}`;else if(log.type==='minigame-quiz')text=`정답 +${num(d.exp)} EXP · 누적 ${num(d.totalExp)} EXP · Lv.${d.level}`;else if(log.type==='lottery')text=d.auto&&d.used>1?`자동 복권 ${num(d.used)}장 사용 · ${num(d.exp)} EXP · 남은 ${num(d.remaining)}장`:`${d.matches}개 일치 · ${num(d.exp)} EXP`;else if(log.type==='song-action')text=({next:'다음 곡을 현재곡으로 지정',finish:'현재곡 완료',remove:'대기열에서 삭제',move:'대기열 순서 변경',undo:'삭제한 신청곡 복원'})[d.action]||d.action;else if(log.type==='settings-update')text='방송 설정을 저장했습니다.';else if(log.type==='settings-restore')text='백업한 방송 설정을 복원했습니다.';else if(log.type==='odd-even')text=`${num(d.stake)} PT 베팅 · ${d.win?'당첨':'실패'}`;return text?esc(text):`<details><summary>상세 보기</summary><span class="mono">${esc(JSON.stringify(d))}</span></details>`;}
function updateRouletteOdds(){const rows=[...document.querySelectorAll('[data-roulette-row]')],total=rows.reduce((sum,row)=>sum+Math.max(0,Number(row.querySelector('[data-roulette=weight]').value)||0),0);rows.forEach(row=>{const weight=Math.max(0,Number(row.querySelector('[data-roulette=weight]').value)||0);row.querySelector('[data-roulette-odds]').textContent=`${total?(weight/total*100).toFixed(2):'0'}%`;});}
function roulettePanel(){const rewards=room.settings.rouletteRewards,total=rewards.reduce((sum,r)=>sum+Number(r.weight||0),0);return `<section class="card" style="margin-top:20px"><div class="section-head"><h2>룰렛 · 자동 킵 등록</h2><button data-action="add-roulette">+ 보상 추가</button></div>${toggle('roulette','룰렛 사용')}<p class="small">청취자는 !룰렛으로 추첨합니다. 참가 PT 차감은 없습니다. 당첨은 킵에 추가하고 꽝은 사용내역으로 분리합니다. 기본 OFF이며, 켜려면 당첨 보상을 하나 이상 등록하세요. 개인 명령어 대기시간이 적용됩니다.</p>${table(['보상 이름','가중치','꽝으로 처리','현재 비율',''],rewards.map((r,i)=>`<tr data-roulette-row="${i}"><td><input data-roulette="name" value="${esc(r.name)}" aria-label="룰렛 보상 이름" maxlength="100"></td><td><input data-roulette="weight" type="number" min="1" max="100000" value="${r.weight}" aria-label="룰렛 가중치"></td><td><input data-roulette="miss" type="checkbox" ${r.miss?'checked':''} aria-label="꽝 처리"></td><td data-roulette-odds>${total?(r.weight/total*100).toFixed(2):'0'}%</td><td><button data-delete-roulette="${i}">삭제</button></td></tr>`))}<p class="small">비율은 가중치를 바꾸면 자동으로 계산됩니다. 저장해야 실제 추첨에 적용됩니다.</p>${saveButton()}</section>`;}
function keepHistoryPanel(users){const entries=users.flatMap(u=>(u.keepHistory||[]).map(h=>({...h,user:u.name}))).sort((a,b)=>b.time-a.time);return `<div class="card" style="margin-top:20px"><h2>킵 사용내역 · 룰렛 꽝</h2><p class="small">보유 킵과 분리해 보관합니다. 꽝은 보유 수량에 포함되지 않습니다.</p>${entries.length?table(['시간 (한국)','청취자','보상','처리'],entries.map(h=>`<tr><td>${new Date(h.time).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</td><td>${esc(h.user)}</td><td>${esc(h.text)}</td><td>${h.kind==='miss'?'룰렛 꽝':h.kind==='cancelled'?'사용 취소 · 보유 복원':'사용 완료'}</td></tr>`)):empty('사용하거나 꽝이 나온 내역이 없습니다.')}</div>`;}
const checkpoint=new PlaybackPosition({storage:()=>localStorage,room:()=>room?.id});
const youtube=new YouTubePlayer({checkpoint,onEnd:()=>void playback.ended(playback.song?.id),onError:message=>playback.stop(message),onStatus:message=>$('#playback-status').textContent=message});
const playback=new Playback({api,mayPlay:()=>!document.hidden,load:(id,guard,songId)=>youtube.load(id,guard,songId),pause:()=>youtube.pause(),onStatus:message=>$('#playback-status').textContent=message,onRoom:next=>{
 const draftBase=savedRoom,draft=dirty?collect():null,draftName=$('[data-field="roomName"]')?.value;room=next;savedRoom=draft?draftBase:structuredClone(next);if(draft){room.settings=draft;room.settingsRevision=draftBase.settingsRevision;if(draftName!==undefined)room.name=draftName;}render();
}});
let requestAutoplay=true;try{requestAutoplay=localStorage.getItem('radiomate-request-autoplay')!=='off';}catch{}
$('#request-autoplay').checked=requestAutoplay;
$('#request-autoplay').onchange=e=>{requestAutoplay=e.target.checked;try{localStorage.setItem('radiomate-request-autoplay',requestAutoplay?'on':'off');}catch{}if(requestAutoplay){playback.receivePaused=false;void playback.receive(room);}};
$('#playback-start').onclick=()=>void playback.start(room);
$('#playback-pause').onclick=()=>playback.stop();
$('#autoplay-enabled').onchange=e=>playback.auto=e.target.checked;
setInterval(()=>{if(youtube.playing&&!document.hidden)youtube.savePosition();},5000);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playback.running)playback.stop('다른 앱으로 전환해 재생을 멈췄습니다. 돌아온 뒤 재생 시작을 눌러 이어서 들으세요.');});
addEventListener('pagehide',()=>playback.stop());
addEventListener('pageshow',event=>{if(event.persisted&&session?.loggedIn)void refreshSharedRoom();});
const extraUI=createExtraUI({card,toggle,field,saveButton,table,empty,esc});
document.addEventListener('play',event=>{
 const audio=event.target;if(!audio.dataset?.voiceAudio)return;
 document.querySelectorAll('audio[data-voice-audio]').forEach(other=>{if(other!==audio)other.pause();});const id=audio.dataset.voiceAudio,entry=voiceInbox?.cards.find(c=>c.id===id);if(!entry||entry.is_read)return;entry.is_read=1;
 void run(async()=>{try{await api('/api/voice-action',{id,action:'read'});}catch(error){entry.is_read=0;throw error;}
 const label=document.querySelector(`[data-voice-read="${id}"]`);if(label)label.textContent='읽음';
 const button=document.querySelector(`[data-voice-id="${id}"][data-voice-action="read"]`);if(button){button.dataset.voiceAction='unread';button.textContent='안 읽음으로 표시';}
 if($('#voice-unread-count'))$('#voice-unread-count').textContent=`${voiceInbox.cards.filter(c=>!c.is_read).length}개 안 읽음`;
 });
},true);

decorateStudio();
void run(init);




// Avoid rerendering while the DJ is editing or listening to a voice message.
let refreshing=false;
async function refreshSharedRoom(){
 if(refreshing||!session?.loggedIn)return;
 refreshing=true;const version=navigationVersion;try{
  const next=await api('/api/room');if($('#runtime-automation-status'))$('#runtime-automation-status').textContent=runtimeSummary(next);$('#connection').textContent=next.connection;
  await playback.syncControl(next);
  if(requestAutoplay)await playback.receive(next);
  if(version!==navigationVersion)return;
  const editing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||[...document.querySelectorAll('audio[data-voice-audio]')].some(a=>!a.paused);
  const action=sharedSettingsAction(room,next,{dirty,busy,editing});
  if($('#settings-sync-alert'))$('#settings-sync-alert').hidden=action!=='conflict';
  if(dirty||busy||action==='defer')return;
  if(action==='reload'){room=next;savedRoom=structuredClone(next);render();await playback.sync(next);return;}
  if(page==='voice'){
   const inbox=await api('/api/voice-inbox');
   if(!dirty&&!busy&&version===navigationVersion&&page==='voice'&&![...document.querySelectorAll('audio[data-voice-audio]')].some(a=>!a.paused)&&JSON.stringify(inbox)!==JSON.stringify(voiceInbox)){
    voiceInbox=inbox;room=next;savedRoom=structuredClone(next);render();
   }
  }else if(page==='fans'&&JSON.stringify(next.users)!==JSON.stringify(room.users)&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){room=next;savedRoom=structuredClone(next);render();}
  else if((JSON.stringify(next.songs)!==JSON.stringify(room.songs)||JSON.stringify(next.current)!==JSON.stringify(room.current)||JSON.stringify(next.songSelection)!==JSON.stringify(room.songSelection))){room=next;savedRoom=structuredClone(next);render();}
  await playback.sync(next);
 }catch{}finally{refreshing=false;}
}
setInterval(()=>void refreshSharedRoom(),4000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshSharedRoom();});
addEventListener('online',()=>void refreshSharedRoom());
addEventListener('focus',()=>void refreshSharedRoom());
