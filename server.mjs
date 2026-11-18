import {setAutomation} from './automation.mjs';
import {AIChat} from './ai-chat.mjs';
import {Lifestyle} from './lifestyle.mjs';
import {RoomChat} from './chat-room.mjs';
import {applySongAction} from './song-queue.mjs';
import {AndroidAuth} from './android-auth.mjs';
import {Sessions} from './sessions.mjs';
import {updateRequestedRules,RULES_VERSION} from './rules-update.mjs';
import {emailAlias,nicknameKey} from './targets.mjs';
import {YouTubeSearch} from './youtube-search.mjs';
import {savedSongVideo,rememberSongVideo} from './song-library.mjs';
import {youtubeId} from './public/song-utils.mjs';
import {PublicSandbox} from './sandbox.mjs';
import {readJSON,publicOrigin} from './http-utils.mjs';
import {fullBackup} from './backup.mjs';
import {renameSync,rmSync,readdirSync} from 'node:fs';
import {deleteRoom,deleteListener,expireVoice} from './privacy.mjs';
import {unlinkSync,openSync,closeSync} from 'node:fs';
import {VoiceInbox,audioRange} from './voice.mjs';
import {keepName} from './public/song-utils.mjs';
import { createServer } from 'node:http';
import { randomBytes,randomUUID,createHash,timingSafeEqual } from 'node:crypto';
import { mkdirSync,readFileSync,existsSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname,join } from 'node:path';
import { Store,Engine,defaults,validateSettings,dates,LIMIT } from './core.mjs';
import { Spoon,spoonRegion } from './spoon.mjs';
import {buildDiagnostics} from './diagnostics.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
const env={...process.env};env.PUBLIC_URL=(env.PUBLIC_URL||'http://localhost:4310').replace(/\/$/,'');
const production=env.NODE_ENV==='production';env.PUBLIC_URL=publicOrigin(env.PUBLIC_URL,{production});spoonRegion(env);
const trustProxy=env.TRUST_PROXY==='1'||env.TRUST_PROXY==='true';
function clientIp(req){if(trustProxy){const f=String(req.headers['x-forwarded-for']||'').split(',').pop().trim();if(f)return f;}return req.socket.remoteAddress||'';}
if(production&&(!env.PUBLIC_URL.startsWith('https://')||!/^[a-fA-F0-9]{64}$/.test(env.TOKEN_KEY||'')))throw Error('운영 환경에는 PUBLIC_URL HTTPS와 TOKEN_KEY가 필요합니다.');
const DATA=env.DATA_DIR||join(ROOT,'data');
mkdirSync(DATA,{recursive:true});
if(!env.TOKEN_KEY){const p=join(DATA,'local-key');if(!existsSync(p))writeFileSync(p,randomBytes(32).toString('hex'),{mode:0o600});env.TOKEN_KEY=readFileSync(p,'utf8').trim();}
const lockFile=join(DATA,'server.lock');
if(existsSync(lockFile)){
  const pid=Number(readFileSync(lockFile,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('서버 잠금 파일을 확인하세요.');
  let active=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')active=false;else throw e;}
  if(active)throw Error('같은 데이터 폴더를 사용하는 서버가 이미 실행 중입니다.');unlinkSync(lockFile);
}
const lockHandle=openSync(lockFile,'wx',0o600);writeFileSync(lockHandle,String(process.pid));closeSync(lockHandle);
process.on('exit',()=>{try{if(readFileSync(lockFile,'utf8')===String(process.pid))unlinkSync(lockFile);}catch{}});
const voiceRetention=Number(env.VOICE_RETENTION_DAYS||0);if(!Number.isSafeInteger(voiceRetention)||voiceRetention<0||voiceRetention>3650)throw Error('VOICE_RETENTION_DAYS는 0~3650 정수여야 합니다.');
const store=new Store(join(DATA,'studio.sqlite')),engine=new Engine(store,{region:spoonRegion(env),identityKey:env.TOKEN_KEY}),spoon=new Spoon(store,engine,env);
const voice=new VoiceInbox(store.db,join(DATA,'voice'));
const publicDemo=env.PUBLIC_DEMO==='1'||env.PUBLIC_DEMO==='true';
const sandbox=publicDemo?new PublicSandbox(join(DATA,'preview-voice'),{region:spoonRegion(env)}):null;
const ai=new AIChat({key:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-4.1-mini'});
const lifestyle=new Lifestyle({clientId:env.NAVER_CLIENT_ID,clientSecret:env.NAVER_CLIENT_SECRET,provider:env.NAVER_SEARCH_PROVIDER||'hub',weatherProxyURL:env.WEATHER_PROXY_URL||'',weatherProxyKey:env.WEATHER_PROXY_URL&&existsSync(join(ROOT,'deploy','gateway-router.key'))?readFileSync(join(ROOT,'deploy','gateway-router.key'),'utf8').trim():''});
lifestyle.ai=ai;engine.lifestyle=lifestyle;if(sandbox)sandbox.services.engine.lifestyle=lifestyle;
const chats=new WeakMap();function chatFor(store){if(!chats.has(store))chats.set(store,new RoomChat(store));return chats.get(store);}
const liveServices={store,engine,spoon,voice};
const youtubeSearch=new YouTubeSearch({key:env.YOUTUBE_API_KEY||''});engine.searchSong=title=>youtubeSearch.find(title);engine.publicUrl=env.PUBLIC_URL;if(sandbox){sandbox.services.engine.searchSong=engine.searchSong;sandbox.services.engine.publicUrl=env.PUBLIC_URL;}
const servicesFor=room=>sandbox?.has(room)?sandbox.services:liveServices;
const isDemo=room=>room==='demo'||!!sandbox?.has(room);
const demoId='demo';if(!production)store.create(demoId,'나의 첫 라디오');
const sessions=new Sessions(store.db,{key:env.TOKEN_KEY,volatile:isDemo}),oauth=new Map(),attempts=new Map();
const androidAuth=new AndroidAuth();
const digest=x=>createHash('sha256').update(x).digest('hex');
function sessionKey(req){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('studio='))?.slice(7);return digest(cookie||'');}
function session(req){const s=sessions.get(sessionKey(req));return s&&s.expires>Date.now()&&servicesFor(s.room).store.load(s.room)?s:null;}
function newSession(res,room,lifetime=12*3600000){const value=randomBytes(32).toString('hex'),s={room,csrf:randomBytes(24).toString('hex'),expires:Date.now()+lifetime};sessions.set(digest(value),s);res.setHeader('Set-Cookie',`studio=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(lifetime/1000)}${production?'; Secure':''}`);return s;}
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const body=readJSON;
function requireSession(req){const s=session(req);if(!s)throw Object.assign(Error('로그인이 필요합니다.'),{status:401});if(req.method!=='GET'){
  const origin=req.headers.origin;if(origin&&origin!==env.PUBLIC_URL)throw Object.assign(Error('허용되지 않은 출처입니다.'),{status:403});
  const a=Buffer.from(req.headers['x-csrf-token']||''),b=Buffer.from(s.csrf);if(a.length!==b.length||!timingSafeEqual(a,b))throw Object.assign(Error('새로고침 후 다시 시도해주세요.'),{status:403});
}return s;}
function checkSettingsRevision(room,expected){
  if(!Number.isSafeInteger(expected)||expected!==(room.settingsRevision||0))throw Object.assign(Error('다른 탭이나 채팅에서 설정이 변경되었습니다. 입력 내용을 확인하고 새로고침한 뒤 다시 수정해 주세요.'),{status:409});
}
function automationRuntime(){try{const data=JSON.parse(readFileSync(join(ROOT,'deploy','automation-status.json'),'utf8'));return {enabled:data.enabled===true,localHealthy:data.localHealthy===true,tunnelHealthy:data.tunnelHealthy===true,gatewayHealthy:data.gatewayHealthy===true,checkedAt:Number(data.checkedAt)||0,lastError:data.lastError?'복구 또는 연결 확인 중':null};}catch{return {enabled:false};}}
function safeRoom(room){const {store,spoon}=servicesFor(room);const r=store.load(room);return {...r,systemAutomation:isDemo(room)?{enabled:false}:automationRuntime(),id:isDemo(room)?'demo':r.id,connection:isDemo(room)?'테스트 모드 · 실제 방송 미연결':spoon.status.get(room)||'미연결',logs:store.logs(room),outbox:spoon.outbox.list(room),backups:store.db.prepare('SELECT id,time FROM backups WHERE room=? ORDER BY time DESC LIMIT 20').all(room)};}
const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
    req.clientIp=clientIp(req);
    const url=new URL(req.url,env.PUBLIC_URL),path=url.pathname;
    const publicChat=/^\/api\/chat-public\/([A-Za-z0-9_-]{43})$/.exec(path);
    if(publicChat){
      res.setHeader('Referrer-Policy','no-referrer');const chat=chatFor(store),roomId=chat.resolve(publicChat[1]);
      if(req.method==='GET'){reply(res,200,chat.publicList(roomId));return;}
      if(req.method==='POST'){
        if(req.headers.origin!==env.PUBLIC_URL)throw Object.assign(Error('허용되지 않은 출처입니다.'),{status:403});
        const b=await body(req);reply(res,200,chat.send(roomId,b,req.clientIp));return;
      }throw Object.assign(Error('지원하지 않는 요청입니다.'),{status:405});
    }
    if(/^\/chat\/[A-Za-z0-9_-]{43}$/.test(path)&&req.method==='GET'){
      res.setHeader('Referrer-Policy','no-referrer');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(readFileSync(join(ROOT,'public','chat.html')));return;
    }
    const voicePublic=/^\/api\/voice-public\/([a-f0-9]{64}|[A-Za-z0-9_-]{43})$/.exec(path);
    if(voicePublic){
      res.setHeader('Referrer-Policy','no-referrer');
      if(req.method==='GET'){const roomId=voice.resolve(voicePublic[1]);reply(res,200,{name:store.load(roomId).name,maxBytes:8388608});return;}
      if(req.method==='POST'){
        if(req.headers.origin&&req.headers.origin!==env.PUBLIC_URL)throw Object.assign(Error('허용되지 않은 출처입니다.'),{status:403});
        reply(res,201,await voice.upload(req,voicePublic[1]));return;
      }throw Object.assign(Error('지원하지 않는 요청입니다.'),{status:405});
    }
    if((/^\/voice\/[a-f0-9]{64}$/.test(path)||/^\/v\/[A-Za-z0-9_-]{43}$/.test(path))&&req.method==='GET'){
      res.setHeader('Referrer-Policy','no-referrer');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(readFileSync(join(ROOT,'public','voice.html')));return;
    }
    if(path==='/privacy'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(readFileSync(join(ROOT,'public','privacy.html'),'utf8').replaceAll('{{VOICE_DAYS}}',voiceRetention?String(voiceRetention)+'일':'DJ가 삭제할 때까지'));return;}
    if(path==='/health'){reply(res,200,{ok:true});return;}
    if(path==='/android'&&req.method==='GET'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(readFileSync(join(ROOT,'public','android.html')));return;
    }
    if(path==='/android/RadioMate.apk'&&(req.method==='GET'||req.method==='HEAD')){
      const apk=join(ROOT,'output','android','RadioMate-1.0.0.apk');
      if(!existsSync(apk)){reply(res,404,{error:'앱 배포 파일이 준비되지 않았습니다. 운영자에게 문의해주세요.'});return;}
      const data=readFileSync(apk);res.writeHead(200,{'Content-Type':'application/vnd.android.package-archive','Content-Disposition':'attachment; filename="RadioMate-1.0.0.apk"','Content-Length':data.length,'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);return;
    }
    if(path==='/api/android/exchange'&&req.method==='POST'){
      if(req.headers.origin&&req.headers.origin!==env.PUBLIC_URL)throw Object.assign(Error('허용되지 않은 출처입니다.'),{status:403});
      const key='android:'+req.clientIp,now=Date.now(),rate=attempts.get(key)||{time:now,count:0};
      if(now-rate.time>60000){rate.time=now;rate.count=0;}if(++rate.count>20)throw Object.assign(Error('연결 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.'),{status:429});
      if(attempts.size>2000&&!attempts.has(key))throw Object.assign(Error('잠시 후 다시 시도해주세요.'),{status:429});attempts.set(key,rate);
      const b=await body(req),room=androidAuth.redeem(b.code,b.verifier);newSession(res,room);reply(res,200,{ok:true});return;
    }
    const listenerFiles={'/listener/':'panel.html','/listener/panel.css':'panel.css','/listener/panel.mjs':'panel.mjs','/listener/speech.mjs':'speech.mjs','/listener/shared.mjs':'shared.mjs','/listener/icon.png':'icon.png','/listener/guide.html':'guide.html'};
    if(req.method==='GET'&&Object.hasOwn(listenerFiles,path)){
      const name=listenerFiles[path];res.writeHead(200,{'Content-Type':name.endsWith('.mjs')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.png')?'image/png':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(readFileSync(join(ROOT,'extensions','listener-voice',name)));return;
    }
    if(path==='/api/session'&&req.method==='GET'){const s=session(req);reply(res,200,{loggedIn:!!s,room:s?.room,csrf:s?.csrf,demo:!production||publicDemo,testing:isDemo(s?.room),publicDemo,chargeRegion:spoonRegion(env),configured:spoon.configured(),youtubeSearchConfigured:!!env.YOUTUBE_API_KEY,defaults:defaults()});return;}
    if(path==='/api/demo'&&req.method==='POST'&&(!production||publicDemo)){
      if(req.headers.origin&&req.headers.origin!==env.PUBLIC_URL)throw Error('허용되지 않은 출처입니다.');
      if(publicDemo){
        const current=session(req);if(current&&sandbox.has(current.room)){reply(res,200,{csrf:current.csrf});return;}
        const key='preview:'+req.clientIp,now=Date.now(),rate=attempts.get(key)||{time:now,count:0};if(now-rate.time>60000){rate.time=now;rate.count=0;}if(++rate.count>5||attempts.size>2000)throw Object.assign(Error('테스트 화면을 너무 자주 열었습니다. 잠시 후 다시 시도해주세요.'),{status:429});attempts.set(key,rate);
        const room=sandbox.create(),s=newSession(res,room,3600000);reply(res,200,{csrf:s.csrf});return;
      }
      const remote=req.socket.remoteAddress||'';if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))throw Error('테스트 모드는 이 PC에서만 가능합니다.');
      const s=newSession(res,demoId);reply(res,200,{csrf:s.csrf});return;
    }
    if(path==='/oauth/start'&&req.method==='GET'){
      if(!spoon.configured())throw Error('서버의 SPOON_CLIENT_ID와 SPOON_CLIENT_SECRET을 설정해주세요.');
      const appChallenge=url.searchParams.get('app_challenge')||'';
      if(appChallenge&&!AndroidAuth.validChallenge(appChallenge))throw Error('올바르지 않은 앱 연결 요청입니다.');
      if(oauth.size>=2000)throw Object.assign(Error('연결 요청이 많습니다. 잠시 후 다시 시도해주세요.'),{status:429});
      const state=randomBytes(32).toString('hex');oauth.set(digest(state),{expires:Date.now()+10*60000,appChallenge});res.setHeader('Set-Cookie',`oauth=${state}; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=600${production?'; Secure':''}`);
      const q=new URLSearchParams({response_type:'code',client_id:env.SPOON_CLIENT_ID,redirect_uri:`${env.PUBLIC_URL}/oauth/callback`,scope:'me.read listeners.read events.chat chat.send events.presence events.like events.donation',state});res.writeHead(302,{Location:`https://developers.spooncast.net/${spoonRegion(env)}/oauth/authorize?${q}`});res.end();return;
    }
    if(path==='/oauth/callback'&&req.method==='GET'){
      const state=url.searchParams.get('state')||'',cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('oauth='))?.slice(6);
      const pending=oauth.get(digest(state));
      if(!state||state!==cookie||!pending||pending.expires<Date.now())throw Error('로그인 요청이 만료되었습니다. 다시 연결해주세요.');oauth.delete(digest(state));
      const code=url.searchParams.get('code');if(!code)throw Error('스푼 연결이 취소되었습니다.');
      const room=await spoon.connect(code);
      if(pending.appChallenge){
        const appCode=androidAuth.issue(room,pending.appChallenge);
        res.setHeader('Referrer-Policy','no-referrer');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
        res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>라디오메이트 앱 연결</title><body style="font-family:sans-serif;background:#fff4fa;padding:40px;text-align:center"><h1>DJ 계정 연결 완료</h1><p>2분 안에 아래 버튼으로 앱에 돌아가세요.</p><p><a style="display:inline-block;padding:20px;background:#a94778;color:white;border-radius:18px" href="radiomate://auth?code=${appCode}">라디오메이트 앱으로 돌아가기</a></p><p>앱이 열리지 않으면 설치 여부를 확인하고 앱에서 다시 연결해주세요.</p></body></html>`);return;
      }
      newSession(res,room);res.writeHead(302,{Location:'/'});res.end();return;
    }
    if(path.startsWith('/api/')){
      const s=requireSession(req),roomId=s.room;
      const {store,engine,spoon,voice}=servicesFor(roomId);
      if(req.method==='GET'&&path==='/api/ai'){
        const context={store,room:roomId,user:'dj',channel:'app'};reply(res,200,{configured:ai.configured&&!sandbox?.has(roomId),model:ai.model,history:ai.history(context),dailyLimit:ai.dailyLimit,used:store.load(roomId).aiUsage?.day===dates().day?store.load(roomId).aiUsage.count:0});return;
      }
      if(req.method==='GET'&&path==='/api/chat'){
        const chat=chatFor(store),state=chat.state(store.load(roomId));reply(res,200,{...chat.publicList(roomId),url:state.enabled?env.PUBLIC_URL+'/chat/'+state.token:'',preview:isDemo(roomId)});return;
      }
      if(req.method==='GET'&&path==='/api/diagnostics'){
        reply(res,200,buildDiagnostics({demo:isDemo(roomId),configured:spoon.configured(),hasToken:!!store.db.prepare('SELECT 1 FROM tokens WHERE room=?').get(roomId),room:store.load(roomId),backups:store.db.prepare('SELECT COUNT(*) AS n FROM backups WHERE room=?').get(roomId).n,logs:store.logs(roomId),publicUrl:env.PUBLIC_URL,voiceEnabled:voice.link(roomId).enabled,youtubeConfigured:!!env.YOUTUBE_API_KEY}));return;
      }
      if(req.method==='GET'&&path==='/api/export'){
        const data={version:1,exportedAt:Date.now(),room:store.load(roomId),logs:store.logs(roomId),voice:voice.list(roomId).map(card=>({...card,data:voice.file(roomId,card.id).data.toString('base64')}))};
        delete data.room.voiceInboxUrl;if(data.room.chat)delete data.room.chat.token;
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Disposition':'attachment; filename="radiomate-room.json"'});res.end(JSON.stringify(data));return;
      }
      if(req.method==='GET'&&path==='/api/room'){store.transaction(roomId,r=>engine.reset(r));reply(res,200,safeRoom(roomId));return;}
      if(req.method==='GET'&&path==='/api/voice-inbox'){
        const link=voice.link(roomId);reply(res,200,{preview:!!sandbox?.has(roomId),enabled:link.enabled,url:voice.url(roomId,env.PUBLIC_URL),cards:voice.list(roomId)});return;
      }
      const voiceFile=/^\/api\/voice-file\/([a-f0-9-]{36})$/.exec(path);
      if(voiceFile&&req.method==='GET'){
        const {row,data}=voice.file(roomId,voiceFile[1]),range=audioRange(req.headers.range,data.length);
        if(!range){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});res.end();return;}
        const {start,end}=range,partial=!!req.headers.range;
        res.writeHead(partial?206:200,{'Content-Type':row.mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(partial?{'Content-Range':`bytes ${start}-${end}/${data.length}`} : {}),'Cache-Control':'no-store','Content-Disposition':'inline'});res.end(data.subarray(start,end+1));return;
      }
      if(req.method!=='POST')throw Object.assign(Error('지원하지 않는 요청입니다.'),{status:404});
      const key=digest(req.headers.cookie||'');const a=attempts.get(key)||{time:Date.now(),count:0};if(Date.now()-a.time>60000){a.time=Date.now();a.count=0;}if(++a.count>(sandbox?.has(roomId)?60:180))throw Object.assign(Error('요청이 너무 많습니다.'),{status:429});attempts.set(key,a);
      const b=await body(req);
      if(path==='/api/automation'){store.transaction(roomId,r=>{checkSettingsRevision(r,b.expectedRevision);store.backup(roomId);setAutomation(r,b.enabled);store.log(roomId,'dj','automation-settings',{enabled:b.enabled});});reply(res,200,{ok:true});return;}
      if(path==='/api/ai-reset'){ai.reset({room:roomId,user:'dj',channel:'app'});reply(res,200,{ok:true});return;}
      if(path==='/api/ai-talk'){reply(res,200,{text:await ai.answer(b.text,{store,room:roomId,user:'dj',channel:'app'})});return;}
      if(path==='/api/lifestyle'){
        const kind=b.kind;if(kind==='weather'){reply(res,200,await lifestyle.weather({period:b.period||'current'}));return;}
        if(kind==='places'){reply(res,200,await lifestyle.places({...b,kind:b.kindPlace}));return;}
        if(kind==='talk'){const {assistantRequest}=await import('./lifestyle.mjs');reply(res,200,{text:await lifestyle.answer(assistantRequest('!채팅 '+String(b.text||'').slice(0,200)))});return;}
        throw Error('지원하지 않는 검색입니다.');
      }
      if(path==='/api/chat-send'){reply(res,200,chatFor(store).send(roomId,{...b,name:'DJ'},'dj'));return;}
      if(path==='/api/chat-link'){if(isDemo(roomId))throw Error('테스트에서는 외부 채팅 링크를 만들지 않습니다.');chatFor(store).link(roomId,b.action);reply(res,200,{ok:true});return;}
      if(path==='/api/chat-delete'){chatFor(store).remove(roomId,b.id);reply(res,200,{ok:true});return;}
      if(path==='/api/voice-link'){if(sandbox?.has(roomId))throw Error('공개 테스트에서는 실제 음성을 접수하지 않습니다. DJ 연결 후 사용하세요.');store.transaction(roomId,r=>{voice.setLink(roomId,b.action);r.voiceInboxUrl=voice.url(roomId,env.PUBLIC_URL);store.log(roomId,'dj','voice-link',{action:b.action});});reply(res,200,{ok:true});return;}
      if(path==='/api/voice-action'){voice.action(roomId,b.id,b.action);store.log(roomId,'dj','voice-action',{id:b.id,action:b.action});reply(res,200,{ok:true});return;}
      if(path==='/api/outbox-retry'){if(b.confirm!=='중복 가능성 확인')throw Error('재전송 전 확인이 필요합니다.');spoon.outbox.retry(roomId,b.id);reply(res,200,{ok:true});return;}
      if(path==='/api/outbox-cancel'){spoon.outbox.cancel(roomId,b.id);reply(res,200,{ok:true});return;}
      if(path==='/api/disconnect'){const result=await spoon.disconnect(roomId);reply(res,200,{ok:true,...result});return;}
      if(path==='/api/listener-delete'){
        if(b.confirm!=='청취자 삭제')throw Error('삭제 확인 문구가 일치하지 않습니다.');
        deleteListener(store,roomId,b.user);reply(res,200,{ok:true});return;
      }
      if(path==='/api/account-delete'){
        if(b.confirm!=='방송 데이터 영구 삭제')throw Error('삭제 확인 문구가 일치하지 않습니다.');
        if(isDemo(roomId))throw Error('테스트 방송은 계정 삭제 대상이 아닙니다.');
        const result=await spoon.disconnect(roomId);deleteRoom(store,voice,roomId);
        for(const [key,value] of sessions)if(value.room===roomId)sessions.delete(key);
        res.setHeader('Set-Cookie','studio=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');reply(res,200,{ok:true,...result});return;
      }
      if(path==='/api/logout'){sessions.delete(sessionKey(req));if(sandbox?.has(roomId))sandbox.remove(roomId);res.setHeader('Set-Cookie','studio=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');reply(res,200,{ok:true});return;}
      if(path==='/api/settings'){
        const settings=validateSettings(b.settings);store.transaction(roomId,r=>{checkSettingsRevision(r,b.expectedRevision);store.backup(roomId);const old=r.settings;engine.syncBuffs(r);r.settings=settings;engine.syncBuffs(r);r.settingsRevision=(r.settingsRevision||0)+1;if(JSON.stringify([old.autoChatEnabled,old.autoChatMode,old.autoChatMinutes,old.autoChatMessages])!==JSON.stringify([settings.autoChatEnabled,settings.autoChatMode,settings.autoChatMinutes,settings.autoChatMessages]))delete r.autoChat;if(b.name)r.name=String(b.name).slice(0,50);store.log(roomId,'dj','settings-update',{});});reply(res,200,{ok:true});return;
      }
      if(path==='/api/test-like'){
        if(!isDemo(roomId))throw Error('로컬 테스트 모드에서만 사용할 수 있습니다.');
        const result=engine.likeGreeting(roomId,{id:randomUUID(),user:{id:String(b.user||'listener-1').slice(0,100),nickname:String(b.name||'청취자').slice(0,40)},type:'FREE',combo:null,totalAmount:1});reply(res,200,result);return;
      }
      if(path==='/api/test'){
        if(!isDemo(roomId))throw Error('실제 방송에서는 테스트 명령을 실행할 수 없습니다.');
        if(sandbox?.has(roomId)&&!Object.hasOwn(store.load(roomId).users,String(b.user||'listener-1').slice(0,100))&&Object.keys(store.load(roomId).users).length>=100)throw Error('테스트 공간은 청취자 100명까지 만들 수 있습니다.');
        const result=await engine.handleAsync(roomId,{id:randomUUID(),user:{id:String(b.user||'listener-1').slice(0,100),nickname:String(b.name||'청취자').slice(0,40)},message:String(b.message||'').slice(0,500),isDj:b.dj===true});reply(res,200,result);return;
      }
      if(path==='/api/song-resolve'){
        const snapshot=store.load(roomId),song=[snapshot.current,...snapshot.songs].find(x=>x&&x.id===b.id);
        if(!song)throw Error('신청곡이 변경되었습니다. 새로고침해 주세요.');
        const videoId=b.url?youtubeId(b.url):savedSongVideo(snapshot,song.title)||await youtubeSearch.find(song.title);
        if(!videoId)throw Error('올바른 HTTPS YouTube 영상 링크를 입력하세요.');
        store.transaction(roomId,r=>{
          const target=[r.current,...r.songs].find(x=>x&&x.id===b.id);
          if(!target||target.videoId!==song.videoId)throw Error('신청곡이 이미 변경되었습니다. 다시 확인하세요.');
          if(!r.settings.duplicateSongs&&[r.current,...r.songs].some(x=>x&&x.id!==target.id&&x.videoId===videoId))throw Error('이미 대기열에 있는 영상입니다.');
          target.videoId=videoId;target.url=`https://www.youtube.com/watch?v=${videoId}`;
          rememberSongVideo(r,target,videoId);
          r.queueRevision=(r.queueRevision||0)+1;delete r.songUndo;
        });reply(res,200,{ok:true,room:safeRoom(roomId)});return;
      }
      if(path==='/api/song'){
        store.transaction(roomId,r=>{
          const current=r.current?.id;
          applySongAction(r,b);
          if(b.action==='purge'&&current&&!r.current)r.playbackControl={id:randomUUID(),action:'pause',time:Date.now()};
          store.log(roomId,'dj','song-action',b);
        });reply(res,200,{ok:true,room:safeRoom(roomId)});return;
      }
      if(path==='/api/identity-alias'){
        store.transaction(roomId,r=>{
          const user=r.users[b.user];if(!user)throw Error('청취자를 선택하세요.');
          if(b.action==='clear'){delete user.emailAlias;delete user.accountAlias;}
          else if(b.action==='set'){
            const alias=String(b.alias||'').trim().replace(/^@/u,''),email=String(b.email||'').trim();
            if(!alias&&!email)throw Error('연결할 계정 ID 또는 이메일을 입력하세요.');
            if(alias&&(!/^[\p{L}\p{N}_.-]{1,100}$/u.test(alias)||Object.values(r.users).some(other=>other.id!==user.id&&(other.id===alias||nicknameKey(other.name)===nicknameKey(alias)||other.accountAlias&&nicknameKey(other.accountAlias)===nicknameKey(alias)))))throw Error('계정 ID가 중복되었거나 형식이 올바르지 않습니다.');
            if(email){const hash=emailAlias(email,engine.identityKey,roomId);if(Object.values(r.users).some(other=>other.id!==user.id&&other.emailAlias===hash))throw Error('이미 다른 청취자에게 연결한 이메일입니다.');user.emailAlias=hash;}
            if(alias)user.accountAlias=alias;
          }else throw Error('연결 동작을 확인하세요.');
          store.log(roomId,'dj','identity-alias',{user:user.id,hasEmail:!!user.emailAlias,hasAccount:!!user.accountAlias});
        });reply(res,200,{ok:true});return;
      }
      if(path==='/api/grant'){
        if(typeof b.target==='string'&&b.target.trim())b.user=engine.target(store.load(roomId),b.target);
        if(!Number.isSafeInteger(b.amount)||(b.amount===0&&b.kind!=='tickets')||Math.abs(b.amount)>100000000||!['pt','tickets'].includes(b.kind)||typeof b.reason!=='string'||!b.reason.trim())throw Error('지급 종류·금액·사유를 확인하세요.');
        store.transaction(roomId,r=>{engine.reset(r);const u=r.users[b.user];if(!u)throw Error('청취자를 찾을 수 없습니다.');const next=u[b.kind]+b.amount;if(next<0)throw Error('보유량보다 많이 회수할 수 없습니다.');if(!Number.isSafeInteger(next))throw Error('변경 후 보유량이 정확히 처리 가능한 정수 범위를 초과합니다.');u[b.kind]=next;if(b.kind==='tickets'&&b.amount!==0)u.ticketRevision=(u.ticketRevision||0)+1;store.log(roomId,u.id,'manual-adjust',{kind:b.kind,amount:b.amount,reason:b.reason});});reply(res,200,{ok:true});return;
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
        const backup=store.db.prepare('SELECT data FROM backups WHERE id=? AND room=?').get(b.id,roomId);if(!backup)throw Error('백업을 찾을 수 없습니다.');const settings=validateSettings(JSON.parse(backup.data));store.transaction(roomId,r=>{checkSettingsRevision(r,b.expectedRevision);store.backup(roomId);engine.syncBuffs(r);r.settings=settings;engine.syncBuffs(r);r.settingsRevision=(r.settingsRevision||0)+1;store.log(roomId,'dj','settings-restore',{id:b.id});});reply(res,200,{ok:true});return;
      }
      if(path==='/api/notice-draft'){const settings=b.settings?validateSettings(b.settings):store.load(roomId).settings;reply(res,200,{text:`🎵 ${settings.playlistTitle}입니다. ${settings.requests?'신청곡은 !신청곡 가수 - 제목으로 남겨주세요.':'지금은 신청곡을 받지 않아요.'} 하트로 함께해주세요 ♥`.slice(0,200)});return;}
      if(path==='/api/reconnect'){if(!isDemo(roomId)){spoon.stop(roomId);spoon.start(roomId);}reply(res,200,{ok:true});return;}
      throw Object.assign(Error('기능을 찾을 수 없습니다.'),{status:404});
    }
    const files={'/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/offline.html':'offline.html','/app-icon.svg':'app-icon.svg','/pwa.css':'pwa.css','/pwa.mjs':'pwa.mjs','/playback-position.mjs':'playback-position.mjs','/affinity.mjs':'affinity.mjs','/spoon-charge.mjs':'spoon-charge.mjs','/weather-ui.mjs':'weather-ui.mjs','/community.mjs':'community.mjs','/community.css':'community.css','/sugar.css':'sugar.css','/bloom.css':'bloom.css','/radio-bloom.webp':'radio-bloom.webp','/radio-bloom-mini.webp':'radio-bloom-mini.webp','/operations-ui.mjs':'operations-ui.mjs','/diagnostics-ui.mjs':'diagnostics-ui.mjs','/request-json.mjs':'request-json.mjs','/petal.css':'petal.css','/radio-petal.png':'radio-petal.png','/radio-mini.png':'radio-mini.png','/minimi.js':'minimi.js','/':'index.html','/player':'index.html','/app.js':'app.js','/studio-state.mjs':'studio-state.mjs','/style.css':'style.css','/workspace.css':'workspace.css','/song-utils.mjs':'song-utils.mjs','/playback.mjs':'playback.mjs','/youtube-player.mjs':'youtube-player.mjs','/voice.js':'voice.js','/extra-ui.mjs':'extra-ui.mjs','/studio.css':'studio.css','/studio-icons.mjs':'studio-icons.mjs'};if(req.method!=='GET'||!Object.hasOwn(files,path)){reply(res,404,{error:'페이지를 찾을 수 없습니다.'});return;}
    res.writeHead(200,{'Content-Type':path.endsWith('.webmanifest')?'application/manifest+json; charset=utf-8':path.endsWith('.webp')?'image/webp':path.endsWith('.png')?'image/png':path.endsWith('.svg')?'image/svg+xml':(/\.m?js$/).test(path)?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(readFileSync(join(ROOT,'public',files[path])));
  }catch(e){if(e.status===413)res.setHeader('Connection','close');reply(res,e.status||400,{error:e.message});}
});
// Bound slow headers/uploads and idle keep-alive sockets on the public server.
server.headersTimeout=15000;server.requestTimeout=120000;server.keepAliveTimeout=5000;
for(const id of store.ids())if(id!==demoId){store.transaction(id,r=>{if(env.AUTO_OPERATIONS==='1'&&r.automation===undefined&&store.db.prepare('SELECT 1 FROM tokens WHERE room=?').get(id)){store.backup(id);setAutomation(r,true);}if((r.rulesVersion||0)<RULES_VERSION){store.backup(id);updateRequestedRules(r);}r.voiceInboxUrl=voice.url(id,env.PUBLIC_URL);if(r.settings.pauseItems){for(const u of Object.values(r.users)){u.buffPaused??={};for(const item of r.settings.items)u.buffPaused[item.id]??=r.itemCheckedAt||Date.now();}}r.live=false;r.listenerSnapshot={};engine.syncBuffs(r);});spoon.start(id);}
const timer=setInterval(()=>spoon.tick().catch(e=>console.error('scheduler:',e.message)),5000);
const cleanup=setInterval(()=>{sandbox?.expire();sandbox?.services.store.prune({eventsKeep:2000,backupsKeep:5,auditDays:1});androidAuth.prune();const now=Date.now();for(const [k,s] of sessions)if(s.expires<now)sessions.delete(k);for(const [k,t]of oauth)if(t.expires<now)oauth.delete(k);for(const [k,a]of attempts)if(now-a.time>60000)attempts.delete(k);},60000);
server.listen(Number(env.PORT||4310),env.HOST||'127.0.0.1',()=>console.log(`Spoon Studio: http://${env.HOST||'127.0.0.1'}:${server.address().port} (${production?'production':'local demo'})`));
const maintenance=setInterval(runMaintenance,6*3600000);
function runMaintenance(){try{expireVoice(store,voice,voiceRetention);store.db.prepare("DELETE FROM outbox WHERE created<? AND status!='pending'").run(Date.now()-7*86400000);store.prune();store.snapshot(join(DATA,'backups'));
  const backupDir=join(DATA,'backups'),stamp=new Date(Date.now()+9*3600000).toISOString().slice(0,10),pending=join(backupDir,'.full-'+randomUUID()+'.rmbak');
  try{fullBackup(DATA,pending,env.TOKEN_KEY,{allowOwnServer:true});renameSync(pending,join(backupDir,'full-'+stamp+'.rmbak'));}finally{rmSync(pending,{force:true});}
  for(const file of readdirSync(backupDir).filter(x=>/^full-\d{4}-\d{2}-\d{2}\.rmbak$/.test(x)).sort().reverse().slice(7))rmSync(join(backupDir,file));
}catch(e){console.error('maintenance:',e.message);}}
const initialMaintenance=setTimeout(runMaintenance,30000);initialMaintenance.unref();
process.on('unhandledRejection',e=>console.error('unhandledRejection:',e?.message||e));
process.on('uncaughtException',e=>{console.error('uncaughtException:',e?.message||e);shutdown(1);});
let shuttingDown=false;
function shutdown(code=0){if(shuttingDown)return;shuttingDown=true;setTimeout(()=>process.exit(code),5000).unref();clearTimeout(initialMaintenance);clearInterval(maintenance);clearInterval(timer);clearInterval(cleanup);for(const id of spoon.running.keys())spoon.stop(id);server.close(()=>{sandbox?.close();store.db.close();process.exit(code);});}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown());


