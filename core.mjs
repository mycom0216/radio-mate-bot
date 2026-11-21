import {setAutomation} from './automation.mjs';
import {assistantRequest} from './lifestyle.mjs';
import {Conversation,squash} from './converse.mjs';
import {diningQuery,diningPrompt,normalizeCommand} from './dining.mjs';
import {travelKinds,travelQuery,travelPrompt} from './travel.mjs';
import {DEFAULT_CHARGE_NOTICE,LEGACY_CHARGE_NOTICE,spoonChargeReply} from './public/spoon-charge.mjs';
import {touchQueue,applySongAction} from './song-queue.mjs';
import {rewardListening} from './listening.mjs';
import {parseTicketGrant,resolveTarget} from './targets.mjs';
import {deleteSongCommand} from './song-deletion.mjs';
import {affinityScore,affinityRank,creditChat,collectAffinityNotices} from './public/affinity.mjs';
import {savedSongVideo,rememberSongVideo} from './song-library.mjs';
import {chatPage} from './pagination.mjs';
import {Outbox} from './outbox.mjs';
import {LOTTERY_CHUNK,lotterySummary,lotterySummaryAsync,lotteryExp} from './lottery.mjs';
import {playQuiz,plainQuizAnswer,activeQuizRound} from './quiz.mjs';
import {extraDefaults,normalizeExtras,validateExtras,keywordReply,keywordMatches,playMiniGame} from './extras.mjs';
import {parseSongRequest,songVideoId,groupKeeps,keepName,keepExpiryLabel} from './public/song-utils.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID,randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const LIMIT = { exp: 200000, fish: 200000, odd: 500000, total: 1000000 };
export const RARITIES = ['일반', '고급', '희귀', '영웅', '전설'];
const ranges = [[50,2000],[2050,5000],[5050,10000],[10050,50000],[50050,80000]];
export const ITEMS = [
  { id:'rare', name:'희귀 물고기 확률 UP', price:10000, minutes:20, enabled:true, stock:null },
  { id:'exp', name:'낚시 EXP 2배', price:20000, minutes:20, enabled:true, stock:null },
  { id:'odd', name:'홀 확률 UP', price:50000, minutes:20, enabled:true, stock:null },
];
export function defaults() {
  return {
    ...extraDefaults(),
    pauseItems:false, cooldown:20, responseGap:3, quiet:false, fishing:false, odd:false,
    roulette:false, rouletteRewards:[{id:'miss',name:'꽝',weight:1,miss:true}],
    spoonNotice:DEFAULT_CHARGE_NOTICE,
    introEnabled:true,introText:'🤖 방송 도우미 메이트예요! 신청곡·출석·게임을 돕고, 명령어 없이 말을 걸어도 대답해요 ♡ 명령어는 !도움말로 확인하세요.',
    likeGreetingEnabled:true,likeGreeting:'{name}님, 좋아요 감사합니다 ♥',
    attendance:true, requests:true, duplicateSongs:false, requestMax:10,
    expPerCast:60, miss:0, payout:'random', goldenPolicy:'pending',
    betMin:100, betMax:50000, levelStep:10000,
    notice:'하트를 눌러주세요 ♥', welcome:'{name}님, 어서 오세요!',
    // donation은 기본 감사 인사입니다. donationReactions에는 {"10": "하트 💖"}처럼 금액별 문구를 저장합니다.
    donation:'{name}님, {amount} 스푼 감사합니다!', donationReactions:{}, bannedWords:[],
    monthlyRank:'', monthlyRankMonth:'', playlistMode:false, playlistTitle:'플레이리스트 방송',
    fish:[
      ['붕어',0,35,10,40],['피라미',0,25,5,15],['잉어',1,20,30,100],
      ['붕어(희귀)',2,12,20,50],['참치',3,6,100,250],['황금잉어',4,1,40,100],
      ['황금주사위',4,1,5,10],
    ].map(([name,rarity,weight,minSize,maxSize],i)=>({id:`fish-${i}`,name,rarity,weight,minSize,maxSize,minPt:ranges[rarity][0],maxPt:ranges[rarity][1],golden:name==='황금주사위'})),
    items:structuredClone(ITEMS),
    announcements:[{id:'heart',enabled:false,minutes:10,text:'하트를 눌러주세요 ♥'}],
    pending:['기본 물고기·확률은 예시값','물고기 PT 무작위 지급은 임시값','황금주사위 한도 정책 미정: 보상 보류','복권 1장·독립 추첨은 임시값','베팅 100~50,000 PT·레벨당 10,000 EXP는 임시값'],
  };
}
export function dates(ms=Date.now()) {
  const day = new Date(ms+9*3600000).toISOString().slice(0,10);
  return {day,month:day.slice(0,7)};
}
export function validateSettings(s) {
  // 이 기능이 생기기 전에 저장한 설정에는 메뉴판이 없으므로 빈 메뉴판부터 시작합니다.
  s.donationReactions??={};
  // 저장하거나 백업을 복원할 때도 채팅에서 등록할 때와 같은 개수, 금액, 문구 길이 제한을 확인합니다.
  if(!s.donationReactions||typeof s.donationReactions!=='object'||Array.isArray(s.donationReactions)||Object.keys(s.donationReactions).length>50||Object.entries(s.donationReactions).some(([amount,reaction])=>!validReactionAmount(amount)||typeof reaction!=='string'||!reaction.trim()||reaction.length>100||/[\r\n]/.test(reaction)))throw Error('메뉴판은 최대 50개이며, 각 항목은 양의 정수 스푼과 1~100자 한 줄 문구가 필요합니다.');
  validateExtras(s);s.pauseItems??=false;if(typeof s.pauseItems!=='boolean')throw Error('아이템 일시정지 설정을 확인하세요.');
  s.spoonNotice??=defaults().spoonNotice;if(typeof s.spoonNotice!=='string'||!s.spoonNotice.trim()||s.spoonNotice.length>200)throw Error('스푼 충전 안내는 1~200자로 입력하세요.');
  s.introEnabled??=true;s.introText??=defaults().introText;if(typeof s.introEnabled!=='boolean'||typeof s.introText!=='string'||!s.introText.trim()||s.introText.length>200)throw Error('프로그램 소개 문구는 1~200자로 입력하세요.');
  s.roulette??=false;s.rouletteRewards??=defaults().rouletteRewards;s.likeGreetingEnabled??=true;s.likeGreeting??=defaults().likeGreeting;
  if(typeof s.roulette!=='boolean'||typeof s.likeGreetingEnabled!=='boolean'||typeof s.likeGreeting!=='string'||!s.likeGreeting.trim()||s.likeGreeting.length>200)throw Error('룰렛·좋아요 인사 설정을 확인하세요.');
  if(!Array.isArray(s.rouletteRewards)||!s.rouletteRewards.length||s.rouletteRewards.length>30)throw Error('룰렛 항목은 1~30개로 설정하세요.');
  const rewardIds=new Set();for(const item of s.rouletteRewards){if(typeof item.id!=='string'||!item.id||rewardIds.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>100||!Number.isSafeInteger(item.weight)||item.weight<1||item.weight>100000||typeof item.miss!=='boolean')throw Error('룰렛 보상 이름·가중치·꽝 여부를 확인하세요.');rewardIds.add(item.id);}
  if(s.roulette&&!s.rouletteRewards.some(i=>!i.miss))throw Error('룰렛을 켜려면 당첨 보상을 하나 이상 등록하세요.');
  const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
  for (const [k,min,max] of [['cooldown',1,3600],['responseGap',1,120],['requestMax',1,100],['expPerCast',60,60],['betMin',1,500000],['betMax',1,500000],['levelStep',1,100000000]])
    if(!integer(s[k],min,max)) throw Error(`${k}: ${min}~${max} 사이 정수가 필요합니다.`);
  if(s.betMin>s.betMax) throw Error('최소 베팅이 최대 베팅보다 큽니다.');
  if(!Number.isFinite(s.miss)||s.miss<0||s.miss>100) throw Error('꽝 확률은 0~100입니다.');
  if(!['random','fixed'].includes(s.payout)||!['pending','fishing','special'].includes(s.goldenPolicy)) throw Error('보상 정책이 잘못되었습니다.');
  for(const k of ['quiet','fishing','odd','attendance','requests','duplicateSongs','playlistMode']) if(typeof s[k]!=='boolean') throw Error(`${k}: ON/OFF 값이 필요합니다.`);
  for(const k of ['notice','welcome','donation','monthlyRank','monthlyRankMonth','playlistTitle']) if(typeof s[k]!=='string'||s[k].length>500) throw Error(`${k}: 500자 이하 문구가 필요합니다.`);
  if(!Array.isArray(s.fish)||!s.fish.length||s.fish.length>100) throw Error('물고기는 1~100종을 등록하세요.');
  const ids=new Set();
  for(const f of s.fish) {
    if(!f.id||ids.has(f.id)||typeof f.name!=='string'||!f.name.trim()||f.name.length>40) throw Error('물고기 ID·이름이 잘못되었습니다.');
    ids.add(f.id);
    if(!integer(f.rarity,0,4)||!Number.isFinite(f.weight)||f.weight<=0||f.weight>100000) throw Error('희귀도·가중치를 확인하세요.');
    for(const k of ['minPt','maxPt']) if(!integer(f[k],ranges[f.rarity][0],ranges[f.rarity][1])) throw Error(`${f.name}: 등급별 PT 범위를 벗어났습니다.`);
    if(f.minPt>f.maxPt||!integer(f.minSize,1,100000)||!integer(f.maxSize,f.minSize,100000)) throw Error('크기·보상 범위를 확인하세요.');
    if(f.golden&&f.rarity!==4) throw Error('황금주사위는 전설 등급이어야 합니다.');
  }
  if(!s.fish.some(f=>f.rarity>=2)||!s.fish.some(f=>f.rarity<2)) throw Error('확률 아이템을 위해 희귀 이상·미만 물고기가 각각 필요합니다.');
  if(!Array.isArray(s.items)||s.items.length!==3||new Set(s.items.map(i=>i.id)).size!==3) throw Error('상점 기본 상품 3종이 필요합니다.');
  for(const i of s.items) {
    if(i.stock===undefined)i.stock=null;
    if(!ITEMS.some(x=>x.id===i.id)||typeof i.name!=='string'||!i.name.trim()||i.name.length>40||!integer(i.price,1,100000000)||i.minutes!==20||typeof i.enabled!=='boolean'||i.stock!==null&&!integer(i.stock,0,1000000)) throw Error('상품 설정을 확인하세요.');
  }
  if(!Array.isArray(s.announcements)||s.announcements.length>30) throw Error('자동 안내는 최대 30개입니다.');
  const notices=new Set();
  for(const a of s.announcements) {
    if(typeof a.id!=='string'||notices.has(a.id)||!integer(a.minutes,1,1440)||typeof a.text!=='string'||!a.text.trim()||a.text.length>200||typeof a.enabled!=='boolean') throw Error('안내 ID·간격·문구를 확인하세요.');
    notices.add(a.id);
  }
  if(!Array.isArray(s.bannedWords)||s.bannedWords.length>100||s.bannedWords.some(x=>typeof x!=='string'||!x||x.length>40)) throw Error('금칙어 목록을 확인하세요.');
  s.pending=defaults().pending;
  return s;
}
const freshUser=(id,name,month)=>({id,name,month,exp:0,pt:0,tickets:0,attendance:'',daily:{day:'',fishExp:0,fishPt:0,oddPt:0,totalPt:0},bag:{},buffs:{},book:{},keeps:[],lastCommand:0});
const n=x=>Number(x).toLocaleString('ko-KR');
// 느낌표 뒤 첫 낱말이 이 목록에 있으면 진짜 명령어입니다. "!간호사"처럼 정답만 입력한 말과 구분하는 데 쓰며, 겹치면 명령어가 우선입니다.
const KNOWN_COMMANDS=['채팅방','전국날씨','날씨','맛집','카페','채팅','대화','내정보','출석','낚시','홀','짝','홀짝','복권','랭킹','랭킹조회','애청랭킹','경험치랭킹','애청지수','라디오메이트','봇호출','랭크','신청곡','신청취소','신청곡취소','신청곡목록','현재곡','다음곡','이전곡','재생','멈춤','삭제','도감','아이템','가방','버프','킵','룰렛','가위바위보','주사위','숫자맞히기','퀴즈','정답','보이스카드','스푼','도움말','공지','낚시정보'];
// 느낌표로 시작하는 말 중에서 메뉴판을 봇이 알아듣는 명령 목록에 넣습니다.
KNOWN_COMMANDS.push('메뉴판');
const COMMAND_WORDS=new Set([...KNOWN_COMMANDS,'자동운영','자동퀴즈','복권초기화','복권지급','조용','게임','구매','포기','취소']);
// 0, 음수, 소수는 받지 않습니다. 컴퓨터가 정확하게 기억할 수 있는 양의 정수만 허용합니다.
const validReactionAmount=amount=>/^[1-9]\d*$/.test(amount)&&Number.isSafeInteger(Number(amount));
export class Store {
  constructor(path=':memory:') {
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,room TEXT NOT NULL,event_key TEXT NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,due INTEGER NOT NULL,attempts INTEGER NOT NULL,status TEXT NOT NULL,UNIQUE(room,event_key));
      CREATE INDEX IF NOT EXISTS outbox_due ON outbox(room,status,due);
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(room TEXT,id TEXT,result TEXT,PRIMARY KEY(room,id));
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,room TEXT,time INTEGER,user TEXT,type TEXT,data TEXT);
      CREATE TABLE IF NOT EXISTS tokens(room TEXT PRIMARY KEY,data TEXT);
      CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,room TEXT,time INTEGER,data TEXT);`);
  }
  ids(){return this.db.prepare('SELECT id FROM rooms').all().map(r=>r.id);}
  load(id){const row=this.db.prepare('SELECT data FROM rooms WHERE id=?').get(id);if(!row)return null;const room=JSON.parse(row.data);room.users=Object.assign(Object.create(null),room.users);normalizeExtras(room.settings);room.settings.pending=defaults().pending;room.settings.spoonNotice??=defaults().spoonNotice;if(room.settings.spoonNotice===LEGACY_CHARGE_NOTICE)room.settings.spoonNotice=DEFAULT_CHARGE_NOTICE;room.settings.introEnabled??=true;room.settings.introText??=defaults().introText;room.settings.roulette??=false;room.settings.rouletteRewards??=defaults().rouletteRewards;room.settings.likeGreetingEnabled??=true;room.settings.likeGreeting??=defaults().likeGreeting;return room;}
  create(id,name) {
    if(!this.load(id))this.save({id,name,settings:defaults(),month:dates().month,users:{},songs:[],current:null,previous:null,lastRequester:null,streak:0,lastResponse:0,live:false,noticeTimes:{},achievers:[],special:[]});
    return this.load(id);
  }
  save(room){this.db.prepare('INSERT INTO rooms VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(room.id,JSON.stringify(room));}
  log(room,user,type,data,now=Date.now()){this.db.prepare('INSERT INTO audit(room,time,user,type,data) VALUES(?,?,?,?,?)').run(room,now,user,type,JSON.stringify(data));}
  transaction(id,fn){this.db.exec('BEGIN IMMEDIATE');try{const room=this.load(id);if(!room)throw Error('방송을 찾을 수 없습니다.');const result=fn(room);this.save(room);this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  backup(id){const r=this.load(id);if(!r)throw Error('방송이 없습니다.');const key=randomUUID();this.db.prepare('INSERT INTO backups VALUES(?,?,?,?)').run(key,id,Date.now(),JSON.stringify(r.settings));return key;}
  prune({eventsKeep=200000,auditDays=90,backupsKeep=50}={},now=Date.now()){
    for(const value of [eventsKeep,auditDays,backupsKeep])if(!Number.isSafeInteger(value)||value<1)throw Error('보관 한도는 양의 안전한 정수여야 합니다.');
    this.db.prepare("UPDATE outbox SET status='expired' WHERE status='pending' AND created<?").run(now-600000);
    this.db.prepare("DELETE FROM outbox WHERE status NOT IN ('pending','sending') AND created<?").run(now-7*86400000);
    const cutoff=now-auditDays*86400000;
    this.db.prepare('DELETE FROM audit WHERE time<?').run(cutoff);
    this.db.prepare('DELETE FROM events WHERE rowid NOT IN (SELECT rowid FROM events ORDER BY rowid DESC LIMIT ?)').run(eventsKeep);
    for(const id of this.ids()){
      const room=this.load(id);if(room.chat?.messages.some(m=>m.time<now-7*86400000)){room.chat.messages=room.chat.messages.filter(m=>m.time>=now-7*86400000);this.save(room);}
    }
    for(const {room} of this.db.prepare('SELECT DISTINCT room FROM backups').all())
      this.db.prepare('DELETE FROM backups WHERE room=? AND id NOT IN (SELECT id FROM backups WHERE room=? ORDER BY time DESC LIMIT ?)').run(room,room,backupsKeep);
  }
  snapshot(dir,{keep=7,now=Date.now()}={}){
    if(!Number.isSafeInteger(keep)||keep<1)throw Error('백업 보관 수는 양의 안전한 정수여야 합니다.');
    mkdirSync(dir,{recursive:true});
    const stamp=new Date(now+9*3600000).toISOString().slice(0,10),file=join(dir,`studio-${stamp}.sqlite`);
    const pending=join(dir,`.snapshot-${randomUUID()}.tmp`);
    try{
      this.db.exec(`VACUUM INTO '${pending.replaceAll("'","''")}'`);
      renameSync(pending,file);
    }finally{rmSync(pending,{force:true});}
    const old=readdirSync(dir).filter(f=>/^studio-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().reverse().slice(keep);
    for(const f of old)rmSync(join(dir,f),{force:true});
    return file;
  }
  logs(id){return this.db.prepare('SELECT * FROM audit WHERE room=? ORDER BY seq DESC LIMIT 200').all(id).map(r=>({...r,data:JSON.parse(r.data)}));}
}
export class Engine {
  constructor(store,{now=()=>Date.now(),int=(a,b)=>randomInt(a,b+1),region='kr',identityKey=randomBytes(32).toString('hex')}={}){this.store=store;this.now=now;this.int=int;this.region=region;this.identityKey=identityKey;this.diningPrompts=new Map();this.conversation=new Conversation({int});this.aiNotes=new Map();this.bulk=new Map();}
  deleteSong(r,event,input,scope,now){
    if(event.isDj!==true)fail('신청곡 삭제는 DJ 전용입니다. 본인 신청곡은 !신청취소를 사용하세요.');
    let result;try{result=deleteSongCommand(r,event.user.id,input,scope,now);}catch(error){fail(error.message);}
    if(result.stopped)r.playbackControl={id:randomUUID(),action:'pause',time:now};
    this.store.log(r.id,event.user.id,'song-delete-command',{input,scope:scope||'context',result:result.text},now);r.lastResponse=now;return {text:result.text};
  }
  listenerSnapshot(room,listeners,now=this.now()){
    this.store.transaction(room,r=>{this.reset(r);const rewards=rewardListening(r,listeners,now,(id,name)=>freshUser(id,name,dates(now).month));for(const reward of rewards)this.store.log(room,reward.user,'listening-reward',reward,now);
      const notices=collectAffinityNotices(r,now),header='라디오메이트 자체 애청지수 상승',footer='※ 스푼 공식 애청온도와 별개';let lines=[],batch=0;
      const flush=()=>{if(lines.length)new Outbox(this.store).enqueue(room,'affinity-notice:'+now+':'+batch++,[header,...lines,footer].join('\n'),now);lines=[];};
      for(const notice of notices){const line=[...notice.name].slice(0,14).join('')+'님 +'+notice.gain+'° → '+notice.total+'°';if([header,...lines,line,footer].join('\n').length>200)flush();lines.push(line);this.store.log(room,notice.user,'affinity-notice',{gain:notice.gain,total:notice.total},now);}flush();r.listeningStatus='청취자 목록 확인 중 · 1분 간격으로 접속 시간을 추정합니다.';});
  }
  syncBuffs(r,now=this.now()){
    r.itemCheckedAt=now;
    for(const u of Object.values(r.users)){
      u.buffPaused??={};
      for(const item of r.settings.items){
        const paused=r.settings.pauseItems&&(r.id!=='demo'&&!r.demo&&!r.live||r.settings.quiet||!(item.id==='odd'?r.settings.odd:r.settings.fishing));
        const since=u.buffPaused[item.id];
        if(since!==undefined){const elapsed=Math.max(0,now-since);if(u.buffs[item.id]>since)u.buffs[item.id]=Math.min(Number.MAX_SAFE_INTEGER,u.buffs[item.id]+elapsed);}
        if(paused)u.buffPaused[item.id]=now;else delete u.buffPaused[item.id];
      }
    }
  }
  reset(r){
    this.syncBuffs(r);
    const {day,month}=dates(this.now());
    for(const u of Object.values(r.users)) {
      if(u.month!==month){u.pt=0;u.tickets=0;u.ticketRevision=(u.ticketRevision||0)+1;u.keeps=[];u.month=month;}
      if(u.daily.day!==day)u.daily={day,fishExp:0,fishPt:0,oddPt:0,totalPt:0};
    }
    if(r.month!==month){r.month=month;this.store.log(r.id,'system','monthly-reset',{month},this.now());}
  }
  credit(r,u,amount,source){
    let allowed=Math.min(amount,Math.max(0,LIMIT.total-u.daily.totalPt));
    if(source==='fish')allowed=Math.min(allowed,Math.max(0,LIMIT.fish-u.daily.fishPt));
    if(source==='odd')allowed=Math.min(allowed,Math.max(0,LIMIT.odd-u.daily.oddPt));
    if(!Number.isSafeInteger(u.pt+allowed))fail('포인트가 정확히 처리 가능한 정수 범위를 초과합니다.');
    u.pt+=allowed;u.daily.totalPt+=allowed;
    if(source==='fish')u.daily.fishPt+=allowed;
    if(source==='odd')u.daily.oddPt+=allowed;
    if(u.daily.totalPt===LIMIT.total&&!r.achievers.some(a=>a.day===u.daily.day&&a.user===u.id))r.achievers.push({day:u.daily.day,user:u.id,name:u.name,time:this.now()});
    this.store.log(r.id,u.id,'pt-reward',{source,requested:amount,paid:allowed},this.now());return allowed;
  }
  weighted(list){const total=list.reduce((s,f)=>s+f.weight,0);let pick=this.int(0,999999)/1000000*total;for(const f of list){pick-=f.weight;if(pick<0)return f;}return list.at(-1);}
  async handleAsync(roomId,event){
    const r=this.store.load(roomId),user=r?.users[event.user?.id],now=this.now();
    if(event.isDj===true&&/^!\s*재생\s*$/u.test(String(event.message||'').trim())&&this.searchSong){
      if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return {text:null,duplicate:true};
      const selected=r.songSelection,target=selected?.kind==='queue'?r.songs.find(song=>song.id===selected.id):selected?.kind==='previous'?r.previous:r.current||r.songs[0];
      if(target&&!songVideoId(target))try{
        const videoId=await this.searchSong(target.title);
        this.store.transaction(roomId,current=>{const song=[current.current,current.previous,...current.songs].find(song=>song?.id===target.id);if(song&&song.title===target.title&&!songVideoId(song)){song.videoId=videoId;rememberSongVideo(current,song,videoId);touchQueue(current);}});
      }catch{/* The request still works when search is unavailable; the player can retry. */}
    }
    const text=normalizeCommand(event.message),promptKey=JSON.stringify([roomId,event.user?.id]);
    // 정답만 입력해도 인정합니다: "간호사"처럼 그냥 입력하거나 "!간호사"처럼 느낌표만 붙여도 됩니다. 진행 중인 문제의 정답과 같은 말만 정답 처리하고(대기시간에 걸려 놓치지 않음),
    // 틀린 말이나 일반 대화에는 반응하지 않습니다. 느낌표를 붙인 말이 진짜 명령어·키워드 규칙·날씨/맛집 요청이면 그쪽이 우선입니다. DJ 본인도 진행 중인 문제의 정답과 똑같이 입력하면 인정합니다(봇 답변이 DJ 계정으로 되돌아와도 정답과 완전히 같은 말은 아니라 안전).
    if(r&&event.user?.id){
      const bang=text.startsWith('!'),word=bang?text.slice(1).trim().split(/\s+/u)[0]:'',listener=event.isDj!==true&&String(event.user.id)!==String(roomId);
      const answerLike=bang?!COMMAND_WORDS.has(word)&&!assistantRequest(text)&&!keywordMatches(r.settings,text):true;
      if(answerLike&&plainQuizAnswer(r,user,event.message,now)!==null)return this.handle(roomId,event,{plainQuiz:true,followup:true});
      // "!의사"처럼 느낌표를 붙인 틀린 한 낱말은, 본인이 !퀴즈로 받은 개인 문제가 진행 중일 때만 예전 "!정답 의사"와 같이 초성 힌트로 알려 줍니다(DJ 제외).
      // 모두 함께 푸는 자동 퀴즈 중이거나 일반 채팅의 틀린 말에는 답하지 않습니다(다른 봇용 명령어나 잡담에 끼어들지 않도록).
      if(answerLike&&bang&&listener&&word&&[...word].length<=20&&text.slice(1).trim()===word&&user?.quizRound&&activeQuizRound(r,user,now))return this.handle(roomId,{...event,message:'!정답 '+word});
    }
    const pending=this.diningPrompts.get(promptKey);
    for(const [key,value] of this.diningPrompts)if(value.expires<=now)this.diningPrompts.delete(key);
    let request=assistantRequest(text),followup=false,cancel=false,expired=false;
    // A region reply belongs only to the listener and room that opened the prompt.
    // DJ song deletion keeps priority over plain text while its own prompt is active.
    if(pending&&(!text.startsWith('!')||/^!\s*취소$/u.test(text))&&!(event.isDj&&r.songDeletePrompt?.actor===event.user?.id)){
      // 지역을 묻는 중에 "취소"뿐 아니라 "아니", "됐어요"처럼 말해도 그만둔 것으로 봅니다.
      request={kind:pending.kind,arg:[pending.arg,text].filter(Boolean).join(' ')};followup=true;cancel=/^!?(?:취소|아니(?:야|요)?|됐어(?:요)?|괜찮아(?:요)?|그만|패스)$/u.test(text);expired=pending.expires<=now;
    }
    if(request&&(['맛집','카페'].includes(request.kind)||travelKinds.has(request.kind))&&request.arg==='취소')cancel=true;
    if(request){
      if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return {text:null,duplicate:true};
      const bulk=this.bulkBlocked(roomId,event,now);
      const blocked=r.settings.quiet||(!followup&&!event.isDj&&(now-r.lastResponse<r.settings.responseGap*1000||user&&now-user.lastCommand<r.settings.cooldown*1000))||bulk;
      let needsRegion;try{needsRegion=travelKinds.has(request.kind)?!travelQuery(request.arg,now).region:['맛집','카페'].includes(request.kind)&&!diningQuery(request.arg,request.kind).region;}catch(error){return this.handle(roomId,event,{assistantRequest:request,assistantText:error.message,promptKey});}
      let assistantText='',assistantMore=[];
      if(!blocked){
        if(cancel)assistantText='검색 지역 입력을 취소했어요.';
        else if(expired)assistantText='지역 입력 시간이 지났어요. !맛집추천 또는 !카페추천으로 다시 시작해주세요.';
        else if(needsRegion)assistantText=travelKinds.has(request.kind)?travelPrompt(request.kind):diningPrompt(request.kind);
        else try{[assistantText,...assistantMore]=await this.assistantParts(request,this.chatContext(roomId,event,r.settings));if(assistantMore.length)this.markBulk(roomId,event,now,r.settings.cooldown);}
        catch{assistantText='검색·대화 서비스를 연결하지 못했어요. 잠시 후 같은 명령을 다시 입력해주세요.';}
      }
      return this.handle(roomId,event,{assistantText,assistantMore,assistantRequest:request,followup,promptKey,needsRegion,cancel,expired,bulk});
    }
    // 명령어(!)가 아닌 말: 방 설정이 허락하면 사람처럼 알아듣고 대답합니다(청취자의 날씨·맛집 질문, 인사, 부름, 이어 말하기).
    // 대화 판단 중 어떤 오류가 나도 스푼 연결 루프가 끊기지 않도록 여기서 막고, 평소처럼 일반 채팅으로 처리합니다.
    if(!text.startsWith('!')){
      let natural=null;
      try{natural=await this.naturalReply(roomId,event,r,text,now);}catch(error){this.noteAiProblem(roomId,'natural-chat: '+error.message,now);}
      if(natural)return this.handle(roomId,event,natural);
    }
    const automatic=/^!\s*복권\s+자동\s*$/.test(String(event.message||'').trim());
    if(automatic&&user?.tickets>LOTTERY_CHUNK&&user.month===dates(now).month&&(event.isDj||now-r.lastResponse>=r.settings.responseGap*1000&&now-user.lastCommand>=r.settings.cooldown*1000)){
      if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return {text:null,duplicate:true};
      const count=user.tickets,ticketRevision=user.ticketRevision||0;if(!Number.isSafeInteger(count)||count<1)return this.handle(roomId,event);
      const counts=await lotterySummaryAsync(count,(min,max)=>this.int(min,max));
      return this.handle(roomId,event,{count,counts,ticketRevision});
    }
    return this.handle(roomId,event);
  }
  plainQuizEvent(r,event,now){const answer=plainQuizAnswer(r,r.users[event.user?.id],event.message,now);return answer===null?null:{...event,message:'!정답 '+answer};}
  // ───── 명령어 없는 대화 ─────
  chatContext(roomId,event,settings,extra={}){return {store:this.store,room:roomId,user:event.user?.id,channel:'spoon',nickname:event.user?.nickname,botName:settings.chatName,persona:settings.chatPersona,int:this.int,...extra};}
  async assistantParts(request,context){
    if(!this.lifestyle)return ['대화 도우미가 준비 중입니다.'];
    const parts=this.lifestyle.answerParts?await this.lifestyle.answerParts(request,context):[await this.lifestyle.answer(request,context)];
    return parts.length?parts:[''];
  }
  // 한 사람이 여러 쪽짜리 답(예: 이번주 지역별 날씨)을 연달아 요청해 채팅을 도배하지 못하게 합니다. DJ는 제외합니다.
  bulkBlocked(roomId,event,now){return event.isDj!==true&&(this.bulk.get(roomId+'|'+event.user?.id)??0)>now;}
  markBulk(roomId,event,now,seconds){if(this.bulk.size>=2000)this.bulk.delete(this.bulk.keys().next().value);this.bulk.set(roomId+'|'+event.user?.id,now+Math.max(30,seconds||0)*1000);}
  // 봇은 DJ 계정으로 채팅을 보내므로 자기 답변이 다시 들어올 수 있습니다. 방금 보낸 문구와 같으면 무시해 대화가 꼬리를 물지 않게 합니다.
  isBotEcho(roomId,text,now){
    const key=squash(text);
    return this.store.db.prepare("SELECT text FROM outbox WHERE room=? AND status IN ('sent','sending','uncertain') AND created>? ORDER BY created DESC LIMIT 30").all(roomId,now-180000).some(row=>squash(row.text)===key);
  }
  // AI 호출이 막혀도 채팅방에는 오류 문구를 흘리지 않고(규칙 기반 대답으로 대체), 이유만 운영 기록에 10분에 한 번 남깁니다.
  noteAiProblem(roomId,message,now){
    if(now-(this.aiNotes.get(roomId)??0)<600000)return;
    if(this.aiNotes.size>=500)this.aiNotes.delete(this.aiNotes.keys().next().value);
    this.aiNotes.set(roomId,now);
    try{this.store.log(roomId,'system','ai-chat-unavailable',{message:String(message||'').slice(0,120)},now);}catch{/* 기록 실패가 대화를 막지 않게 */}
  }
  // 대답할 말이면 {natural,assistantText,...}를, 가만히 있어야 하면 null을 돌려줍니다. 외부 호출(AI·날씨)은 DB 트랜잭션 밖에서 합니다.
  async naturalReply(roomId,event,r,text,now){
    const s=r?.settings,user=event.user?.id;
    if(!this.lifestyle||!s||!user||!text||s.chatMode==='off'||typeof event.id!=='string')return null;
    // DJ 본인과 봇이 DJ 계정으로 보낸 답변(되돌아온 것)에는 끼어들지 않습니다. 이미 처리한 이벤트도 다시 AI를 부르지 않습니다.
    if(event.isDj===true||String(user)===String(roomId)||this.isBotEcho(roomId,text,now))return null;
    if(keywordMatches(s,text))return null; // DJ가 만든 키워드 응답이 우선
    if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return null;
    const plan=this.conversation.plan({roomId,event,settings:s,now,isRegion:token=>!!this.lifestyle.resolveRegion?.(token),lastResponse:r.lastResponse});
    if(!plan||plan.kind==='service'&&this.bulkBlocked(roomId,event,now))return null;
    const context=this.chatContext(roomId,event,s,{natural:true,mayskip:plan.mayskip,song:r.current?.title}),promptKey=JSON.stringify([roomId,user]);
    let parts,request={kind:'chat',arg:''},needsRegion=false;
    if(plan.kind==='service'){
      request=plan.request;needsRegion=['맛집','카페'].includes(request.kind)&&!diningQuery(request.arg,request.kind).region;
      if(needsRegion)parts=[`어느 지역 ${request.kind}${request.kind==='카페'?'를':'을'} 찾아볼까요? "광주 동명동"처럼 말해 주세요 ♡ (2분 안에 답해주세요)`];
      else try{parts=await this.assistantParts(request,context);}catch{parts=['지금은 알아오지 못했어요. 잠시 뒤에 다시 물어봐주세요 ♡'];}
      if(parts.length>1)this.markBulk(roomId,event,now,s.cooldown);
      if(this.lifestyle.ai?.configured)this.lifestyle.ai.remember?.(context,text,parts.join(' '));
    }else{
      const result=this.lifestyle.converse?await this.lifestyle.converse(plan.text,context):{text:null,reason:'unavailable'};
      if(result.reason==='skipped'){this.conversation.record(roomId,user,now,text,{open:false});return null;} // AI가 "내게 한 말이 아니다"라고 판단
      if(result.reason==='error')this.noteAiProblem(roomId,result.message,now);
      const reply=result.text||plan.fallback;if(!reply)return null;parts=[reply];
    }
    this.conversation.record(roomId,user,now,text);
    return {natural:true,trigger:plan.trigger,assistantRequest:request,assistantText:parts[0],assistantMore:parts.slice(1),promptKey,needsRegion};
  }
  naturalCommand(r,e,now,prepared){
    if(r.settings.quiet)return {text:null,suppressed:'quiet'};
    if(prepared.promptKey){
      this.diningPrompts.delete(prepared.promptKey);
      if(prepared.needsRegion){if(this.diningPrompts.size>=1000)this.diningPrompts.delete(this.diningPrompts.keys().next().value);this.diningPrompts.set(prepared.promptKey,{kind:prepared.assistantRequest.kind,arg:'',expires:now+120000});}
    }
    const [text,...more]=[prepared.assistantText,...(prepared.assistantMore||[])].map(part=>String(part||'').trim()).filter(Boolean);
    if(!text)return {text:null};
    r.lastResponse=now;
    this.store.log(r.id,e.user.id,'natural-chat',{trigger:prepared.trigger,kind:prepared.assistantRequest.kind},now);
    return {text:text.slice(0,200),...(more.length?{more:more.map(part=>part.slice(0,200))}:{})};
  }
  handle(roomId,event,preparedLottery=null){
    const now=this.now();
    return this.store.transaction(roomId,r=>{
      this.reset(r);
      if(!event.id||typeof event.id!=='string')throw Error('이벤트 ID가 필요합니다.');
      if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return {text:null,duplicate:true};
      if(Object.hasOwn(r.users,event.user?.id)){
        const actor=r.users[event.user.id];if(typeof event.user.nickname==='string'&&event.user.nickname.trim())actor.name=event.user.nickname;
        if(String(event.message||'').trim()&&creditChat(r,actor,now))this.store.log(r.id,actor.id,'affinity-chat',{points:5},now);
      }
      let result;const checkpoint=JSON.stringify(r);
      this.store.db.exec('SAVEPOINT command_effects');
      // 명령어 없이 입력한 정답은 트랜잭션 안에서 한 번 더 확인합니다(동시에 정답이 들어와 이미 끝난 문제라면 오류 문구 없이 조용히 넘어갑니다).
      const commandEvent=preparedLottery?.plainQuiz?this.plainQuizEvent(r,event,now):event;
      try{result=commandEvent?this.command(r,commandEvent,now,preparedLottery):{text:null,suppressed:'quiz-closed'};this.store.db.exec('RELEASE command_effects');}
      catch(e){
        if(!(e instanceof RuleError))throw e;
        const attempted=r.users[event.user?.id],commandTime=attempted?.lastCommand,commandName=attempted?.name;
        this.store.db.exec('ROLLBACK TO command_effects; RELEASE command_effects');
        for(const key of Object.keys(r))delete r[key];Object.assign(r,JSON.parse(checkpoint));
        r.users=Object.assign(Object.create(null),r.users);
        // Invalid attempts still obey the existing per-listener cooldown.
        const original=r.users[event.user?.id];if(original&&commandTime===now){original.lastCommand=now;original.name=commandName;}
        result={text:e.message};
      }
      this.syncBuffs(r,now);
      if(result.text&&!preparedLottery?.assistantRequest&&normalizeCommand(event.message).startsWith('!'))this.diningPrompts.delete(JSON.stringify([roomId,event.user?.id]));
      if(event.delivery&&result.text){const outbox=new Outbox(this.store);outbox.enqueue(roomId,event.id,result.text,now);result.more?.forEach((part,i)=>outbox.enqueue(roomId,event.id+':'+(i+2),part,now));}
      this.store.db.prepare('INSERT INTO events VALUES(?,?,?)').run(roomId,event.id,JSON.stringify(preparedLottery?.assistantRequest||assistantRequest(event.message)?{text:null,assistant:true}:result));
      // 여러 쪽 답변은 전송 큐가 쪽마다 따로 보내고, 테스트 화면처럼 큐를 안 쓰는 곳에는 한 덩어리로 돌려줍니다.
      if(result.more){const {more,...rest}=result;return {...rest,text:[result.text,...more].join('\n')};}
      return result;
    });
  }
  command(r,e,now,preparedLottery=null){
    const s=r.settings,text=normalizeCommand(e.message),request=preparedLottery?.assistantRequest||assistantRequest(text);
    if(preparedLottery?.natural)return this.naturalCommand(r,e,now,preparedLottery);
    if(!text.startsWith('!')&&!request){
      if(e.isDj&&r.songDeletePrompt?.actor===e.user?.id){
        if(r.songDeletePrompt.expires<=now){delete r.songDeletePrompt;return {text:'삭제 선택 시간이 지났습니다. !삭제로 새 목록을 열어주세요.'};}
        return this.deleteSong(r,e,text,undefined,now);
      }
      const out=keywordReply(r,e,now);if(out.text)this.store.log(r.id,e.user.id,'keyword-reply',{ruleId:out.ruleId},now);return out;
    }
    const bits=text.slice(1).trim().split(/\s+/);let cmd=bits.shift()||'';
    if(request)cmd=request.kind==='greeting'?'채팅':request.kind;
    if(cmd==='구매'){cmd='아이템';bits.unshift('구매');}
    if(cmd==='포기'){cmd='퀴즈';bits.unshift('포기');} // !포기 = !퀴즈 포기
    const arg=bits.join(' ');
    // 실제 스푼 채팅에서는 보낸 사람의 계정 ID를 방송 주인의 ID와 비교해 메뉴판을 편집할 DJ인지 확인합니다.
    const dj=e.isDj===true||(cmd==='메뉴판'&&e.delivery===true&&String(e.user?.id)===String(r.id));
    if(dj&&r.songDeletePrompt?.actor===e.user?.id&&!['삭제','이전곡','다음곡'].includes(cmd))delete r.songDeletePrompt;
    const answer=t=>{r.lastResponse=now;return {text:t};};
    if(cmd==='메뉴판'&&['추가','삭제'].includes(bits[0])){
      if(!dj)fail('메뉴판 편집은 DJ 전용입니다.');
      // 예를 들어 '추가 10 하트 리액션'을 받으면 할 일은 '추가', 금액은 '10', 문구는 '하트 리액션'입니다.
      const [action,amount,...words]=bits;
      const reaction=words.join(' ');
      if(!validReactionAmount(amount)||(action==='추가'?!reaction||reaction.length>100:words.length)){
        fail('사용법: !메뉴판 추가 10 하트 리액션 / !메뉴판 삭제 10 (문구 최대 100자)');
      }
      const reactions=s.donationReactions??={};
      const exists=Object.hasOwn(reactions,amount);
      // 없는 항목은 지울 수 없습니다. 이미 있는 금액의 문구를 바꾸면 항목 수는 늘지 않습니다.
      if(action==='삭제'&&!exists)return answer(`${amount}스푼에 등록된 리액션이 없습니다.`);
      if(action==='추가'&&!exists&&Object.keys(reactions).length>=50)fail('메뉴판에는 리액션을 최대 50개 등록할 수 있습니다.');
      // 잘못 바꿨을 때 돌아갈 수 있도록 편집하기 전에 현재 설정을 백업합니다.
      this.store.backup(r.id);
      if(action==='삭제')delete reactions[amount];
      else reactions[amount]=reaction;
      // 설정 버전을 올리면 이전 설정을 열어 둔 화면에서 방금 편집한 내용을 덮어쓰는 일을 막을 수 있습니다.
      r.settingsRevision=(r.settingsRevision||0)+1;
      // 나중에 확인할 수 있도록 누가 어떤 금액을 추가하거나 삭제했는지 기록합니다.
      this.store.log(r.id,e.user.id,'donation-menu-settings',{action,amount:Number(amount)},now);
      return answer(`${amount}스푼 리액션을 ${action==='삭제'?'삭제':exists?'수정':'등록'}했습니다.`);
    }
    if(cmd==='자동운영'){
      if(!dj)fail('자동 운영 설정은 DJ 전용입니다.');
      if(arg==='상태')return answer('자동 운영 '+(r.automation?.enabled?'ON':'OFF')+' · 퀴즈 '+(s.autoQuizEnabled?s.autoQuizMinutes+'분':'OFF')+' · 청취 복권 '+(s.listenRewards?s.listenMinutes+'분마다 '+s.listenTickets+'장':'OFF'));
      if(!['on','off'].includes(arg))fail('사용법: !자동운영 on / off / 상태');this.store.backup(r.id);setAutomation(r,arg==='on',now);return answer(arg==='on'?'자동 운영 ON · 퀴즈 10분 · 청취 복권 5분마다 1장 · 출석·인사·신청곡 접수':'자동 운영 OFF · 프로필 적용 전 설정을 복원했습니다.');
    }
    if(cmd==='자동퀴즈'){
      if(!dj)fail('자동 퀴즈 설정은 DJ 전용 명령어입니다.');
      if(arg==='상태')return answer('자동 퀴즈 '+(s.autoQuizEnabled?'ON':'OFF')+' · '+s.autoQuizMinutes+'분 간격 · '+(r.autoQuizRound?'문제 진행 중':'다음 출제 대기'));
      if(!/^(on(?: \d+)?|off)$/.test(arg))fail('사용법: !자동퀴즈 on [간격 분] / !자동퀴즈 off / !자동퀴즈 상태');
      const minutes=bits[1]===undefined?s.autoQuizMinutes:Number(bits[1]);
      if(!Number.isInteger(minutes)||minutes<1||minutes>1440)fail('자동 퀴즈 간격은 1~1440분입니다.');
      if(bits[0]==='on'&&!s.quizQuestions.length)fail('게임 설정에서 퀴즈 문제를 먼저 등록하세요.');
      s.autoQuizEnabled=bits[0]==='on';s.autoQuizMinutes=minutes;
      delete r.autoQuizPending;
      if(s.autoQuizEnabled){s.quiz=true;if(!r.autoQuizRound)r.autoQuizDueAt=now;}else{delete r.autoQuizRound;delete r.autoQuizDueAt;}
      r.settingsRevision=(r.settingsRevision||0)+1;
      this.store.log(r.id,e.user.id,'auto-quiz-settings',{enabled:s.autoQuizEnabled,minutes},now);
      return answer(s.autoQuizEnabled?'자동 퀴즈 ON · '+minutes+'분 간격 · 방송 중 다음 출제부터 자동으로 진행합니다.':'자동 퀴즈 OFF · 진행 중인 자동 문제도 종료했습니다.');
    }
    const ticketReset=cmd==='복권초기화'||cmd==='복권'&&bits[0]==='초기화';
    if(ticketReset){
      if(!dj)fail('복권 초기화는 DJ 전용 명령어입니다.');
      const targets=cmd==='복권초기화'?bits:bits.slice(1);
      if(!targets.length||targets.slice(1).some(target=>target.startsWith('@')))fail('사용법: !복권 초기화 닉네임 또는 !복권초기화 @고유ID (한 명만 지정)');
      const uid=this.target(r,targets.join(' ')),user=r.users[uid],previous=user.tickets;
      user.tickets=0;user.ticketRevision=(user.ticketRevision||0)+1;
      this.store.log(r.id,uid,'ticket-reset',{previous,balance:0,actor:e.user.id},now);
      return answer(`${user.name}님 복권 초기화 · ${n(previous)}장 → 0장 (EXP·PT 유지)`);
    }
    if(dj){
      if(cmd==='조용'){if(!['on','off'].includes(arg))fail('사용법: !조용 on/off');s.quiet=arg==='on';r.settingsRevision=(r.settingsRevision||0)+1;return answer(`조용 모드 ${arg.toUpperCase()}`);}
      if(cmd==='복권지급'){
        let parsed;try{parsed=parseTicketGrant(arg);}catch(error){fail(error.message);}
        const {target,countText}=parsed;
        if(!/^[+-]?\d+$/.test(countText))fail('복권 수량은 정수로 입력해주세요.');
        const count=Number(countText);if(!Number.isSafeInteger(count))fail('복권 수량이 정확히 처리 가능한 정수 범위를 초과합니다.');
        const uid=this.target(r,target),user=r.users[uid],next=user.tickets+count;
        if(next<0)fail(`보유 복권 ${n(user.tickets)}장보다 많이 회수할 수 없습니다.`);
        if(!Number.isSafeInteger(next))fail('복권 보유량이 처리 가능한 범위를 초과합니다.');
        user.tickets=next;if(count!==0)user.ticketRevision=(user.ticketRevision||0)+1;this.store.log(r.id,uid,'ticket-grant',{count,actor:e.user.id,balance:next},now);
        return answer(count===0?`${user.name}님 복권 수량 변경 없음 · 보유 ${n(next)}장`:`${user.name}님 복권 ${n(Math.abs(count))}장 ${count<0?'회수':'지급'} · 보유 ${n(next)}장`);
      }
    }
    if(['조용','복권지급'].includes(cmd))fail('DJ 전용 명령어입니다.');

    const gameToggle=['게임','낚시','홀짝'].includes(cmd)&&['on','off'].includes(arg),gameStatus=cmd==='게임'&&arg==='상태';
    if(gameToggle&&arg==='off'&&!dj)fail('게임을 끄는 OFF 명령은 DJ 전용입니다.');
    if(gameToggle||gameStatus){
      if(!e.user?.id)fail('청취자 식별 정보가 없습니다.');
      const actor=r.users[e.user.id];
      const wait=Math.max(0,r.lastResponse+s.responseGap*1000-now,actor?actor.lastCommand+s.cooldown*1000-now:0);
      if(!dj&&wait>0)return {text:null,suppressed:'cooldown',retryAfterMs:wait};
      if(actor){actor.name=e.user.nickname||actor.name;actor.lastCommand=now;}
      if(gameStatus)return answer(`낚시 ${s.fishing?'ON':'OFF'} / 홀짝 ${s.odd?'ON':'OFF'} / 가위바위보 ${s.rps?'ON':'OFF'} / 주사위 ${s.dice?'ON':'OFF'} / 숫자맞히기 ${s.numberGuess?'ON':'OFF'} / 퀴즈 ${s.quiz?'ON':'OFF'} / 조용 모드 ${s.quiet?'ON':'OFF'}`);
      if(cmd==='게임'||cmd==='낚시')s.fishing=arg==='on';if(cmd==='게임'||cmd==='홀짝')s.odd=arg==='on';
      if(cmd==='게임')for(const key of ['rps','dice','numberGuess','quiz'])s[key]=arg==='on'&&(key!=='quiz'||s.quizQuestions.length>0);
      r.settingsRevision=(r.settingsRevision||0)+1;
      this.store.log(r.id,e.user.id,'game-control',{command:cmd,enabled:arg==='on'},now);
      return answer(`${cmd} ${arg.toUpperCase()}${cmd==='게임'&&arg==='on'&&!s.quiz?' · 퀴즈는 문제를 등록한 후 켜 주세요.':''}${s.quiet?' · 조용 모드 중에는 게임 응답이 중지됩니다.':''}`);
    }

    if(s.quiet&&['낚시','홀','짝','홀짝','복권','룰렛','가위바위보','주사위','숫자맞히기','퀴즈','정답'].includes(cmd))return {text:null,suppressed:'quiet'};
    if(cmd==='낚시'&&!s.fishing||['홀','짝','홀짝'].includes(cmd)&&!s.odd)return {text:null,suppressed:'disabled'};
    if(!dj&&!preparedLottery?.followup&&now-r.lastResponse<s.responseGap*1000)return {text:null,suppressed:'cooldown',retryAfterMs:r.lastResponse+s.responseGap*1000-now};
    const known=KNOWN_COMMANDS;
    if(!known.includes(cmd)&&!request){const out=keywordReply(r,e,now);if(out.text)this.store.log(r.id,e.user.id,'keyword-reply',{ruleId:out.ruleId},now);return out;}
    if(!e.user?.id)fail('청취자 식별 정보가 없습니다.');
    let u=r.users[e.user.id];
    const interactionKey=cmd==='킵'?'lastKeepCommand':['아이템','가방','버프'].includes(cmd)?'lastItemCommand':null;
    if(u&&!dj&&!preparedLottery?.followup&&!interactionKey&&now-u.lastCommand<s.cooldown*1000)return {text:null,suppressed:'cooldown',retryAfterMs:Math.max(u.lastCommand+s.cooldown*1000-now,r.lastResponse+s.responseGap*1000-now)};
    if(u&&!dj&&interactionKey&&now-(u[interactionKey]||0)<1000)return {text:null,suppressed:'cooldown',retryAfterMs:1000-(now-u[interactionKey])};
    if(cmd==='내정보'&&arg==='생성'){
      if(!u){u=freshUser(e.user.id,e.user.nickname||'청취자',dates(now).month);r.users[u.id]=u;this.reset(r);}
      u.lastCommand=now;return answer(`${u.name}님 프로필이 준비되었습니다. !출석으로 복권을 받으세요.`);
    }
    if(u){u.name=e.user.nickname||u.name;if(interactionKey)u[interactionKey]=now;else u.lastCommand=now;}
    if(request){
      if(s.quiet)return {text:null,suppressed:'quiet'};
      if(preparedLottery?.bulk)return {text:null,suppressed:'bulk'}; // 여러 쪽 답을 연달아 요청하는 도배는 조용히 넘김
      if(preparedLottery?.promptKey){
        this.diningPrompts.delete(preparedLottery.promptKey);
        if(preparedLottery.needsRegion&&!preparedLottery.cancel&&!preparedLottery.expired){
          if(this.diningPrompts.size>=1000)this.diningPrompts.delete(this.diningPrompts.keys().next().value);
          this.diningPrompts.set(preparedLottery.promptKey,{kind:request.kind,arg:request.arg,expires:now+120000});
        }
      }
      const reply=answer(String(preparedLottery?.assistantText||'대화 도우미를 다시 요청해주세요.').slice(0,200));
      if(preparedLottery?.assistantMore?.length)reply.more=preparedLottery.assistantMore.map(part=>String(part).slice(0,200));
      return reply;
    }
    if(cmd==='도움말')return answer(`시작 !내정보 (자동 생성) · !출석 | 신청곡 !신청곡 · !이전곡 · !현재곡 · !다음곡 · DJ !재생 !멈춤 !삭제 | 정보 !랭킹 · !킵 · !스푼 · !보이스카드 | 게임 !복권${s.fishing?' · !낚시':''}${s.odd?' · !홀/!짝':''}${s.roulette?' · !룰렛':''}${s.rps?' · !가위바위보':''}${s.dice?' · !주사위':''}${s.numberGuess?' · !숫자맞히기':''}${s.quiz?' · !퀴즈 → 정답만 입력 · !포기':''}`);
    if(cmd==='채팅방')return answer(r.chat?.enabled&&r.chat.token?`우리 방송 대화방 ♡ ${this.publicUrl}/chat/${r.chat.token} (스푼과 별도 채팅방)`:'DJ가 아직 앱 채팅방을 열지 않았습니다.');
    if(cmd==='보이스카드')return answer(r.voiceInboxUrl?`음성 보내기(링크를 눌러 녹음): ${r.voiceInboxUrl}\n휴대폰·PC에서 녹음·전송할 수 있습니다. 스푼 앱 내부 자동 녹음은 지원되지 않습니다.`:'DJ가 아직 음성메시지 접수를 열지 않았습니다.');
    if(cmd==='스푼')return answer(spoonChargeReply(s.spoonNotice,this.region));
    if(cmd==='공지')return answer(s.notice);
    if(cmd==='메뉴판'){
      // 2스푼이 10스푼보다 앞에 오도록 글자 순서가 아닌 금액 순서로 정렬합니다.
      const entries=Object.entries(s.donationReactions??{}).sort(([a],[b])=>Number(a)-Number(b));
      // 목록이 길면 여러 페이지로 나눕니다. '!메뉴판 2'를 입력하면 두 번째 페이지를 보여줍니다.
      return answer(chatPage('후원 메뉴판',entries.map(([amount,reaction])=>`${n(Number(amount))}스푼 · ${reaction}`),arg,cmd,'등록된 후원 리액션이 없습니다.'));
    }
    if(cmd==='랭크')return answer(s.monthlyRank&&s.monthlyRankMonth===dates(now).month?`이번 달 넥스트초이스: ${s.monthlyRank} (DJ 수동 등록)`:'이번 달 순위 미등록 — 넥스트초이스 → 이번 달에서 확인해주세요.');
    if(['랭킹','랭킹조회','애청랭킹'].includes(cmd))return answer(chatPage('애청지수 순위',affinityRank(r.users).map((v,i)=>`${i+1}. ${[...v.name].slice(0,25).join('')} ${n(affinityScore(v))}점`),arg,'랭킹','등록된 청취자가 없습니다.'));
    if(cmd==='경험치랭킹')return answer(chatPage('경험치 순위',Object.values(r.users).sort((a,b)=>b.exp-a.exp||a.id.localeCompare(b.id)).map((v,i)=>`${i+1}. ${[...v.name].slice(0,25).join('')} ${n(v.exp)} EXP`),arg,cmd,'등록된 청취자가 없습니다.'));
    if(['라디오메이트','봇호출'].includes(cmd))return answer('라디오메이트 명령 수신 중입니다. 다른 DJ 방송 연결은 라디오메이트 공용 HTTPS 화면에서 해당 DJ 계정으로 스푼 연결에 동의해 주세요. 방송이 시작되면 봇이 자동 접속합니다.');
    if(cmd==='이전곡'){
      if(arg==='삭제'||arg.startsWith('삭제 '))return this.deleteSong(r,e,arg.slice(2).trim(),'previous',now);
      if(dj){delete r.songDeletePrompt;if(r.previous)r.songSelection={kind:'previous',id:r.previous.id,title:r.previous.title};else delete r.songSelection;}
      return answer(r.previous?`이전곡: ${r.previous.title}${dj?' · 선택됨. !재생으로 재생하세요.':''}`:'이전에 재생한 곡이 없습니다.');
    }
    if(cmd==='현재곡')return answer(r.current?`현재곡: ${r.current.title}`:'현재곡이 없습니다.');
    if(cmd==='다음곡'){
      if(arg==='삭제'||arg.startsWith('삭제 '))return this.deleteSong(r,e,arg.slice(2).trim(),'queue',now);
      if(dj){delete r.songDeletePrompt;if(r.songs[0])r.songSelection={kind:'queue',id:r.songs[0].id,title:r.songs[0].title};else delete r.songSelection;}
      return answer(r.songs[0]?`다음곡: ${r.songs[0].title}${dj?' · 선택됨. !재생으로 재생하세요.':''}`:'다음 신청곡이 없습니다.');
    }
    if(cmd==='신청곡목록'||cmd==='신청곡'&&!arg)return answer(chatPage('신청곡',r.songs.map((v,i)=>`${i+1}. ${[...v.title].slice(0,70).join('')} (${[...v.name].slice(0,20).join('')})`),arg,'신청곡목록','대기 중인 신청곡이 없습니다. !신청곡 가수 - 제목으로 신청하세요.'));
    if(cmd==='재생'||cmd==='멈춤'){
      if(!dj)fail('재생·멈춤은 DJ 전용 명령입니다.');
      if(arg)fail('사용법: !재생 또는 !멈춤');
      if(cmd==='재생'&&(r.current||r.songs.length||r.songSelection))applySongAction(r,{action:'start'},now);
      r.playbackControl={id:randomUUID(),action:cmd==='재생'?'play':'pause',time:now};
      r.playbackState=cmd==='재생'?'requested':'paused';
      this.store.log(r.id,e.user.id,'playback-control',{action:r.playbackControl.action},now);
      return answer(cmd==='멈춤'?'멈춤 요청을 보냈습니다. 연결된 휴대폰·PC 플레이어를 일시정지합니다.':`재생 요청: ${(r.current?.title||'새 신청곡 대기').slice(0,45)}${songVideoId(r.current)?'\nhttps://youtu.be/'+songVideoId(r.current):''}\n${this.publicUrl?'플레이어: '+this.publicUrl+'/player':'휴대폰·PC 플레이어에서 재생합니다.'}`);
    }
    if(cmd==='삭제'){
      return this.deleteSong(r,e,arg,undefined,now);
    }
    if(cmd==='아이템'&&bits[0]==='상점'&&!s.items.some(i=>i.enabled))return answer('판매 중인 아이템이 없습니다.');
    if(cmd==='아이템'&&bits[0]==='상점')return answer(chatPage('아이템 상점',[
      '구매: !구매 ID/번호/이름 · 사용: !아이템 사용 ID (20분)',
      ...s.items.flatMap((i,index)=>i.enabled?[`${index+1}. ${i.name.slice(0,28)} (${i.id}) ${n(i.price)} PT${i.stock===0?' · 품절':''}`]:[])
    ],bits.slice(1).join(' '),'아이템 상점','판매 중인 아이템이 없습니다.'));
    if(!u&&(cmd==='내정보'||cmd==='애청지수'||cmd==='킵'||cmd==='아이템'&&bits[0]==='구매'||cmd==='정답'&&r.autoQuizRound||dj)){
      u=freshUser(e.user.id,e.user.nickname||'청취자',dates(now).month);r.users[u.id]=u;this.reset(r);if(interactionKey)u[interactionKey]=now;else u.lastCommand=now;
    }
    if(!u)fail('먼저 !내정보 를 입력하면 프로필이 자동으로 만들어집니다.');
    const quiz=playQuiz(this,r,u,cmd,arg,now,fail);if(quiz!==null)return answer(quiz);
    const mini=playMiniGame(this,r,u,cmd,arg,now,fail);if(mini!==null)return answer(mini);
    const active=id=>u.buffPaused?.[id]===undefined&&(u.buffs[id]||0)>now;
    if(cmd==='애청지수')return answer(u.name+'님 라디오메이트 애청지수 '+affinityScore(u)+'°\n최근 집계 상승분 +'+(u.affinityLastNotifiedGain||0)+'°\n청취 '+Math.floor((u.listeningMs||0)/60000)+'분 · 채팅 기여 '+(u.chatAffinityPoints||0)+'점\n자체 지수(1점=1°)이며 스푼 공식 애청온도와 별개입니다.');
    if(cmd==='내정보')return answer(`${u.name} · Lv.${Math.floor(u.exp/s.levelStep)+1}\n${n(u.exp)} EXP / ${n(u.pt)} PT / 복권 ${n(u.tickets)}장\n애청지수 ${affinityScore(u)}점 · 청취 ${Math.floor((u.listeningMs||0)/60000)}분 · 채팅 ${u.chatAffinityPoints||0}점\n다음 레벨까지 ${n(s.levelStep-u.exp%s.levelStep)} EXP`);
    if(cmd==='출석'){
      if(!s.attendance)fail('출석 기능이 꺼져 있습니다.');if(u.attendance===dates(now).day)fail('오늘은 이미 출석했습니다.');
      if(!Number.isSafeInteger(u.tickets+20))fail('복권 보유량이 정확히 처리 가능한 정수 범위를 초과합니다.');
      u.attendance=dates(now).day;u.tickets+=20;u.ticketRevision=(u.ticketRevision||0)+1;this.store.log(r.id,u.id,'attendance',{tickets:20},now);return answer(`${u.name}님 출석! 복권 20장 지급`);
    }
    if(cmd==='복권'){
      const auto=bits.length===1&&bits[0]==='자동';
      if(!auto&&(bits.length!==3||bits.some(x=>!/^\d$/.test(x)||x==='0')||new Set(bits).size!==3))fail('사용법: !복권 자동 또는 !복권 3 6 9 (1~9 중 중복 없는 숫자 3개)');
      if(u.tickets<1)fail('복권이 부족합니다.');
      if(auto&&u.tickets>1){
        const used=u.tickets;if(!Number.isSafeInteger(used))fail('복권 보유 수량을 확인해주세요.');
        if(preparedLottery&&(preparedLottery.count!==used||preparedLottery.ticketRevision!==(u.ticketRevision||0)))fail('추첨 준비 중 복권 수량이 변경되었습니다. 수량은 차감하지 않았으니 다시 입력해주세요.');
        if(used>LOTTERY_CHUNK&&!preparedLottery)fail('대량 복권은 비동기 처리로 실행해주세요.');
        const counts=preparedLottery?.counts||lotterySummary(used,(min,max)=>this.int(min,max)),exp=lotteryExp(counts);
        if(!Number.isSafeInteger(u.exp+exp))fail('경험치가 정확히 처리 가능한 정수 범위를 초과합니다. 복권은 차감하지 않았습니다.');
        u.tickets=0;u.ticketRevision=(u.ticketRevision||0)+1;u.exp+=exp;this.store.log(r.id,u.id,'lottery',{auto:true,used,counts,exp,remaining:0},now);
        return answer(`자동 복권 ${n(used)}장 사용 · 3개 일치 ${n(counts[3])}회 / 2개 ${n(counts[2])}회 / 1개 ${n(counts[1])}회 / 꽝 ${n(counts[0])}회 · +${n(exp)} EXP · 남은 복권 0장`);
      }
      if(auto&&preparedLottery&&(preparedLottery.count!==u.tickets||preparedLottery.ticketRevision!==(u.ticketRevision||0)))fail('추첨 준비 중 복권 수량이 변경되었습니다. 다시 입력해주세요.');
      const pick=()=>{const pool=[1,2,3,4,5,6,7,8,9],numbers=[];for(let i=0;i<3;i++)numbers.push(pool.splice(this.int(0,pool.length-1),1)[0]);return numbers;};
      const selected=auto?pick():bits.map(Number),draw=pick();
      const matches=selected.filter(x=>draw.includes(x)).length,exp=[0,50,150,300][matches];
      if(!Number.isSafeInteger(u.exp+exp))fail('경험치가 정확히 처리 가능한 정수 범위를 초과합니다. 복권은 차감하지 않았습니다.');
      u.tickets--;u.ticketRevision=(u.ticketRevision||0)+1;u.exp+=exp;
      this.store.log(r.id,u.id,'lottery',{draw,input:selected.map(String),auto,matches,exp,used:1,remaining:u.tickets},now);
      return answer(`${auto?`자동 선택 ${selected.join(' ')} · `:''}당첨 숫자 ${draw.join(' ')} · ${matches}개 일치! +${exp} EXP${auto?` · 1장 사용 · 남은 복권 ${n(u.tickets)}장`:''}`);
    }
    if(cmd==='낚시'){
      if(arg)fail('사용법: !낚시');
      const exp=Math.min(LIMIT.exp-u.daily.fishExp,s.expPerCast*(active('exp')?2:1));
      if(!Number.isSafeInteger(u.exp+exp))fail('경험치가 정확히 처리 가능한 정수 범위를 초과합니다.');
      u.exp+=exp;u.daily.fishExp+=exp;
      if(this.int(1,10000)<=s.miss*100){this.store.log(r.id,u.id,'fishing-miss',{exp},now);return answer(`이번엔 꽝! +${exp} EXP`);}
      let list=s.fish;
      if(active('rare')){const rare=this.int(1,100)<=70;list=list.filter(f=>(f.rarity>=2)===rare);}
      const f=this.weighted(list),size=this.int(f.minSize,f.maxSize),base=s.payout==='fixed'?f.minPt:this.int(f.minPt,f.maxPt);
      const key=`${f.id}:${f.rarity}`;u.book[key]??={name:f.name,rarity:f.rarity,count:0};u.book[key].count++;
      let die=0,wanted=base,source='fish',paid=0,held=false;
      if(f.golden){die=this.int(1,6);wanted=base*die;if(s.goldenPolicy==='pending')held=true;else if(s.goldenPolicy==='special')source='golden';}
      if(held)r.special.push({id:randomUUID(),user:u.id,name:u.name,fish:f.name,day:dates(now).day,time:now,base,die,amount:wanted,status:'policy-pending'});
      else if(u.daily.fishPt>=LIMIT.fish&&f.rarity===4&&!f.golden)r.special.push({id:randomUUID(),user:u.id,name:u.name,fish:f.name,day:dates(now).day,time:now,amount:0,status:'pending'});
      else paid=this.credit(r,u,wanted,source);
      this.store.log(r.id,u.id,'fishing',{fish:f.name,rarity:f.rarity,size,exp,base,die,paid,held},now);
      return answer(`🎣 ${f.name} (${RARITIES[f.rarity]}) ${size}cm\n+${exp} EXP · ${held?`🎲 ${base} × ${die} = ${wanted} PT (정책 미정·보류)`:`${die?`🎲 ${n(base)} × ${die} · `:''}+${n(paid)} PT`}`);
    }
    if(['홀','짝','홀짝'].includes(cmd)){
      let side=cmd,stakeText=arg;if(cmd==='홀짝'){[side,stakeText]=bits;}
      if(!['홀','짝'].includes(side))fail('사용법: !홀 20000 또는 !짝 20000');
      const stake=positive(stakeText,s.betMax);if(stake<s.betMin)fail(`최소 ${n(s.betMin)} PT부터 가능합니다.`);
      if(u.pt<stake)fail('보유 PT가 부족합니다.');
      if(stake>Math.min(LIMIT.odd-u.daily.oddPt,LIMIT.total-u.daily.totalPt))fail('남은 일일 당첨 이익 한도보다 큰 금액은 걸 수 없습니다.');
      u.pt-=stake;const rolled=this.int(1,100)<= (active('odd')?65:50)?'홀':'짝',win=rolled===side;
      if(win){u.pt+=stake;this.credit(r,u,stake,'odd');}
      this.store.log(r.id,u.id,'odd-even',{stake,side,rolled,win},now);return answer(`${rolled}! ${win?`성공 · 원금 포함 ${n(stake*2)} PT 반환`:`실패 · ${n(stake)} PT 차감`} / 잔액 ${n(u.pt)} PT`);
    }
    if(cmd==='낚시정보')return answer(`오늘 낚시 ${n(u.daily.fishExp)}/200,000 EXP · ${n(u.daily.fishPt)}/200,000 PT\n전체 획득 ${n(u.daily.totalPt)}/1,000,000 PT`);
    if(cmd==='도감')return answer(chatPage('도감',Object.values(u.book).map(b=>`${b.name} ×${b.count}`),arg,cmd,'아직 잡은 물고기가 없습니다.'));
    if(cmd==='룰렛'){
      if(arg)fail('사용법: !룰렛');
      if(!s.roulette)fail('룰렛이 꺼져 있습니다. DJ가 보상과 확률을 설정한 뒤 켜 주세요.');
      const reward=this.weighted(s.rouletteRewards);const name=reward.name.trim().normalize('NFC');
      if(reward.miss){u.keepHistory??=[];u.keepHistory.push({id:randomUUID(),text:name,kind:'miss',time:now,actor:u.id});}
      else u.keeps.push(name);
      this.store.log(r.id,u.id,'roulette',{name,miss:reward.miss},now);
      return answer(reward.miss?`${u.name}님 룰렛 결과: ${name} · 보유 킵에는 추가되지 않으며 사용내역에 기록했습니다.`:`${u.name}님 룰렛 당첨: ${name} · 킵에 자동 등록했습니다.`);
    }
    if(cmd==='킵'){
      if(bits[0]==='취소'){
        const selector=keepName(bits.slice(1).join(' '));
        const completed=[...(u.keepHistory||[])].filter(k=>k.kind==='used').reverse();
        const entry=!selector?completed.find(k=>dj||k.actor===u.id):/^[1-9]\d*$/.test(selector)?completed[Number(selector)-1]:completed.find(k=>keepName(k.text)===selector);
        if(!entry)fail('취소할 사용 완료 내역이 없습니다. !킵 완료로 확인하세요.');
        if(!dj&&entry.actor!==u.id)fail('DJ가 처리한 킵은 DJ에게 취소를 요청하세요.');
        if(dates(entry.time).month!==dates(now).month)fail('지난달 사용 내역은 월간 초기화 후 복원할 수 없습니다.');
        entry.kind='cancelled';entry.cancelledAt=now;entry.cancelledBy=u.id;
        u.keeps.push(keepName(entry.text));
        this.store.log(r.id,u.id,'keep-update',{action:'cancel-use',id:entry.id,text:entry.text,actor:u.id,source:'chat'},now);
        return answer(`${u.name}님 킵 사용 취소: ${entry.text}\n보유 킵 목록으로 1개를 돌려놓았습니다. !킵으로 확인하세요.`);
      }
      if(bits[0]==='사용'){
        const selector=keepName(bits.slice(1).join(' '));
        if(!selector)fail('사용법: !킵 사용 번호 또는 !킵 사용 보상명 · !킵으로 내 목록을 확인하세요.');
        const grouped=groupKeeps(u.keeps);
        const selected=/^[1-9]\d*$/.test(selector)?grouped[Number(selector)-1]:grouped.find(k=>k.name===selector);
        if(!selected)fail('내 보유 킵에서 해당 보상을 찾을 수 없습니다. !킵으로 현재 번호를 확인하세요.');
        const index=u.keeps.findIndex(k=>keepName(k)===selected.name);
        u.keeps.splice(index,1);u.keepHistory??=[];
        u.keepHistory.push({id:randomUUID(),text:selected.name,kind:'used',time:now,actor:u.id});
        this.store.log(r.id,u.id,'keep-update',{action:'use',text:selected.name,actor:u.id,source:'chat'},now);
        return answer(`${u.name}님 킵 사용 완료: ${selected.name} · 남은 수량 ${selected.count-1}개\n완료 내역으로 옮겼습니다. !킵 완료 · 되돌리기: !킵 취소`);
      }
      if(bits[0]==='완료')return answer(chatPage('킵 사용 완료', [...(u.keepHistory||[])].filter(k=>k.kind==='used').reverse().map((k,i)=>`${i+1}. ${k.text} · ${new Date(k.time).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}`),bits.slice(1).join(' '),'킵 완료','사용 완료한 킵이 없습니다.'));
      const expiry='유효: '+keepExpiryLabel(now);
      return answer(chatPage('보유 킵',u.keeps.length?[expiry,...groupKeeps(u.keeps).map((k,i)=>`${i+1}. ${k.name} ×${k.count}`)]:[],arg,cmd,`${expiry}\n보관 중인 킵이 없습니다.`));
    }
    if(cmd==='가방')return answer(s.items.map(i=>`${i.id}: ${i.name} ×${u.bag[i.id]||0}`).join('\n'));
    if(cmd==='버프')return answer(s.items.filter(i=>(u.buffs[i.id]||0)>now).map(i=>`${i.name}: ${Math.ceil((u.buffs[i.id]-now)/60000)}분 남음${u.buffPaused?.[i.id]!==undefined?' (일시정지)':''}`).join('\n')||'적용 중인 효과가 없습니다.');
    if(cmd==='아이템'){
      const action=bits[0],selector=keepName(bits.slice(1).join(' '));
      const matches=s.items.filter((i,index)=>i.id.toLowerCase()===selector.toLowerCase()||String(index+1)===selector||keepName(i.name)===selector);
      if(matches.length!==1)fail('아이템을 하나만 정확히 지정하세요. 예: !구매 rare / !아이템 구매 1 / !아이템 사용 exp');
      const item=matches[0];
      if(action==='구매'){
        if(!item.enabled)fail('판매 중지 상품입니다.');if(item.stock===0)fail('품절 상품입니다.');if(u.pt<item.price)fail(`포인트가 부족합니다. 필요 ${n(item.price)} PT / 보유 ${n(u.pt)} PT`);
        if(!Number.isSafeInteger((u.bag[item.id]||0)+1))fail('아이템 보유량을 더 늘릴 수 없습니다.');
        u.pt-=item.price;if(item.stock!==null&&item.stock!==undefined){item.stock--;r.settingsRevision=(r.settingsRevision||0)+1;}u.bag[item.id]=(u.bag[item.id]||0)+1;this.store.log(r.id,u.id,'purchase',{item:item.id,price:item.price},now);return answer(`${item.name} 구매 완료 · ${n(item.price)} PT 차감\n잔액 ${n(u.pt)} PT · 가방 ${u.bag[item.id]}개\n사용: !아이템 사용 ${item.id}`);
      }
      if(action==='사용'){
        if(!(u.bag[item.id]>0))fail('보유 아이템이 없습니다.');if(item.id==='odd'?!s.odd:!s.fishing)fail('관련 게임이 꺼져 있습니다.');
        if(item.id==='exp'&&u.daily.fishExp>=LIMIT.exp)fail('오늘 낚시 EXP 한도에 도달했습니다.');
        u.bag[item.id]--;u.buffs[item.id]=Math.max(now,u.buffs[item.id]||0)+20*60000;this.store.log(r.id,u.id,'item-use',{item:item.id,until:u.buffs[item.id]},now);return answer(`${item.name} 20분 적용! 같은 효과는 시간이 연장됩니다.`);
      }
      fail('사용법: !아이템 구매 번호 / !아이템 사용 번호');
    }
    if(cmd==='신청취소'||cmd==='신청곡취소'){
      let index;
      if(!arg){index=r.songs.findLastIndex(x=>x.user===u.id);}
      else{if(!/^[1-9]\d*$/.test(arg)||!Number.isSafeInteger(Number(arg)))fail('사용법: !신청취소 또는 !신청취소 대기열번호');index=Number(arg)-1;}
      const song=r.songs[index];if(!song)fail('취소할 대기 신청곡이 없습니다. 현재 재생 중인 곡은 취소할 수 없습니다.');
      if(song.user!==u.id)fail('본인이 신청한 대기곡만 취소할 수 있습니다.');
      touchQueue(r);r.songs.splice(index,1);this.store.log(r.id,u.id,'song-cancel',{songId:song.id,title:song.title},now);return answer('신청 취소: '+song.title);
    }
    if(cmd==='신청곡'){

      if(!s.requests)fail('신청곡 접수가 닫혀 있습니다.');
      if(!arg||arg.length>500)fail('사용법: !신청곡 YouTube링크 [곡 제목] 또는 가수 - 제목');
      let song;try{song=parseSongRequest(arg);}catch(e){fail(e.message);}
      song.videoId||=savedSongVideo(r,song.title);
      if(song.title.length>150)fail('곡 제목은 150자 이내로 입력하세요.');
      if(r.lastRequester===u.id&&r.streak>=2)fail('연속 신청은 최대 2곡입니다. 다른 분의 신청 후 다시 신청해주세요.');
      if(r.songs.filter(x=>x.user===u.id).length>=s.requestMax)fail('1인당 대기열 한도에 도달했습니다.');
      if(!s.duplicateSongs&&[r.current,...r.songs].some(x=>x&&(x.title.toLowerCase()===song.title.toLowerCase()||song.videoId&&songVideoId(x)===song.videoId)))fail('이미 등록된 곡입니다.');
      if(song.videoId)rememberSongVideo(r,song,song.videoId);
      r.streak=r.lastRequester===u.id?r.streak+1:1;r.lastRequester=u.id;touchQueue(r);r.songs.push({id:randomUUID(),user:u.id,name:u.name,...song});return answer(`신청 완료: ${song.title.slice(0,65)} · 대기 ${r.songs.length}번째. 열린 재생 기기의 자동재생 설정에 따라 순서대로 재생됩니다.${song.videoId?' https://youtu.be/'+song.videoId:''}`);
    }
    return {text:null};
  }
  likeGreeting(roomId,event,{commit=true}={}){
    const now=this.now(),r=this.store.load(roomId),s=r?.settings,user=event.user;
    if(!r||!s.likeGreetingEnabled||s.quiet||!event.id||!user?.id||event.type!=='FREE'||event.combo!==null||!Number.isFinite(event.totalAmount)||event.totalAmount<=0)return {text:null};
    const eventId=`like:${event.id}`;
    if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,eventId))return {text:null};
    const last=r.likeGreetings&&Object.hasOwn(r.likeGreetings,user.id)?r.likeGreetings[user.id]:undefined;if(last!==undefined&&now-last<600000)return {text:null};
    if(now-r.lastResponse<s.responseGap*1000)return {text:null};
    const result={text:s.likeGreeting.replaceAll('{name}',user.nickname||'청취자').replaceAll('{amount}',String(event.totalAmount)),receipt:{id:eventId,user:user.id,time:now}};
    if(commit)this.recordLike(roomId,result.receipt);return result;
  }
  recordLike(roomId,receipt){
    this.store.transaction(roomId,r=>{if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,receipt.id))return;
      r.likeGreetings??={};Object.defineProperty(r.likeGreetings,receipt.user,{value:receipt.time,enumerable:true,writable:true,configurable:true});r.lastResponse=receipt.time;
      this.store.db.prepare('INSERT INTO events VALUES(?,?,?)').run(roomId,receipt.id,JSON.stringify({greeted:true}));
      this.store.log(roomId,receipt.user,'like-greeting',{},receipt.time);
    });
  }
  target(r,target){
    try{return resolveTarget(r.users,target,{identityKey:this.identityKey,room:r.id});}catch(error){fail(error.message);}
  }
}
class RuleError extends Error {}
function fail(message){throw new RuleError(message);}
function positive(text,max){if(!/^[1-9]\d*$/.test(String(text)))fail('양의 정수를 입력해주세요.');const v=Number(text);if(!Number.isSafeInteger(v)||v>max)fail(`최대 ${n(max)}까지 가능합니다.`);return v;}

