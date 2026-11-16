import {LOTTERY_CHUNK,lotterySummary,lotterySummaryAsync,lotteryExp} from './lottery.mjs';
import {playQuiz} from './quiz.mjs';
import {extraDefaults,normalizeExtras,validateExtras,keywordReply,playMiniGame} from './extras.mjs';
import {parseSongRequest,songVideoId,groupKeeps} from './public/song-utils.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID } from 'node:crypto';

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
    cooldown:20, responseGap:3, quiet:false, fishing:false, odd:false,
    roulette:false, rouletteRewards:[{id:'miss',name:'꽝',weight:1,miss:true}],
    spoonNotice:'/스푼 <<<< 스푼 할인 충전 안내를 확인해 보세요! 할인 적용 여부와 최종 결제 금액은 충전 화면에서 확인해 주세요.',
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
  validateExtras(s);
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
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(room TEXT,id TEXT,result TEXT,PRIMARY KEY(room,id));
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,room TEXT,time INTEGER,user TEXT,type TEXT,data TEXT);
      CREATE TABLE IF NOT EXISTS tokens(room TEXT PRIMARY KEY,data TEXT);
      CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,room TEXT,time INTEGER,data TEXT);`);
  }
  ids(){return this.db.prepare('SELECT id FROM rooms').all().map(r=>r.id);}
  load(id){const row=this.db.prepare('SELECT data FROM rooms WHERE id=?').get(id);if(!row)return null;const room=JSON.parse(row.data);room.users=Object.assign(Object.create(null),room.users);normalizeExtras(room.settings);room.settings.pending=defaults().pending;room.settings.spoonNotice??=defaults().spoonNotice;room.settings.introEnabled??=true;room.settings.introText??=defaults().introText;room.settings.roulette??=false;room.settings.rouletteRewards??=defaults().rouletteRewards;room.settings.likeGreetingEnabled??=true;room.settings.likeGreeting??=defaults().likeGreeting;return room;}
  create(id,name) {
    if(!this.load(id))this.save({id,name,settings:defaults(),month:dates().month,users:{},songs:[],current:null,previous:null,lastRequester:null,streak:0,lastResponse:0,live:false,noticeTimes:{},achievers:[],special:[]});
    return this.load(id);
  }
  save(room){this.db.prepare('INSERT INTO rooms VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(room.id,JSON.stringify(room));}
  log(room,user,type,data,now=Date.now()){this.db.prepare('INSERT INTO audit(room,time,user,type,data) VALUES(?,?,?,?,?)').run(room,now,user,type,JSON.stringify(data));}
  transaction(id,fn){this.db.exec('BEGIN IMMEDIATE');try{const room=this.load(id);if(!room)throw Error('방송을 찾을 수 없습니다.');const result=fn(room);this.save(room);this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  backup(id){const r=this.load(id);if(!r)throw Error('방송이 없습니다.');const key=randomUUID();this.db.prepare('INSERT INTO backups VALUES(?,?,?,?)').run(key,id,Date.now(),JSON.stringify(r.settings));return key;}
  logs(id){return this.db.prepare('SELECT * FROM audit WHERE room=? ORDER BY seq DESC LIMIT 200').all(id).map(r=>({...r,data:JSON.parse(r.data)}));}
}
export class Engine {
  constructor(store,{now=()=>Date.now(),int=(a,b)=>randomInt(a,b+1)}={}){this.store=store;this.now=now;this.int=int;}
  reset(r){
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
    const known=['내정보','출석','낚시','홀','짝','홀짝','복권','랭킹','랭킹조회','랭크','신청곡','신청곡목록','현재곡','다음곡','이전곡','도감','아이템','가방','버프','킵','룰렛','가위바위보','주사위','숫자맞히기','퀴즈','정답','보이스카드','스푼','도움말','공지','낚시정보'];
    if(!known.includes(cmd)){const out=keywordReply(r,e,now);if(out.text)this.store.log(r.id,e.user.id,'keyword-reply',{ruleId:out.ruleId},now);return out;}
    if(!e.user?.id)fail('청취자 식별 정보가 없습니다.');
    let u=r.users[e.user.id];
    if(u&&!dj&&now-u.lastCommand<s.cooldown*1000)return {text:null,suppressed:'cooldown',retryAfterMs:Math.max(u.lastCommand+s.cooldown*1000-now,r.lastResponse+s.responseGap*1000-now)};
    if(cmd==='내정보'&&arg==='생성'){
      if(dj)fail('청취자용 프로필입니다.');
      if(!u){u=freshUser(e.user.id,e.user.nickname||'청취자',dates(now).month);r.users[u.id]=u;this.reset(r);}
      u.lastCommand=now;return answer(`${u.name}님 프로필이 준비되었습니다. !출석으로 복권을 받으세요.`);
    }
    if(u){u.name=e.user.nickname||u.name;u.lastCommand=now;}
    if(cmd==='도움말')return answer(`시작 !내정보 생성 · !출석 | 신청곡 !신청곡 · !이전곡 · !현재곡 · !다음곡 | 정보 !랭킹 · !킵 · !스푼 · !보이스카드 | 게임 !복권${s.fishing?' · !낚시':''}${s.odd?' · !홀/!짝':''}${s.roulette?' · !룰렛':''}${s.rps?' · !가위바위보':''}${s.dice?' · !주사위':''}${s.numberGuess?' · !숫자맞히기':''}${s.quiz?' · !퀴즈 → !정답 답안':''}`);
    if(cmd==='보이스카드')return answer(r.voiceInboxUrl?`DJ에게 음성 보내기: ${r.voiceInboxUrl} (스푼 앱이 아닌 별도 접수함)`:'DJ가 아직 음성메시지 접수를 열지 않았습니다.');
    if(cmd==='스푼')return answer(s.spoonNotice);
    if(cmd==='공지')return answer(s.notice);
    if(cmd==='랭크')return answer(s.monthlyRank&&s.monthlyRankMonth===dates(now).month?`이번 달 넥스트초이스: ${s.monthlyRank} (DJ 수동 등록)`:'이번 달 순위 미등록 — 넥스트초이스 → 이번 달에서 확인해주세요.');
    if(['랭킹','랭킹조회'].includes(cmd))return answer(Object.values(r.users).sort((a,b)=>b.exp-a.exp||a.id.localeCompare(b.id)).slice(0,8).map((v,i)=>`${i+1}. ${v.name} ${n(v.exp)} EXP`).join('\n')||'등록된 청취자가 없습니다.');
    if(cmd==='이전곡')return answer(r.previous?`이전곡: ${r.previous.title}`:'이전에 재생한 곡이 없습니다.');
    if(cmd==='현재곡')return answer(r.current?`현재곡: ${r.current.title}`:'현재곡이 없습니다.');
    if(cmd==='다음곡')return answer(r.songs[0]?`다음곡: ${r.songs[0].title}`:'다음 신청곡이 없습니다.');
    if(cmd==='신청곡목록')return answer(r.songs.slice(0,8).map((v,i)=>`${i+1}. ${v.title} (${v.name})`).join('\n')||'대기 중인 신청곡이 없습니다.');
    if(cmd==='아이템'&&arg==='상점')return answer(s.items.filter(i=>i.enabled).map(i=>`${i.id}: ${i.name} ${n(i.price)} PT / 20분${i.stock===0?' (품절)':''}`).join('\n'));
    if(!u)fail('먼저 !내정보 생성 을 입력해주세요.');
    const quiz=playQuiz(this,r,u,cmd,arg,now,fail);if(quiz!==null)return answer(quiz);
    const mini=playMiniGame(this,r,u,cmd,arg,now,fail);if(mini!==null)return answer(mini);
    const active=id=>(u.buffs[id]||0)>now;
    if(cmd==='내정보')return answer(`${u.name} · Lv.${Math.floor(u.exp/s.levelStep)+1}\n${n(u.exp)} EXP / ${n(u.pt)} PT / 복권 ${n(u.tickets)}장\n다음 레벨까지 ${n(s.levelStep-u.exp%s.levelStep)} EXP`);
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
    if(cmd==='도감')return answer(Object.values(u.book).map(b=>`${b.name} ×${b.count}`).join('\n')||'아직 잡은 물고기가 없습니다.');
    if(cmd==='룰렛'){
      if(arg)fail('사용법: !룰렛');
      if(!s.roulette)fail('룰렛이 꺼져 있습니다. DJ가 보상과 확률을 설정한 뒤 켜 주세요.');
      const reward=this.weighted(s.rouletteRewards);const name=reward.name.trim().normalize('NFC');
      if(reward.miss){u.keepHistory??=[];u.keepHistory.push({id:randomUUID(),text:name,kind:'miss',time:now,actor:u.id});}
      else u.keeps.push(name);
      this.store.log(r.id,u.id,'roulette',{name,miss:reward.miss},now);
      return answer(reward.miss?`${u.name}님 룰렛 결과: ${name} · 보유 킵에는 추가되지 않으며 사용내역에 기록했습니다.`:`${u.name}님 룰렛 당첨: ${name} · 킵에 자동 등록했습니다.`);
    }
    if(cmd==='킵')return answer(groupKeeps(u.keeps).map((k,i)=>`${i+1}. ${k.name} ×${k.count}`).join('\n')||'보관 중인 킵이 없습니다.');
    if(cmd==='가방')return answer(s.items.map(i=>`${i.id}: ${i.name} ×${u.bag[i.id]||0}`).join('\n'));
    if(cmd==='버프')return answer(s.items.filter(i=>active(i.id)).map(i=>`${i.name}: ${Math.ceil((u.buffs[i.id]-now)/60000)}분 남음`).join('\n')||'적용 중인 효과가 없습니다.');
    if(cmd==='아이템'){
      const [action,id]=bits,item=s.items.find(i=>i.id===id||String(s.items.indexOf(i)+1)===id);if(!item)fail('아이템 번호 또는 ID를 확인하세요. 예: !아이템 구매 exp');
      if(action==='구매'){
        if(!item.enabled)fail('판매 중지 상품입니다.');if(item.stock===0)fail('품절 상품입니다.');if(u.pt<item.price)fail('포인트가 부족합니다.');u.pt-=item.price;if(item.stock!==null&&item.stock!==undefined)item.stock--;u.bag[item.id]=(u.bag[item.id]||0)+1;this.store.log(r.id,u.id,'purchase',{item:item.id,price:item.price},now);return answer(`${item.name} 구매 완료`);
      }
      if(action==='사용'){
        if(!(u.bag[item.id]>0))fail('보유 아이템이 없습니다.');if(item.id==='odd'?!s.odd:!s.fishing)fail('관련 게임이 꺼져 있습니다.');
        if(item.id==='exp'&&u.daily.fishExp>=LIMIT.exp)fail('오늘 낚시 EXP 한도에 도달했습니다.');
        u.bag[item.id]--;u.buffs[item.id]=Math.max(now,u.buffs[item.id]||0)+20*60000;this.store.log(r.id,u.id,'item-use',{item:item.id,until:u.buffs[item.id]},now);return answer(`${item.name} 20분 적용! 같은 효과는 시간이 연장됩니다.`);
      }
      fail('사용법: !아이템 구매 번호 / !아이템 사용 번호');
    }
    if(cmd==='신청곡'){
      if(!s.requests)fail('신청곡 접수가 닫혀 있습니다.');
      if(!arg||arg.length>500)fail('사용법: !신청곡 YouTube링크 [곡 제목] 또는 가수 - 제목');
      let song;try{song=parseSongRequest(arg);}catch(e){fail(e.message);}
      if(song.title.length>150)fail('곡 제목은 150자 이내로 입력하세요.');
      if(r.lastRequester===u.id&&r.streak>=2)fail('연속 신청은 최대 2곡입니다. 다른 분의 신청 후 다시 신청해주세요.');
      if(r.songs.filter(x=>x.user===u.id).length>=s.requestMax)fail('1인당 대기열 한도에 도달했습니다.');
      if(!s.duplicateSongs&&[r.current,...r.songs].some(x=>x&&(x.title.toLowerCase()===song.title.toLowerCase()||song.videoId&&songVideoId(x)===song.videoId)))fail('이미 등록된 곡입니다.');
      r.streak=r.lastRequester===u.id?r.streak+1:1;r.lastRequester=u.id;r.songs.push({id:randomUUID(),user:u.id,name:u.name,...song});return answer(`신청 완료: ${song.title}`);
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
