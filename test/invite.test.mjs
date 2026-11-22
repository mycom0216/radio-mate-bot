import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('invite connects a second DJ during a live broadcast and summon preserves both streams', {timeout:30000}, async()=>{
  const streams=new Map(),counts=new Map();
  const mock=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const dj=req.headers.authorization?.replace('Bearer ','');
    if(req.url==='/v1/oauth/token'){const code=new URLSearchParams(body).get('code');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({access_token:code,refresh_token:'refresh-'+code,expires_in:3600}));}
    else if(req.url==='/v1/me'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({userId:dj}));}
    else if(req.url==='/v1/live/events'){counts.set(dj,(counts.get(dj)||0)+1);streams.set(dj,res);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': live already started\n\n');req.on('close',()=>{if(streams.get(dj)===res)streams.delete(dj);});}
    else {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const data=mkdtempSync(join(tmpdir(),'radiomate-invite-'));
  const proc=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,NODE_ENV:'development',PUBLIC_URL:'http://localhost:4310',SPOON_REGION:'kr',SPOON_CLIENT_ID:'cid',SPOON_CLIENT_SECRET:'secret',TOKEN_KEY:'ab'.repeat(32),SPOON_API_BASE:`http://127.0.0.1:${mock.address().port}`},stdio:['ignore','pipe','pipe']});
  try{
    const origin=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('startup timeout')),10000);proc.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});proc.on('exit',code=>{clearTimeout(timer);reject(Error('server exit '+code));});});
    const login=async dj=>{const start=await fetch(origin+'/oauth/start',{redirect:'manual'}),state=new URL(start.headers.get('location')).searchParams.get('state');const callback=await fetch(`${origin}/oauth/callback?code=${dj}&state=${state}`,{redirect:'manual',headers:{Cookie:start.headers.get('set-cookie').split(';')[0]}});assert.equal(callback.status,302);const Cookie=callback.headers.get('set-cookie').split(';')[0],session=await(await fetch(origin+'/api/session',{headers:{Cookie}})).json();return {Cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrf};};
    let response=await fetch(origin+'/invite');assert.equal(response.status,200);assert.match(await response.text(),/방송 중에도/);
    assert.equal((await fetch(origin+'/invite.mjs')).status,200);
    assert.equal((await fetch(origin+'/api/reconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    const first=await login('first-dj'),second=await login('second-dj');
    assert.equal((await fetch(origin+'/mobile')).status,200);assert.equal((await fetch(origin+'/mobile.mjs')).status,200);
    assert.equal((await fetch(origin+'/api/mobile/issue',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    assert.equal((await fetch(origin+'/api/mobile/issue',{method:'POST',headers:{...first,'X-CSRF-Token':'wrong'},body:'{}'})).status,403);
    let issued=await fetch(origin+'/api/mobile/issue',{method:'POST',headers:first,body:'{}'});assert.equal(issued.status,200);const mobile=await issued.json();assert.match(mobile.code,/^M-/);
    const exchange=(path,extra={})=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:4310',...extra},body:JSON.stringify({code:mobile.code,room:'second-dj'})});
    assert.equal((await exchange('/api/mobile/preview',{Origin:'https://untrusted.example'})).status,403);
    let mobileResponse=await exchange('/api/mobile/preview');assert.equal(mobileResponse.status,200);assert.equal(mobileResponse.headers.get('set-cookie'),null,'preview must not sign the device in');
    mobileResponse=await exchange('/api/mobile/exchange');assert.equal(mobileResponse.status,200);const mobileCookie=mobileResponse.headers.get('set-cookie');assert.match(mobileCookie,/HttpOnly/);assert.match(mobileCookie,/SameSite=Lax/);
    const mobileSession=await(await fetch(origin+'/api/session',{headers:{Cookie:mobileCookie.split(';')[0]}})).json();assert.equal(mobileSession.room,'first-dj','the new mobile device must inherit only the issuing PC DJ');assert.equal(mobileSession.loggedIn,true);
    const mobileHeaders={Cookie:mobileCookie.split(';')[0],'Content-Type':'application/json','X-CSRF-Token':mobileSession.csrf};
    const otherBefore=await(await fetch(origin+'/api/room',{headers:second})).json();
    const pcBefore=await(await fetch(origin+'/api/room',{headers:first})).json(),pcSettings={...pcBefore.settings,quiet:!pcBefore.settings.quiet,cooldown:7};
    let saved=await fetch(origin+'/api/settings',{method:'POST',headers:first,body:JSON.stringify({settings:pcSettings,expectedRevision:pcBefore.settingsRevision||0})});assert.equal(saved.status,200);
    const phoneView=await(await fetch(origin+'/api/room',{headers:mobileHeaders})).json();assert.deepEqual(phoneView.settings,pcSettings,'PC saves must be visible on mobile for the same DJ');
    const phoneSettings={...phoneView.settings,responseGap:8};saved=await fetch(origin+'/api/settings',{method:'POST',headers:mobileHeaders,body:JSON.stringify({settings:phoneSettings,expectedRevision:phoneView.settingsRevision})});assert.equal(saved.status,200);
    const pcView=await(await fetch(origin+'/api/room',{headers:first})).json();assert.deepEqual(pcView.settings,phoneSettings,'mobile saves must be visible on PC');
    saved=await fetch(origin+'/api/settings',{method:'POST',headers:first,body:JSON.stringify({settings:pcSettings,expectedRevision:phoneView.settingsRevision})});assert.equal(saved.status,409,'a stale PC cannot overwrite the newer mobile settings');
    assert.deepEqual((await(await fetch(origin+'/api/room',{headers:second})).json()).settings,otherBefore.settings,'a different DJ must retain independent settings');
    assert.equal((await exchange('/api/mobile/exchange')).status,400,'a mobile login code must be single-use');
    mobileResponse=await fetch(origin+'/api/reconnect',{method:'POST',headers:{Cookie:mobileCookie.split(';')[0],'Content-Type':'application/json','X-CSRF-Token':mobileSession.csrf},body:'{}'});assert.equal(mobileResponse.status,200);
    for(let i=0;i<60;i++){const a=await(await fetch(origin+'/api/room',{headers:first})).json(),b=await(await fetch(origin+'/api/room',{headers:second})).json();if(a.live&&b.live)break;await new Promise(resolve=>setTimeout(resolve,50));}
    for(const [headers,id] of [[first,'first-dj'],[second,'second-dj']]){
      const room=await(await fetch(origin+'/api/room',{headers})).json();assert.equal(room.id,id);assert.equal(room.live,true,'OAuth must attach to an already live broadcast');
      response=await fetch(origin+'/api/reconnect',{method:'POST',headers,body:JSON.stringify({room:'unrelated-dj'})});assert.equal(response.status,200);assert.equal((await response.json()).connected,true);
      assert.equal(counts.get(id),1,'summon must reuse the active stream');
    }
    response=await fetch(origin+'/api/reconnect',{method:'POST',headers:{...second,'X-CSRF-Token':'wrong'},body:'{}'});assert.equal(response.status,403);
    assert.equal((await fetch(origin+'/api/bot-call-link',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    const issue=async(headers,rotate=false)=>{const r=await fetch(origin+'/api/bot-call-link',{method:'POST',headers,body:JSON.stringify({rotate})});assert.equal(r.status,200);return new URL((await r.json()).url).pathname;};
    const firstPath=await issue(first),secondPath=await issue(second);
    assert.notEqual(firstPath,secondPath,'each DJ receives a different capability');
    const publicEndpoint='/api/bot-call-public/'+secondPath.split('/').at(-1);
    assert.equal((await fetch(origin+'/call')).status,200);
    response=await fetch(origin+publicEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:4310'},body:JSON.stringify({action:'device-code'})});assert.equal(response.status,200);const device=await response.json();assert.match(device.code,/^[2-9A-HJ-NP-Z]{10}$/);
    const redeem=(code,Origin='http://localhost:4310')=>fetch(origin+'/api/bot-call-code',{method:'POST',headers:{'Content-Type':'application/json',Origin},body:JSON.stringify({code})});
    assert.equal((await redeem(device.code,'https://untrusted.example')).status,403);
    response=await redeem(device.code);assert.equal(response.status,200);assert.equal(new URL((await response.json()).url).pathname,secondPath,'a code on a new device must resolve to the correct DJ');
    for(let i=0;i<9;i++)assert.equal((await redeem('ZZZZZ-ZZZZZ')).status,404);
    assert.equal((await redeem(device.code)).status,429,'code guessing is bounded per client');
    response=await fetch(origin+secondPath);assert.equal(response.status,200);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.equal((await fetch(origin+secondPath+'/')).status,200);
    assert.equal((await fetch(origin+'/invite/')).status,200);
    assert.equal((await fetch(origin+'/invite-tools.mjs')).status,200);
    assert.equal((await fetch(origin+'/invite.css')).status,200);
    for(const userAgent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1','Mozilla/5.0 (Linux; Android 14) Chrome/131.0.0.0 Mobile Safari/537.36','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/131.0.0.0']){
      response=await fetch(origin+publicEndpoint,{headers:{'User-Agent':userAgent}});assert.equal(response.status,200);assert.equal((await response.json()).connected,true,'a second device needs no DJ session cookie');
    }
    response=await fetch(origin+publicEndpoint);assert.deepEqual(Object.keys(await response.json()).sort(),['connected','dj','state'],'public capability must not expose dashboard or user data');
    response=await fetch(origin+publicEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{}'});assert.equal(response.status,403);
    response=await fetch(origin+publicEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
    const call=()=>fetch(origin+publicEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:4310'},body:JSON.stringify({room:'first-dj'})});
    response=await call();assert.equal(response.status,200);assert.equal((await response.json()).connected,true,'already-authorized DJ can be called without any login cookie');
    assert.equal((await call()).status,429,'public calls must be bounded');
    assert.equal(counts.get('first-dj'),1);assert.equal(counts.get('second-dj'),1);
    const rotatedPath=await issue(second,true);assert.notEqual(rotatedPath,secondPath);
    assert.equal((await fetch(origin+publicEndpoint)).status,404,'rotation revokes the old link');
    response=await fetch(origin+'/api/disconnect',{method:'POST',headers:second,body:'{}'});assert.equal(response.status,200);
    assert.equal((await fetch(origin+'/api/bot-call-public/'+rotatedPath.split('/').at(-1))).status,404,'disconnect also revokes capability access');
    response=await fetch(origin+'/api/reconnect',{method:'POST',headers:second,body:'{}'});assert.equal(response.status,400);assert.match((await response.json()).error,/스푼 연결이 필요/);
    const room=await(await fetch(origin+'/api/room',{headers:first})).json();assert.equal(room.live,true,'disconnecting another DJ must preserve the first DJ');assert.equal(counts.get('first-dj'),1);
  }finally{
    const exited=new Promise(resolve=>proc.once('exit',resolve));proc.kill();await exited;
    for(const res of streams.values())res.destroy();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));rmSync(data,{recursive:true,force:true});
  }
});
