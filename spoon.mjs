import {setAutomation} from './automation.mjs';
import {Outbox} from './outbox.mjs';
import {expireQuizRounds,autoQuizCandidate,autoQuizDelivered} from './quiz.mjs';
import {autoChatCandidate} from './extras.mjs';
import {expandWeatherTokens,hasWeatherTokens} from './weather-extras.mjs';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
const REGIONS={kr:'https://kr-openapi.spooncast.net',jp:'https://jp-openapi.spooncast.net'};
export function spoonRegion(env={}){const region=String(env.SPOON_REGION||'kr').toLowerCase();if(!REGIONS[region])throw Error('SPOON_REGION은 kr 또는 jp여야 합니다.');return region;}
// SPOON_API_BASE exists only so tests can point at a local mock; it is ignored in production.
export function apiBase(env={}){if(env.SPOON_API_BASE&&env.NODE_ENV!=='production')return String(env.SPOON_API_BASE).replace(/\/$/,'');return REGIONS[spoonRegion(env)];}
export function seal(data,key){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);const encrypted=Buffer.concat([c.update(JSON.stringify(data),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),encrypted]).toString('base64');}
export function unseal(text,key){const b=Buffer.from(text,'base64'),c=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8'));}
export async function* frames(body){
  const reader=body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
  try{for(;;){const {value,done}=await reader.read();if(done)break;buffer+=value;let match;while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const frame={id:'',event:'message',data:[]};for(const line of block.split(/\r?\n/)){if(line.startsWith(':'))continue;const p=line.indexOf(':');if(p<0)continue;const field=line.slice(0,p),v=line.slice(p+1).replace(/^ /,'');if(field==='data')frame.data.push(v);else if(field==='event'||field==='id')frame[field]=v;}if(frame.data.length)yield {...frame,data:JSON.parse(frame.data.join('\n'))};}if(buffer.length>1000000)throw Error('SSE frame too large');}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export class Spoon {
  constructor(store,engine,env){this.store=store;this.engine=engine;this.env=env;this.base=apiBase(env);this.outbox=new Outbox(store);this.store.db.exec("UPDATE outbox SET status='uncertain' WHERE status='sending'");this.running=new Map();this.status=new Map();this.refreshes=new Map();this.authEpochs=new Map();this.sendTimes=new Map();this.sendEpochs=new Map();this.greeted=new Set();this.timers=new Map();}
  configured(){return !!(this.env.SPOON_CLIENT_ID&&this.env.SPOON_CLIENT_SECRET&&/^[a-fA-F0-9]{64}$/.test(this.env.TOKEN_KEY||''));}
  async tokenRequest(fields){const res=await fetch(`${this.base}/v1/oauth/token`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${this.env.SPOON_CLIENT_ID}:${this.env.SPOON_CLIENT_SECRET}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error(`Spoon 인증 실패 (${res.status}). 새로 연결해주세요.`);return {...await res.json(),expiresAt:Date.now()+3600000};}
  saveToken(room,t){t.region=spoonRegion(this.env);t.expiresAt=Date.now()+(t.expires_in||3600)*1000;this.store.db.prepare('INSERT INTO tokens VALUES(?,?) ON CONFLICT(room) DO UPDATE SET data=excluded.data').run(room,seal(t,this.env.TOKEN_KEY));this.refreshes.delete(room);}
  async access(room){
    if(this.refreshes.has(room))return this.refreshes.get(room);
    const row=this.store.db.prepare('SELECT data FROM tokens WHERE room=?').get(room);if(!row)throw Error('스푼 연결이 필요합니다.');const t=unseal(row.data,this.env.TOKEN_KEY);const authEpoch=this.authEpochs.get(room)||0;if((t.region||'kr')!==spoonRegion(this.env))throw Error('스푼 지역이 변경되었습니다. 계정을 다시 연결하세요.');
    if(Date.now()<t.expiresAt-300000)return t.access_token;
    const replacement=()=>{const current=this.store.db.prepare('SELECT data FROM tokens WHERE room=?').get(room);if(current&&current.data!==row.data){const newer=unseal(current.data,this.env.TOKEN_KEY);if(newer.expiresAt>Date.now())return newer.access_token;}return null;};
    const p=(async()=>{let next;try{next=await this.tokenRequest({grant_type:'refresh_token',refresh_token:t.refresh_token});}catch(error){const newer=replacement();if(newer)return newer;throw error;}const newer=replacement();if(newer)return newer;if((this.authEpochs.get(room)||0)!==authEpoch||!this.store.db.prepare('SELECT 1 FROM tokens WHERE room=?').get(room))throw Error('스푼 연결이 해제되었습니다.');this.saveToken(room,next);return next.access_token;})();this.refreshes.set(room,p);try{return await p;}finally{if(this.refreshes.get(room)===p)this.refreshes.delete(room);}
  }
  async disconnect(room){
    const row=this.store.db.prepare('SELECT data FROM tokens WHERE room=?').get(room);
    this.authEpochs.set(room,(this.authEpochs.get(room)||0)+1);this.stop(room);this.refreshes.delete(room);
    this.store.db.prepare('DELETE FROM tokens WHERE room=?').run(room);
    this.store.db.prepare("DELETE FROM outbox WHERE room=?").run(room);
    let revoked=!row;
    if(row)try{const t=unseal(row.data,this.env.TOKEN_KEY);const res=await fetch(this.base+'/v1/oauth/revoke',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(this.env.SPOON_CLIENT_ID+':'+this.env.SPOON_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:t.refresh_token||t.access_token,token_type_hint:t.refresh_token?'refresh_token':'access_token'}),signal:AbortSignal.timeout(10000)});revoked=res.ok;}catch{}
    for(const key of this.greeted)if(key.startsWith(room+':'))this.greeted.delete(key);
    for(const key of this.timers.keys())if(key.startsWith(room+':'))this.timers.delete(key);
    return {revoked};
  }
  async connect(code){const token=await this.tokenRequest({grant_type:'authorization_code',code,redirect_uri:`${this.env.PUBLIC_URL}/oauth/callback`});const res=await fetch(`${this.base}/v1/me`,{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error('DJ 정보를 확인할 수 없습니다. me.read 권한을 확인하세요.');const {userId}=await res.json();if(!userId)throw Error('DJ ID가 없습니다.');this.store.create(userId,`DJ ${userId.slice(0,6)}`);if(this.env.AUTO_OPERATIONS==='1'&&this.store.load(userId).automation===undefined)this.store.transaction(userId,r=>setAutomation(r,true));this.stop(userId);this.saveToken(userId,token);this.start(userId);return userId;}
  async send(room,message){return (await this.sendDetailed(room,message)).kind==='sent';}
  async sendDetailed(room,message){
    if(!message)return {kind:'failed'};
    const now=Date.now(),r=this.store.load(room);if(!r?.live)return {kind:'deferred'};
    if(now-(this.sendTimes.get(room)||0)<r.settings.responseGap*1000){this.store.log(room,'system','chat-suppressed',{reason:'response-gap'});return {kind:'deferred'};}
    this.sendTimes.set(room,now);
    const epoch=this.sendEpochs.get(room)||0;
    // A single concise message; never flood a room to paginate a long result.
    const clipped=message.length>200?message.slice(0,196)+'…':message;
    try{
      const token=await this.access(room);
      if((this.sendEpochs.get(room)||0)!==epoch||!this.store.load(room)?.live)return {kind:'deferred'};
      const res=await fetch(`${this.base}/v1/live/chat`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({message:clipped}),signal:AbortSignal.timeout(10000)});
      if(!res.ok)this.store.log(room,'system','chat-send-failed',{status:res.status});return {kind:res.ok?'sent':res.status===429?'retry':res.status>=500?'ambiguous':'failed'};
    }catch{if((this.sendEpochs.get(room)||0)===epoch)this.store.log(room,'system','chat-send-failed',{reason:'connection-or-authentication'});return {kind:'ambiguous'};}
  }
  stop(room){this.sendEpochs.set(room,(this.sendEpochs.get(room)||0)+1);this.running.get(room)?.abort();this.running.delete(room);if(this.store.load(room))this.setLive(room,false);this.status.set(room,'연결 중지');}
  start(room){if(this.running.has(room)||!this.configured()||!this.store.db.prepare('SELECT 1 FROM tokens WHERE room=?').get(room))return;const controller=new AbortController();this.running.set(room,controller);void this.loop(room,controller).catch(()=>{});}
  async loop(room,controller){let backoff=5000;const signal=controller.signal;
    try{while(!signal.aborted){
      try{
        this.status.set(room,'방송 대기 / 연결 중');
        const token=await this.access(room);if(signal.aborted)return;
        const res=await fetch(`${this.base}/v1/live/events`,{headers:{Authorization:`Bearer ${token}`,Accept:'text/event-stream'},signal:AbortSignal.any([signal,AbortSignal.timeout(65*60*1000)])});
        if(signal.aborted)return;
        if(res.status===404){this.setLive(room,false);this.status.set(room,'방송 시작 대기');}
        else if(res.status===401||res.status===403){this.setLive(room,false);this.status.set(room,`재연결 또는 권한 확인 필요 (${res.status})`);return;}
        else if(!res.ok)throw Error(`API ${res.status}`);
        else {
          this.setLive(room,true);this.status.set(room,'방송 연결됨');backoff=5000;
          for await(const f of frames(res.body)){
            if(signal.aborted)return;
            if(f.event==='end'){
              if(f.data.reason==='DUPLICATE_CONNECTION'){this.status.set(room,'다른 서버가 연결됨 — 재연결 중지');return;}
              if(f.data.reason==='LIVE_ENDED'){for(const k of this.greeted)if(k.startsWith(room+':'))this.greeted.delete(k);this.store.transaction(room,r=>r.introDueAt=null);}
              break;
            }
            if(f.event==='chat'){
              const {data}=f;const cfg=this.store.load(room).settings;
              const banned=cfg.bannedWords.some(w=>String(data.message).includes(w));
              if(banned)this.store.log(room,data.user.id,'banned-word',{message:data.message});
              if(!banned){const out=await this.engine.handleAsync(room,{...data,id:createHash('sha256').update(f.id||`${data.sentTime}:${data.user.id}:${data.message}`).digest('hex'),delivery:true});if(out.text)await this.outbox.flush(room,text=>this.sendDetailed(room,text));}
            }else if(f.event==='presence'){
              const key=`${room}:${f.data.user.id}`;if(!this.greeted.has(key)){this.greeted.add(key);const s=this.store.load(room).settings;if(s.welcome){this.outbox.enqueue(room,'presence:'+createHash('sha256').update(f.id||`${f.data.time}:${f.data.user.id}`).digest('hex'),s.welcome.replaceAll('{name}',f.data.user.nickname||'청취자'));if(!s.quiet)await this.outbox.flush(room,text=>this.sendDetailed(room,text));}}
            }else if(f.event==='like'){
              const out=this.engine.likeGreeting(room,{...f.data,id:f.id||`${f.data.time}:${f.data.user.id}`},{commit:false});
              if(out.text&&await this.send(room,out.text))this.engine.recordLike(room,out.receipt);
            }else if(f.event==='donation'){
              const s=this.store.load(room).settings;
              // 후원 금액 10을 메뉴판의 '10' 항목에서 찾습니다. 후원자 이름을 받지 못하면 '청취자'라고 부릅니다.
              const amount=String(f.data.amount),name=f.data.user?.nickname||'청취자';
              const reactions=s.donationReactions??{};
              // 같은 금액에 등록된 문구가 있으면 그 문구를 고르고, 없으면 기본 감사 인사를 고릅니다.
              const template=Object.hasOwn(reactions,amount)?reactions[amount]:s.donation;
              if(template){
                // '{name}'과 '{amount}' 자리에 실제 이름과 금액을 넣습니다.
                const text=template.replace(/\{name\}|\{amount\}/g,token=>token==='{name}'?name:amount);
                // 같은 후원 알림이 다시 들어와도 인사를 한 번만 보내도록 후원마다 구별되는 키를 만듭니다.
                const key='donation:'+createHash('sha256').update(f.id||JSON.stringify(f.data)).digest('hex');
                this.outbox.enqueue(room,key,text);
                // 조용 모드가 꺼져 있으면 전송 대기열에서 메시지를 꺼내 보내기를 시도합니다.
                if(!s.quiet)await this.outbox.flush(room,text=>this.sendDetailed(room,text));
              }
            }
          }
          this.setLive(room,false);
        }
      }catch(e){if(signal.aborted)return;this.setLive(room,false);this.status.set(room,'연결 재시도 중');this.store.log(room,'system','connection-error',{message:e.message});}
      await new Promise(resolve=>{const timer=setTimeout(done,backoff);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});});backoff=Math.min(60000,backoff*1.5);
    }}finally{if(this.running.get(room)===controller&&this.store.load(room)){this.setLive(room,false);this.running.delete(room);}}
  }
  setLive(room,live){this.store.transaction(room,r=>{this.engine.syncBuffs(r);if(r.live!==live)r.listenerSnapshot={};r.live=live;this.engine.syncBuffs(r);if(live&&!r.introDueAt)r.introDueAt=Date.now()+600000;});}
  async pollListeners(room){
    try{
      const token=await this.access(room),listeners=[],seen=new Set();let cursor=null;
      do{
        const url=new URL(`${this.base}/v1/live/listeners`);if(cursor)url.searchParams.set('cursor',cursor);
        const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
        if(!res.ok)throw Error(res.status===403?'청취 자동 보상: listeners.read 권한으로 스푼을 다시 연결하세요.':`청취자 확인 실패 (${res.status}) · 이번 시간은 적립하지 않습니다.`);
        const page=await res.json();if(!Array.isArray(page.listeners)||page.nextCursor!==null&&typeof page.nextCursor!=='string')throw Error('청취자 응답 형식을 확인하지 못했습니다.');
        listeners.push(...page.listeners);cursor=page.nextCursor;
        if(cursor){if(seen.has(cursor)||seen.size>=100)throw Error('청취자 목록 전체를 확인하지 못했습니다.');seen.add(cursor);}
      }while(cursor);
      this.engine.listenerSnapshot(room,listeners);
    }catch(error){if(this.store.load(room))this.store.transaction(room,r=>{r.listenerSnapshot={};r.listeningStatus=error.message;});}
  }
  async tick(){
    if(this.ticking)return;this.ticking=true;
    try{for(const id of this.store.ids()){
      const listeningRoom=this.store.load(id),pollKey='listeners:'+id;
      if(this.configured()&&listeningRoom.live&&listeningRoom.settings.listenRewards&&Date.now()-(this.timers.get(pollKey)||0)>=60000){this.timers.set(pollKey,Date.now());await this.pollListeners(id);}
      let notice=null,isIntro=false,autoChat=null,announcement=null,quiz=null;
      this.store.transaction(id,r=>{
        this.engine.reset(r);
        if(r.live&&!r.settings.quiet)for(const expired of expireQuizRounds(this.engine,r,Date.now()))this.outbox.enqueue(id,expired.key,expired.text);
        if(!r.live||!r.settings.quiz||!r.settings.autoQuizEnabled)autoQuizCandidate(this.engine,r,Date.now());
        if(!r.live||r.settings.quiet||Date.now()-r.lastResponse<r.settings.responseGap*1000)return;
        if(r.settings.introEnabled){if(!r.introDueAt)r.introDueAt=Date.now()+600000;if(Date.now()>=r.introDueAt){notice=r.settings.introText;isIntro=true;return;}}
        quiz=autoQuizCandidate(this.engine,r,Date.now());if(quiz)return;
        autoChat=autoChatCandidate(r,Date.now(),(min,max)=>this.engine.int(min,max));if(autoChat){notice=autoChat.text;return;}
        for(const a of r.settings.announcements){
          const key=`${id}:${a.id}`,last=this.timers.get(key);
          if(last===undefined){this.timers.set(key,Date.now());continue;}
          if(a.enabled&&Date.now()-last>=a.minutes*60000){notice=a.text;announcement={key,id:a.id,text:a.text,minutes:a.minutes};break;}
        }
      });
      const current=this.store.load(id);if(current?.live&&!current.settings.quiet)await this.outbox.flush(id,text=>this.sendDetailed(id,text));
      if(quiz){let result;try{result=await this.sendDetailed(id,quiz.text);}catch{result={kind:'ambiguous'};}this.store.transaction(id,r=>autoQuizDelivered(this.engine,r,quiz,result.kind,Date.now()));}
      if(notice){const text=hasWeatherTokens(notice)?await expandWeatherTokens(notice,request=>this.engine.lifestyle?.answer(request,{strict:true})):notice,sent=text?await this.send(id,text):true;/* 날씨 문구가 전부 비면 보내지 않고 다음 순서로 넘어갑니다 */if(announcement&&sent)this.store.transaction(id,r=>{const current=r.settings.announcements.find(a=>a.id===announcement.id);if(current?.enabled&&current.text===announcement.text&&current.minutes===announcement.minutes){this.timers.set(announcement.key,Date.now());r.lastResponse=Date.now();this.store.log(id,'system','announcement',{id:announcement.id});}});if(autoChat&&sent)this.store.transaction(id,r=>{if(r.autoChat?.signature===autoChat.signature){r.autoChat.index=autoChat.index+1;r.autoChat.dueAt=Date.now()+r.settings.autoChatMinutes*60000;r.lastResponse=Date.now();this.store.log(id,'system','auto-chat',{index:autoChat.index});}});if(isIntro&&sent)this.store.transaction(id,r=>{r.introDueAt=Date.now()+600000;r.lastResponse=Date.now();this.store.log(id,'system','program-intro',{});});}
    }}finally{this.ticking=false;}
  }
}
