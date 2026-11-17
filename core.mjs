import {DEFAULT_CHARGE_NOTICE,LEGACY_CHARGE_NOTICE,spoonChargeReply} from './public/spoon-charge.mjs';
import {touchQueue,applySongAction} from './song-queue.mjs';
import {rewardListening} from './listening.mjs';
import {savedSongVideo,rememberSongVideo} from './song-library.mjs';
import {chatPage} from './pagination.mjs';
import {Outbox} from './outbox.mjs';
import {LOTTERY_CHUNK,lotterySummary,lotterySummaryAsync,lotteryExp} from './lottery.mjs';
import {playQuiz} from './quiz.mjs';
import {extraDefaults,normalizeExtras,validateExtras,keywordReply,playMiniGame} from './extras.mjs';
import {parseSongRequest,songVideoId,groupKeeps} from './public/song-utils.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID } from 'node:crypto';
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
    introEnabled:true,introText:'🤖 Spoon Studio는 신청곡·출석·게임·킵 관리를 돕는 방송 도우미입니다. 명령어는 !도움말로 확인하세요.',
    likeGreetingEnabled:true,likeGreeting:'{name}님, 좋아요 감사합니다 ♥',
    attendance:true, requests:true, duplicateSongs:false, requestMax:10,
    expPerCast:60, miss:0, payout:'random', goldenPolicy:'pending',
    betMin:100, betMax:50000, levelStep:10000,
    notice:'하트를 눌러주세요 ♥', welcome:'{name}님, 어서 오세요!',
    donation:'{name}님, {amount} 스푼 감사합니다!', bannedWords:[],
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
  constructor(store,{now=()=>Date.now(),int=(a,b)=>randomInt(a,b+1),region='kr'}={}){this.store=store;this.now=now;this.int=int;this.region=region;}
  listenerSnapshot(room,listeners,now=this.now()){
    this.store.transaction(room,r=>{this.reset(r);const rewards=rewardListening(r,listeners,now,(id,name)=>freshUser(id,name,dates(now).month));for(const reward of rewards)this.store.log(room,reward.user,'listening-reward',reward,now);r.listeningStatus='청취자 목록 확인 중 · 1분 간격으로 접속 시간을 추정합니다.';});
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
    const automatic=/^!\s*복권\s+자동\s*$/.test(String(event.message||'').trim());
    if(automatic&&user?.tickets>LOTTERY_CHUNK&&user.month===dates(now).month&&(event.isDj||now-r.lastResponse>=r.settings.responseGap*1000&&now-user.lastCommand>=r.settings.cooldown*1000)){
      if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return {text:null,duplicate:true};
      const count=user.tickets,ticketRevision=user.ticketRevision||0;if(!Number.isSafeInteger(count)||count<1)return this.handle(roomId,event);
      const counts=await lotterySummaryAsync(count,(min,max)=>this.int(min,max));
      return this.handle(roomId,event,{count,counts,ticketRevision});
    }
    return this.handle(roomId,event);
  }
  handle(roomId,event,preparedLottery=null){
    const now=this.now();
    return this.store.transaction(roomId,r=>{
      this.reset(r);
      if(!event.id||typeof event.id!=='string')throw Error('이벤트 ID가 필요합니다.');
      if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return {text:null,duplicate:true};
      let result;const checkpoint=JSON.stringify(r);
      this.store.db.exec('SAVEPOINT command_effects');
      try{result=this.command(r,event,now,preparedLottery);this.store.db.exec('RELEASE command_effects');}
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
      if(event.delivery&&result.text)new Outbox(this.store).enqueue(roomId,event.id,result.text,now);
      this.store.db.prepare('INSERT INTO events VALUES(?,?,?)').run(roomId,event.id,JSON.stringify(result));
      return result;
    });
  }
  command(r,e,now,preparedLottery=null){
    const s=r.settings,text=String(e.message??'').trim();
    if(!text.startsWith('!')){const out=keywordReply(r,e,now);if(out.text)this.store.log(r.id,e.user.id,'keyword-reply',{ruleId:out.ruleId},now);return out;}
    const bits=text.slice(1).trim().split(/\s+/),cmd=bits.shift()||'',arg=bits.join(' ');
    const dj=e.isDj===true;
    const answer=t=>{r.lastResponse=now;return {text:t};};
    const ticketReset=cmd==='복권초기화'||cmd==='복권'&&bits[0]==='초기화';
    if(ticketReset){
      if(!dj)fail('복권 초기화는 DJ 전용 명령어입니다.');
      const targets=cmd==='복권초기화'?bits:bits.slice(1);
      if(targets.length!==1)fail('사용법: !복권 초기화 @고유ID 또는 !복권초기화 @고유ID');
      const uid=this.target(r,targets[0]),user=r.users[uid],previous=user.tickets;
      user.tickets=0;user.ticketRevision=(user.ticketRevision||0)+1;
      this.store.log(r.id,uid,'ticket-reset',{previous,balance:0,actor:e.user.id},now);
      return answer(`${user.name}님 복권 초기화 · ${n(previous)}장 → 0장 (EXP·PT 유지)`);
    }
    if(dj){
      if(cmd==='조용'){if(!['on','off'].includes(arg))fail('사용법: !조용 on/off');s.quiet=arg==='on';r.settingsRevision=(r.settingsRevision||0)+1;return answer(`조용 모드 ${arg.toUpperCase()}`);}
      if(cmd==='복권지급'){
        if(bits.length<1||bits.length>2)fail('사용법: !복권지급 @고유ID 수량 (수량 생략 시 1장)');
        const [target,countText='1']=bits;
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
    if(!dj&&now-r.lastResponse<s.responseGap*1000)return {text:null,suppressed:'cooldown',retryAfterMs:r.lastResponse+s.responseGap*1000-now};
    const known=['내정보','출석','낚시','홀','짝','홀짝','복권','랭킹','랭킹조회','랭크','신청곡','신청취소','신청곡취소','신청곡목록','현재곡','다음곡','이전곡','재생','멈춤','삭제','도감','아이템','가방','버프','킵','룰렛','가위바위보','주사위','숫자맞히기','퀴즈','정답','보이스카드','스푼','도움말','공지','낚시정보'];
    if(!known.includes(cmd)){const out=keywordReply(r,e,now);if(out.text)this.store.log(r.id,e.user.id,'keyword-reply',{ruleId:out.ruleId},now);return out;}
    if(!e.user?.id)fail('청취자 식별 정보가 없습니다.');
    let u=r.users[e.user.id];
    if(u&&!dj&&now-u.lastCommand<s.cooldown*1000)return {text:null,suppressed:'cooldown',retryAfterMs:Math.max(u.lastCommand+s.cooldown*1000-now,r.lastResponse+s.responseGap*1000-now)};
    if(cmd==='내정보'&&arg==='생성'){
      if(!u){u=freshUser(e.user.id,e.user.nickname||'청취자',dates(now).month);r.users[u.id]=u;this.reset(r);}
      u.lastCommand=now;return answer(`${u.name}님 프로필이 준비되었습니다. !출석으로 복권을 받으세요.`);
    }
    if(u){u.name=e.user.nickname||u.name;u.lastCommand=now;}
    if(cmd==='도움말')return answer(`시작 !내정보 (자동 생성) · !출석 | 신청곡 !신청곡 · !이전곡 · !현재곡 · !다음곡 · DJ !재생 !멈춤 !삭제 | 정보 !랭킹 · !킵 · !스푼 · !보이스카드 | 게임 !복권${s.fishing?' · !낚시':''}${s.odd?' · !홀/!짝':''}${s.roulette?' · !룰렛':''}${s.rps?' · !가위바위보':''}${s.dice?' · !주사위':''}${s.numberGuess?' · !숫자맞히기':''}${s.quiz?' · !퀴즈 → !정답 답안':''}`);
    if(cmd==='보이스카드')return answer(r.voiceInboxUrl?`음성 접수: ${r.voiceInboxUrl}\n안 열리면 링크를 복사해 Safari·Chrome에서 열어주세요. 별도 DJ 수신함으로 전달됩니다.`:'DJ가 아직 음성메시지 접수를 열지 않았습니다.');
    if(cmd==='스푼')return answer(spoonChargeReply(s.spoonNotice,this.region));
    if(cmd==='공지')return answer(s.notice);
    if(cmd==='랭크')return answer(s.monthlyRank&&s.monthlyRankMonth===dates(now).month?`이번 달 넥스트초이스: ${s.monthlyRank} (DJ 수동 등록)`:'이번 달 순위 미등록 — 넥스트초이스 → 이번 달에서 확인해주세요.');
    if(['랭킹','랭킹조회'].includes(cmd))return answer(chatPage('팬랭킹',Object.values(r.users).sort((a,b)=>b.exp-a.exp||a.id.localeCompare(b.id)).map((v,i)=>`${i+1}. ${[...v.name].slice(0,25).join('')} ${n(v.exp)} EXP`),arg,'랭킹','등록된 청취자가 없습니다.'));
    if(cmd==='이전곡'){if(dj&&r.previous)r.songSelection={kind:'previous',id:r.previous.id,title:r.previous.title};return answer(r.previous?`이전곡: ${r.previous.title}${dj?' · 선택됨. !재생으로 재생하세요.':''}`:'이전에 재생한 곡이 없습니다.');}
    if(cmd==='현재곡')return answer(r.current?`현재곡: ${r.current.title}`:'현재곡이 없습니다.');
    if(cmd==='다음곡'){if(dj&&r.songs[0])r.songSelection={kind:'queue',id:r.songs[0].id,title:r.songs[0].title};return answer(r.songs[0]?`다음곡: ${r.songs[0].title}${dj?' · 선택됨. !재생으로 재생하세요.':''}`:'다음 신청곡이 없습니다.');}
    if(cmd==='신청곡목록'||cmd==='신청곡'&&!arg)return answer(chatPage('신청곡',r.songs.map((v,i)=>`${i+1}. ${[...v.title].slice(0,70).join('')} (${[...v.name].slice(0,20).join('')})`),arg,'신청곡목록','대기 중인 신청곡이 없습니다. !신청곡 가수 - 제목으로 신청하세요.'));
    if(cmd==='재생'||cmd==='멈춤'){
      if(!dj)fail('재생·멈춤은 DJ 전용 명령입니다.');
      if(arg)fail('사용법: !재생 또는 !멈춤');
      if(cmd==='재생'&&(r.current||r.songs.length||r.songSelection))applySongAction(r,{action:'start'},now);
      r.playbackControl={id:randomUUID(),action:cmd==='재생'?'play':'pause',time:now};
      this.store.log(r.id,e.user.id,'playback-control',{action:r.playbackControl.action},now);
      return answer(cmd==='멈춤'?'멈춤 요청을 보냈습니다. 열린 DJ 관리 화면에서 재생을 멈춥니다.':`재생 요청: ${r.current?.title||'새 신청곡 대기'} · PC의 DJ 관리 화면을 열어두세요. 브라우저가 차단하면 재생 버튼을 한 번 눌러주세요.`);
    }
    if(cmd==='삭제'){
      if(!dj)fail('신청곡 삭제는 DJ 전용입니다. 본인 신청곡은 !신청취소를 사용하세요.');
      if(arg&&!/^[1-9]\d*$/.test(arg))fail('사용법: !삭제 또는 !삭제 대기번호');
      if(!arg&&r.songSelection?.kind==='previous')fail('이전곡은 완료 기록입니다. 대기곡 삭제는 !삭제 번호로 입력하세요.');
      const selected=arg?r.songs[Number(arg)-1]:r.songSelection?.kind==='queue'?r.songs.find(x=>x.id===r.songSelection.id):!r.current?r.songs[0]:null;
      if(selected){applySongAction(r,{action:'remove',id:selected.id,expectedQueueRevision:r.queueRevision||0},now);return answer(`신청곡 삭제: ${selected.title} · 관리 화면에서 5분 이내 되돌릴 수 있습니다.`);}
      if(arg||!r.current)fail('삭제할 신청곡이 없습니다. !신청곡목록에서 번호를 확인하세요.');
      const title=r.current.title;applySongAction(r,{action:'finish'},now);r.playbackControl={id:randomUUID(),action:'pause',time:now};return answer(`현재곡 종료: ${title} · 완료 목록에 보관했습니다.`);
    }
    if(cmd==='아이템'&&arg==='상점')return answer(s.items.filter(i=>i.enabled).map(i=>`${i.id}: ${i.name} ${n(i.price)} PT / 20분${i.stock===0?' (품절)':''}`).join('\n'));
    if(!u&&(cmd==='내정보'||dj)){
      u=freshUser(e.user.id,e.user.nickname||'청취자',dates(now).month);r.users[u.id]=u;this.reset(r);u.lastCommand=now;
    }
    if(!u)fail('먼저 !내정보 를 입력하면 프로필이 자동으로 만들어집니다.');
    const quiz=playQuiz(this,r,u,cmd,arg,now,fail);if(quiz!==null)return answer(quiz);
    const mini=playMiniGame(this,r,u,cmd,arg,now,fail);if(mini!==null)return answer(mini);
    const active=id=>u.buffPaused?.[id]===undefined&&(u.buffs[id]||0)>now;
    if(cmd==='내정보')return answer(`${u.name} · Lv.${Math.floor(u.exp/s.levelStep)+1}\n${n(u.exp)} EXP / ${n(u.pt)} PT / 복권 ${n(u.tickets)}장\n애청지수 ${Math.floor((u.listeningMs||0)/60000)} · 확인된 청취 ${Math.floor((u.listeningMs||0)/60000)}분\n다음 레벨까지 ${n(s.levelStep-u.exp%s.levelStep)} EXP`);
    if(cmd==='출석'){
      if(!s.attendance)fail('출석 기능이 꺼져 있습니다.');if(u.attendance===dates(now).day)fail('오늘은 이미 출석했습니다.');
      if(!Number.isSafeInteger(u.tickets+1))fail('복권 보유량이 정확히 처리 가능한 정수 범위를 초과합니다.');
      u.attendance=dates(now).day;u.tickets++;u.ticketRevision=(u.ticketRevision||0)+1;this.store.log(r.id,u.id,'attendance',{tickets:1},now);return answer(`${u.name}님 출석! 복권 1장 지급`);
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
    if(cmd==='킵')return answer(chatPage('보유 킵',groupKeeps(u.keeps).map((k,i)=>`${i+1}. ${k.name} ×${k.count}`),arg,cmd,'보관 중인 킵이 없습니다.'));
    if(cmd==='가방')return answer(s.items.map(i=>`${i.id}: ${i.name} ×${u.bag[i.id]||0}`).join('\n'));
    if(cmd==='버프')return answer(s.items.filter(i=>(u.buffs[i.id]||0)>now).map(i=>`${i.name}: ${Math.ceil((u.buffs[i.id]-now)/60000)}분 남음${u.buffPaused?.[i.id]!==undefined?' (일시정지)':''}`).join('\n')||'적용 중인 효과가 없습니다.');
    if(cmd==='아이템'){
      const [action,id]=bits,item=s.items.find(i=>i.id===id||String(s.items.indexOf(i)+1)===id);if(!item)fail('아이템 번호 또는 ID를 확인하세요. 예: !아이템 구매 exp');
      if(action==='구매'){
        if(!item.enabled)fail('판매 중지 상품입니다.');if(item.stock===0)fail('품절 상품입니다.');if(u.pt<item.price)fail('포인트가 부족합니다.');u.pt-=item.price;if(item.stock!==null&&item.stock!==undefined){item.stock--;r.settingsRevision=(r.settingsRevision||0)+1;}u.bag[item.id]=(u.bag[item.id]||0)+1;this.store.log(r.id,u.id,'purchase',{item:item.id,price:item.price},now);return answer(`${item.name} 구매 완료`);
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
      r.streak=r.lastRequester===u.id?r.streak+1:1;r.lastRequester=u.id;touchQueue(r);r.songs.push({id:randomUUID(),user:u.id,name:u.name,...song});return answer(`신청 완료: ${song.title.slice(0,65)} · 대기 ${r.songs.length}번째. DJ 관리 화면에서 재생 시작 후 순서대로 재생됩니다.${song.videoId?' https://youtu.be/'+song.videoId:''}`);
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
    const value=String(target||'').replace(/^@/,'');if(r.users[value])return value;
    const hits=Object.values(r.users).filter(u=>u.name===value);if(hits.length!==1)fail('대상을 고유 ID로 지정해주세요. 닉네임은 중복될 수 있습니다.');return hits[0].id;
  }
}
class RuleError extends Error {}
function fail(message){throw new RuleError(message);}
function positive(text,max){if(!/^[1-9]\d*$/.test(String(text)))fail('양의 정수를 입력해주세요.');const v=Number(text);if(!Number.isSafeInteger(v)||v>max)fail(`최대 ${n(max)}까지 가능합니다.`);return v;}

