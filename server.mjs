import {VoiceInbox} from './voice.mjs';
import {keepName} from './public/song-utils.mjs';
import { createServer } from 'node:http';
import { randomBytes,randomUUID,createHash,timingSafeEqual } from 'node:crypto';
import { mkdirSync,readFileSync,existsSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname,join } from 'node:path';
import { Store,Engine,defaults,validateSettings,dates,LIMIT } from './core.mjs';
import { Spoon } from './spoon.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
const env={...process.env};env.PUBLIC_URL=(env.PUBLIC_URL||'http://localhost:4310').replace(/\/$/,'');
const production=env.NODE_ENV==='production';
if(production&&(!env.PUBLIC_URL.startsWith('https://')||!/^[a-fA-F0-9]{64}$/.test(env.TOKEN_KEY||'')))throw Error('운영 환경에는 PUBLIC_URL HTTPS와 TOKEN_KEY가 필요합니다.');
const DATA=env.DATA_DIR||join(ROOT,'data');
mkdirSync(DATA,{recursive:true});
if(!env.TOKEN_KEY){const p=join(DATA,'local-key');if(!existsSync(p))writeFileSync(p,randomBytes(32).toString('hex'),{mode:0o600});env.TOKEN_KEY=readFileSync(p,'utf8').trim();}
const store=new Store(join(DATA,'studio.sqlite')),engine=new Engine(store),spoon=new Spoon(store,engine,env);
const voice=new VoiceInbox(store.db,join(DATA,'voice'));
const demoId='demo';if(!production)store.create(demoId,'나의 첫 라디오');
const sessions=new Map(),oauth=new Map(),attempts=new Map();
const digest=x=>createHash('sha256').update(x).digest('hex');
function sessionKey(req){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('studio='))?.slice(7);return digest(cookie||'');}
function session(req){const s=sessions.get(sessionKey(req));return s&&s.expires>Date.now()?s:null;}
function newSession(res,room){const value=randomBytes(32).toString('hex'),s={room,csrf:randomBytes(24).toString('hex'),expires:Date.now()+12*3600000};sessions.set(digest(value),s);res.setHeader('Set-Cookie',`studio=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${production?'; Secure':''}`);return s;}
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let b='';for await(const c of req){b+=c;if(Buffer.byteLength(b)>256000)throw Error('요청이 너무 큽니다.');}return b?JSON.parse(b):{};}
function requireSession(req){const s=session(req);if(!s)throw Object.assign(Error('로그인이 필요합니다.'),{status:401});if(req.method!=='GET'){
  const origin=req.headers.origin;if(origin&&origin!==env.PUBLIC_URL)throw Object.assign(Error('허용되지 않은 출처입니다.'),{status:403});
  const a=Buffer.from(req.headers['x-csrf-token']||''),b=Buffer.from(s.csrf);if(a.length!==b.length||!timingSafeEqual(a,b))throw Object.assign(Error('새로고침 후 다시 시도해주세요.'),{status:403});
}return s;}
function checkSettingsRevision(room,expected){
  if(!Number.isSafeInteger(expected)||expected!==(room.settingsRevision||0))throw Object.assign(Error('다른 탭이나 채팅에서 설정이 변경되었습니다. 입력 내용을 확인하고 새로고침한 뒤 다시 수정해 주세요.'),{status:409});
}
function safeRoom(room){const r=store.load(room);return {...r,connection:room===demoId?'테스트 모드 · 실제 방송 미연결':spoon.status.get(room)||'미연결',logs:store.logs(room),backups:store.db.prepare('SELECT id,time FROM backups WHERE room=? ORDER BY time DESC LIMIT 20').all(room)};}
const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
    const url=new URL(req.url,env.PUBLIC_URL),path=url.pathname;
    const voicePublic=/^\/api\/voice-public\/([a-f0-9]{64})$/.exec(path);
    if(voicePublic){
      res.setHeader('Referrer-Policy','no-referrer');
      if(req.method==='GET'){const roomId=voice.resolve(voicePublic[1]);reply(res,200,{name:store.load(roomId).name,maxBytes:8388608});return;}
      if(req.method==='POST'){
        if(req.headers.origin&&req.headers.origin!==env.PUBLIC_URL)throw Object.assign(Error('허용되지 않은 출처입니다.'),{status:403});
        reply(res,201,await voice.upload(req,voicePublic[1]));return;
      }throw Object.assign(Error('지원하지 않는 요청입니다.'),{status:405});
    }
    if(/^\/voice\/[a-f0-9]{64}$/.test(path)&&req.method==='GET'){
      res.setHeader('Referrer-Policy','no-referrer');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(readFileSync(join(ROOT,'public','voice.html')));return;
    }
    if(path==='/health'){reply(res,200,{ok:true});return;}
    if(path==='/api/session'&&req.method==='GET'){const s=session(req);reply(res,200,{loggedIn:!!s,room:s?.room,csrf:s?.csrf,demo:!production,configured:spoon.configured(),defaults:defaults()});return;}
    if(path==='/api/demo'&&req.method==='POST'&&!production){
      if(req.headers.origin&&req.headers.origin!==env.PUBLIC_URL)throw Error('허용되지 않은 출처입니다.');
      const remote=req.socket.remoteAddress||'';if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))throw Error('테스트 모드는 이 PC에서만 가능합니다.');
      const s=newSession(res,demoId);reply(res,200,{csrf:s.csrf});return;
    }
    if(path==='/oauth/start'&&req.method==='GET'){
      if(!spoon.configured())throw Error('서버의 SPOON_CLIENT_ID와 SPOON_CLIENT_SECRET을 설정해주세요.');
      const state=randomBytes(32).toString('hex');oauth.set(digest(state),Date.now()+10*60000);res.setHeader('Set-Cookie',`oauth=${state}; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=600${production?'; Secure':''}`);
      const q=new URLSearchParams({response_type:'code',client_id:env.SPOON_CLIENT_ID,redirect_uri:`${env.PUBLIC_URL}/oauth/callback`,scope:'me.read events.chat chat.send events.presence events.like events.donation',state});res.writeHead(302,{Location:`https://developers.spooncast.net/kr/oauth/authorize?${q}`});res.end();return;
    }
    if(path==='/oauth/callback'&&req.method==='GET'){
      const state=url.searchParams.get('state')||'',cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('oauth='))?.slice(6);
      if(!state||state!==cookie||(oauth.get(digest(state))||0)<Date.now())throw Error('로그인 요청이 만료되었습니다. 다시 연결해주세요.');oauth.delete(digest(state));
      const code=url.searchParams.get('code');if(!code)throw Error('스푼 연결이 취소되었습니다.');
      const room=await spoon.connect(code);newSession(res,room);res.writeHead(302,{Location:'/'});res.end();return;
    }
    if(path.startsWith('/api/')){
      const s=requireSession(req),roomId=s.room;
      if(req.method==='GET'&&path==='/api/room'){store.transaction(roomId,r=>engine.reset(r));reply(res,200,safeRoom(roomId));return;}
      if(req.method==='GET'&&path==='/api/voice-inbox'){
        const link=voice.link(roomId);reply(res,200,{enabled:link.enabled,url:link.token?`${env.PUBLIC_URL}/voice/${link.token}`:null,cards:voice.list(roomId)});return;
      }
      const voiceFile=/^\/api\/voice-file\/([a-f0-9-]{36})$/.exec(path);
      if(voiceFile&&req.method==='GET'){
        const {row,data}=voice.file(roomId,voiceFile[1]);res.writeHead(200,{'Content-Type':row.mime,'Content-Length':data.length,'Cache-Control':'no-store','Content-Disposition':'inline'});res.end(data);return;
      }
      if(req.method!=='POST')throw Object.assign(Error('지원하지 않는 요청입니다.'),{status:404});
      const key=digest(req.headers.cookie||'');const a=attempts.get(key)||{time:Date.now(),count:0};if(Date.now()-a.time>60000){a.time=Date.now();a.count=0;}if(++a.count>180)throw Object.assign(Error('요청이 너무 많습니다.'),{status:429});attempts.set(key,a);
      const b=await body(req);
      if(path==='/api/voice-link'){store.transaction(roomId,r=>{const link=voice.setLink(roomId,b.action);r.voiceInboxUrl=link.enabled?`${env.PUBLIC_URL}/voice/${link.token}`:null;store.log(roomId,'dj','voice-link',{action:b.action});});reply(res,200,{ok:true});return;}
      if(path==='/api/voice-action'){voice.action(roomId,b.id,b.action);store.log(roomId,'dj','voice-action',{id:b.id,action:b.action});reply(res,200,{ok:true});return;}
      if(path==='/api/logout'){sessions.delete(sessionKey(req));res.setHeader('Set-Cookie','studio=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');reply(res,200,{ok:true});return;}
      if(path==='/api/settings'){
        const settings=validateSettings(b.settings);store.transaction(roomId,r=>{checkSettingsRevision(r,b.expectedRevision);store.backup(roomId);const old=r.settings;r.settings=settings;r.settingsRevision=(r.settingsRevision||0)+1;if(JSON.stringify([old.autoChatEnabled,old.autoChatMode,old.autoChatMinutes,old.autoChatMessages])!==JSON.stringify([settings.autoChatEnabled,settings.autoChatMode,settings.autoChatMinutes,settings.autoChatMessages]))delete r.autoChat;if(b.name)r.name=String(b.name).slice(0,50);store.log(roomId,'dj','settings-update',{});});reply(res,200,{ok:true});return;
      }
      if(path==='/api/test-like'){
        if(production||roomId!==demoId)throw Error('로컬 테스트 모드에서만 사용할 수 있습니다.');
        const result=engine.likeGreeting(roomId,{id:randomUUID(),user:{id:String(b.user||'listener-1').slice(0,100),nickname:String(b.name||'청취자').slice(0,40)},type:'FREE',combo:null,totalAmount:1});reply(res,200,result);return;
      }
      if(path==='/api/test'){
        if(production||roomId!==demoId)throw Error('실제 방송에서는 테스트 명령을 실행할 수 없습니다.');
        const result=await engine.handleAsync(roomId,{id:randomUUID(),user:{id:String(b.user||'listener-1').slice(0,100),nickname:String(b.name||'청취자').slice(0,40)},message:String(b.message||'').slice(0,500),isDj:b.dj===true});reply(res,200,result);return;
      }
      if(path==='/api/song'){
        store.transaction(roomId,r=>{
          if(b.action==='start'){
            if(!r.current){if(!r.songs.length)throw Error('대기 중인 신청곡이 없습니다.');r.current=r.songs.shift();}
          }else if(b.action==='ended'){
            if(!r.current||typeof b.expectedCurrentId!=='string'||r.current.id!==b.expectedCurrentId)throw Object.assign(Error('현재곡이 이미 변경되었습니다. 새로고침 후 확인하세요.'),{status:409});
            if(typeof b.advance!=='boolean')throw Error('자동 전환 여부를 확인하세요.');
            r.previous=r.current;r.current=b.advance?(r.songs.shift()||null):null;
          }else if(b.action==='next'){
            if(!r.songs.length)throw Error('대기 중인 신청곡이 없습니다.');if(r.current)r.previous=r.current;r.current=r.songs.shift();
          }else if(b.action==='remove'){
            if(!r.songs.some(x=>x.id===b.id))throw Error('신청곡을 찾을 수 없습니다.');r.songs=r.songs.filter(x=>x.id!==b.id);
          }else if(b.action==='finish'){
            if(!r.current)throw Error('현재 재생 중인 곡이 없습니다.');r.previous=r.current;r.current=null;
          }else throw Error('잘못된 동작입니다.');
          store.log(roomId,'dj','song-action',b);
        });reply(res,200,{ok:true,room:safeRoom(roomId)});return;
      }
      if(path==='/api/grant'){
        if(!Number.isSafeInteger(b.amount)||(b.amount===0&&b.kind!=='tickets')||Math.abs(b.amount)>100000000||!['pt','tickets'].includes(b.kind)||typeof b.reason!=='string'||!b.reason.trim())throw Error('지급 종류·금액·사유를 확인하세요.');
        store.transaction(roomId,r=>{engine.reset(r);const u=r.users[b.user];if(!u)throw Error('청취자를 찾을 수 없습니다.');if(u[b.kind]+b.amount<0)throw Error('보유량보다 많이 회수할 수 없습니다.');u[b.kind]+=b.amount;store.log(roomId,u.id,'manual-adjust',{kind:b.kind,amount:b.amount,reason:b.reason});});reply(res,200,{ok:true});return;
      }
      if(path==='/api/keep'){
        store.transaction(roomId,r=>{
          engine.reset(r);const u=r.users[b.user];if(!u)throw Error('청취자를 찾을 수 없습니다.');
          if(b.action==='add'){
            if(typeof b.text!=='string'||!b.text.trim()||b.text.length>100)throw Error('킵 이름을 입력하세요.');u.keeps.push(keepName(b.text));
          }else if(b.action==='use'||b.action==='remove'){
            let index=b.index;
            if(b.action==='use'){
              if(typeof b.text!=='string'||!b.text.trim()||!Number.isSafeInteger(b.expectedCount))throw Error('사용할 킵을 확인하세요.');
              const name=keepName(b.text),count=u.keeps.filter(k=>keepName(k)===name).length;
              if(!count||count!==b.expectedCount)throw Object.assign(Error('킵 수량이 변경되었습니다. 새로고침 후 확인하세요.'),{status:409});
              index=u.keeps.findIndex(k=>keepName(k)===name);
            }
            if(!Number.isInteger(index)||index<0||index>=u.keeps.length)throw Error('킵 번호를 확인하세요.');
            const [text]=u.keeps.splice(index,1);u.keepHistory??=[];u.keepHistory.push({id:randomUUID(),text:keepName(text),kind:'used',time:Date.now(),actor:'dj'});
          }else throw Error('잘못된 동작입니다.');
          store.log(roomId,u.id,'keep-update',b);
        });reply(res,200,{ok:true});return;
      }
      if(path==='/api/special'){
        store.transaction(roomId,r=>{
          engine.reset(r);const reward=r.special.find(x=>x.id===b.id);if(!reward||!['pending','policy-pending'].includes(reward.status))throw Error('이미 처리되었거나 없는 보상입니다.');
          // Never carry an unclaimed reward across a monthly points reset.
          if(reward.day.slice(0,7)!==dates().month)throw Error('지난달 보상은 지급할 수 없습니다.');
          if(b.action==='reject')reward.status='rejected';else {
            if(reward.day!==dates().day)throw Error('일일 한도 집계를 위해 당일 보상만 지급 가능합니다.');
            if(!Number.isSafeInteger(b.amount)||b.amount<1||b.amount>1000000)throw Error('보상 금액을 확인하세요.');
            const u=r.users[reward.user];reward.paid=engine.credit(r,u,b.amount,'legend-special');reward.status='paid';
          }
          store.log(roomId,reward.user,'special-claim',{id:reward.id,status:reward.status,paid:reward.paid});
        });reply(res,200,{ok:true});return;
      }
      if(path==='/api/backup'){reply(res,200,{id:store.backup(roomId)});return;}
      if(path==='/api/restore'){
        const backup=store.db.prepare('SELECT data FROM backups WHERE id=? AND room=?').get(b.id,roomId);if(!backup)throw Error('백업을 찾을 수 없습니다.');const settings=validateSettings(JSON.parse(backup.data));store.transaction(roomId,r=>{checkSettingsRevision(r,b.expectedRevision);store.backup(roomId);r.settings=settings;r.settingsRevision=(r.settingsRevision||0)+1;store.log(roomId,'dj','settings-restore',{id:b.id});});reply(res,200,{ok:true});return;
      }
      if(path==='/api/notice-draft'){const settings=b.settings?validateSettings(b.settings):store.load(roomId).settings;reply(res,200,{text:`🎵 ${settings.playlistTitle}입니다. ${settings.requests?'신청곡은 !신청곡 가수 - 제목으로 남겨주세요.':'지금은 신청곡을 받지 않아요.'} 하트로 함께해주세요 ♥`.slice(0,200)});return;}
      if(path==='/api/reconnect'){if(roomId!==demoId){spoon.stop(roomId);spoon.start(roomId);}reply(res,200,{ok:true});return;}
      throw Object.assign(Error('기능을 찾을 수 없습니다.'),{status:404});
    }
    const files={'/':'index.html','/app.js':'app.js','/studio-state.mjs':'studio-state.mjs','/style.css':'style.css','/workspace.css':'workspace.css','/song-utils.mjs':'song-utils.mjs','/playback.mjs':'playback.mjs','/youtube-player.mjs':'youtube-player.mjs','/voice.js':'voice.js','/extra-ui.mjs':'extra-ui.mjs','/studio.css':'studio.css','/studio-icons.mjs':'studio-icons.mjs'};if(req.method!=='GET'||!files[path]){reply(res,404,{error:'페이지를 찾을 수 없습니다.'});return;}
    res.writeHead(200,{'Content-Type':(/\.m?js$/).test(path)?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(readFileSync(join(ROOT,'public',files[path])));
  }catch(e){reply(res,e.status||400,{error:e.message});}
});
for(const id of store.ids())if(id!==demoId)spoon.start(id);
const timer=setInterval(()=>spoon.tick().catch(e=>console.error('scheduler:',e.message)),5000);
const cleanup=setInterval(()=>{const now=Date.now();for(const [k,s] of sessions)if(s.expires<now)sessions.delete(k);for(const [k,t]of oauth)if(t<now)oauth.delete(k);for(const [k,a]of attempts)if(now-a.time>60000)attempts.delete(k);},60000);
server.listen(Number(env.PORT||4310),env.HOST||'127.0.0.1',()=>console.log(`Spoon Studio: http://${env.HOST||'127.0.0.1'}:${server.address().port} (${production?'production':'local demo'})`));
function shutdown(){clearInterval(timer);clearInterval(cleanup);for(const id of spoon.running.keys())spoon.stop(id);server.close(()=>{store.db.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
