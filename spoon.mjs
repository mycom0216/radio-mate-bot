import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const BASE='https://kr-openapi.spooncast.net';
export function seal(data,key){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);const encrypted=Buffer.concat([c.update(JSON.stringify(data),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),encrypted]).toString('base64');}
export function unseal(text,key){const b=Buffer.from(text,'base64'),c=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8'));}
export async function* frames(body){
  const reader=body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
  try{for(;;){const {value,done}=await reader.read();if(done)break;buffer+=value;let match;while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const frame={id:'',event:'message',data:[]};for(const line of block.split(/\r?\n/)){if(line.startsWith(':'))continue;const p=line.indexOf(':');if(p<0)continue;const field=line.slice(0,p),v=line.slice(p+1).replace(/^ /,'');if(field==='data')frame.data.push(v);else if(field==='event'||field==='id')frame[field]=v;}if(frame.data.length)yield {...frame,data:JSON.parse(frame.data.join('\n'))};}if(buffer.length>1000000)throw Error('SSE frame too large');}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export class Spoon {
  constructor(store,engine,env){this.store=store;this.engine=engine;this.env=env;this.running=new Map();this.status=new Map();this.refreshes=new Map();this.sendTimes=new Map();this.greeted=new Set();this.timers=new Map();}
  configured(){return !!(this.env.SPOON_CLIENT_ID&&this.env.SPOON_CLIENT_SECRET&&/^[a-fA-F0-9]{64}$/.test(this.env.TOKEN_KEY||''));}
  async tokenRequest(fields){const res=await fetch(`${BASE}/v1/oauth/token`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${this.env.SPOON_CLIENT_ID}:${this.env.SPOON_CLIENT_SECRET}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error(`Spoon 인증 실패 (${res.status}). 새로 연결해주세요.`);return {...await res.json(),expiresAt:Date.now()+3600000};}
  saveToken(room,t){t.expiresAt=Date.now()+(t.expires_in||3600)*1000;this.store.db.prepare('INSERT INTO tokens VALUES(?,?) ON CONFLICT(room) DO UPDATE SET data=excluded.data').run(room,seal(t,this.env.TOKEN_KEY));}
  async access(room){
    if(this.refreshes.has(room))return this.refreshes.get(room);
    const row=this.store.db.prepare('SELECT data FROM tokens WHERE room=?').get(room);if(!row)throw Error('스푼 연결이 필요합니다.');const t=unseal(row.data,this.env.TOKEN_KEY);
    if(Date.now()<t.expiresAt-300000)return t.access_token;
    const p=(async()=>{const next=await this.tokenRequest({grant_type:'refresh_token',refresh_token:t.refresh_token});this.saveToken(room,next);return next.access_token;})();this.refreshes.set(room,p);try{return await p;}finally{this.refreshes.delete(room);}
  }
  async connect(code){const token=await this.tokenRequest({grant_type:'authorization_code',code,redirect_uri:`${this.env.PUBLIC_URL}/oauth/callback`});const res=await fetch(`${BASE}/v1/me`,{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error('DJ 정보를 확인할 수 없습니다. me.read 권한을 확인하세요.');const {userId}=await res.json();if(!userId)throw Error('DJ ID가 없습니다.');this.store.create(userId,`DJ ${userId.slice(0,6)}`);this.stop(userId);this.saveToken(userId,token);this.start(userId);return userId;}
  async send(room,message){
    if(!message)return;
    const now=Date.now(),r=this.store.load(room);if(!r?.live)return;
    if(now-(this.sendTimes.get(room)||0)<r.settings.responseGap*1000){this.store.log(room,'system','chat-suppressed',{reason:'response-gap'});return;}
    this.sendTimes.set(room,now);
    // A single concise message; never flood a room to paginate a long result.
    const clipped=message.length>200?message.slice(0,196)+'…':message;
    const res=await fetch(`${BASE}/v1/live/chat`,{method:'POST',headers:{Authorization:`Bearer ${await this.access(room)}`,'Content-Type':'application/json'},body:JSON.stringify({message:clipped}),signal:AbortSignal.timeout(10000)});
    if(!res.ok)this.store.log(room,'system','chat-send-failed',{status:res.status});
  }
  stop(room){this.running.get(room)?.abort();this.running.delete(room);this.setLive(room,false);this.status.set(room,'연결 중지');}
  start(room){if(this.running.has(room)||!this.configured())return;const controller=new AbortController();this.running.set(room,controller);void this.loop(room,controller).catch(()=>{});}
  async loop(room,controller){let backoff=5000;const signal=controller.signal;
    try{while(!signal.aborted){
      try{
        this.status.set(room,'방송 대기 / 연결 중');
        const token=await this.access(room);
        const res=await fetch(`${BASE}/v1/live/events`,{headers:{Authorization:`Bearer ${token}`,Accept:'text/event-stream'},signal:AbortSignal.any([signal,AbortSignal.timeout(65*60*1000)])});
        if(res.status===404){this.setLive(room,false);this.status.set(room,'방송 시작 대기');}
        else if(res.status===401||res.status===403){this.setLive(room,false);this.status.set(room,`재연결 또는 권한 확인 필요 (${res.status})`);return;}
        else if(!res.ok)throw Error(`API ${res.status}`);
        else {
          this.setLive(room,true);this.status.set(room,'방송 연결됨');backoff=5000;
          for await(const f of frames(res.body)){
            if(signal.aborted)return;
            if(f.event==='end'){
              if(f.data.reason==='DUPLICATE_CONNECTION'){this.status.set(room,'다른 서버가 연결됨 — 재연결 중지');return;}
              if(f.data.reason==='LIVE_ENDED')for(const k of this.greeted)if(k.startsWith(room+':'))this.greeted.delete(k);
              break;
            }
            if(f.event==='chat'){
              const {data}=f;const cfg=this.store.load(room).settings;
              const banned=cfg.bannedWords.some(w=>String(data.message).includes(w));
              if(banned)this.store.log(room,data.user.id,'banned-word',{message:data.message});
              if(!banned){const out=this.engine.handle(room,{...data,id:f.id||`${data.sentTime}:${data.user.id}:${data.message}`});if(out.text)await this.send(room,out.text);}
            }else if(f.event==='presence'){
              const key=`${room}:${f.data.user.id}`;if(!this.greeted.has(key)){this.greeted.add(key);const s=this.store.load(room).settings;if(s.welcome)await this.send(room,s.welcome.replaceAll('{name}',f.data.user.nickname||'청취자'));}
            }else if(f.event==='donation'){
              const s=this.store.load(room).settings;if(s.donation)await this.send(room,s.donation.replaceAll('{name}',f.data.user.nickname||'청취자').replaceAll('{amount}',String(f.data.amount)));
            }
          }
          this.setLive(room,false);
        }
      }catch(e){if(signal.aborted)return;this.setLive(room,false);this.status.set(room,'연결 재시도 중');this.store.log(room,'system','connection-error',{message:e.message});}
      await new Promise(resolve=>{const timer=setTimeout(done,backoff);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});});backoff=Math.min(60000,backoff*1.5);
    }}finally{if(this.running.get(room)===controller){this.setLive(room,false);this.running.delete(room);}}
  }
  setLive(room,live){this.store.transaction(room,r=>{r.live=live;});}
  async tick(){
    for(const id of this.store.ids()){
      let notice=null;
      this.store.transaction(id,r=>{
        this.engine.reset(r);
        if(!r.live||r.settings.quiet||Date.now()-r.lastResponse<r.settings.responseGap*1000)return;
        for(const a of r.settings.announcements){
          const key=`${id}:${a.id}`,last=this.timers.get(key);
          if(last===undefined){this.timers.set(key,Date.now());continue;}
          if(a.enabled&&Date.now()-last>=a.minutes*60000){notice=a.text;this.timers.set(key,Date.now());r.lastResponse=Date.now();break;}
        }
      });
      if(notice)await this.send(id,notice);
    }
  }
}
