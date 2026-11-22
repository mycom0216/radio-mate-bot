import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('authenticated DJ grants capture access and real donation SSE frames reach only that read-only relay',{timeout:30000},async()=>{
 let stream;const mock=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;
  if(req.url==='/v1/oauth/token')res.end(JSON.stringify({access_token:'AT',refresh_token:'RT',expires_in:3600}));
  else if(req.url==='/v1/me')res.end(JSON.stringify({userId:'capture-dj'}));
  else if(req.url==='/v1/live/events'){stream=res;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': connected\n\n');}
  else{res.writeHead(204);res.end();}});await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const data=mkdtempSync(join(tmpdir(),'capture-http-')),proc=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,NODE_ENV:'development',PUBLIC_URL:'http://localhost:4310',SPOON_CLIENT_ID:'test',SPOON_CLIENT_SECRET:'test',TOKEN_KEY:'ab'.repeat(32),SPOON_API_BASE:`http://127.0.0.1:${mock.address().port}`},stdio:['ignore','pipe','pipe']});
 try{
  const origin=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('startup timeout')),10000);proc.stdout.on('data',chunk=>{out+=chunk;const match=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});proc.on('exit',code=>{clearTimeout(timer);reject(Error('exit '+code));});});
  assert.equal((await fetch(origin+'/api/screen-capture',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"issue"}'})).status,401);
  const zip=await fetch(origin+'/extensions/donation-capture.zip');assert.equal(zip.status,200);assert.match(zip.headers.get('content-type'),/application\/zip/);assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(0),0x04034b50);
  let response=await fetch(origin+'/oauth/start',{redirect:'manual'});const state=new URL(response.headers.get('location')).searchParams.get('state'),cookie=response.headers.get('set-cookie').split(';')[0];
  response=await fetch(origin+'/oauth/callback?state='+state+'&code=test',{redirect:'manual',headers:{Cookie:cookie}});const Cookie=response.headers.get('set-cookie').split(';')[0],session=await(await fetch(origin+'/api/session',{headers:{Cookie}})).json(),headers={Cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrf};
  assert.equal((await fetch(origin+'/api/screen-capture',{method:'POST',headers:{...headers,'X-CSRF-Token':'bad'},body:'{"action":"issue"}'})).status,403);
  response=await fetch(origin+'/api/screen-capture',{method:'POST',headers,body:'{"action":"issue"}'});assert.equal(response.status,200);const grant=await response.json(),relayHeaders={Authorization:'Bearer '+grant.token};
  assert.equal((await fetch(origin+'/api/room',{headers:relayHeaders})).status,401,'capture grant cannot log into a DJ dashboard');assert.equal((await fetch(origin+'/api/screen-capture/events')).status,401);
  assert.equal((await fetch(origin+'/api/screen-capture/events',{method:'POST',headers:relayHeaders})).status,405);
  const room=await(await fetch(origin+'/api/room',{headers})).json();room.settings.quiet=true;await fetch(origin+'/api/settings',{method:'POST',headers,body:JSON.stringify({settings:room.settings,expectedRevision:room.settingsRevision||0})});
  for(let i=0;i<30&&!stream;i++)await new Promise(resolve=>setTimeout(resolve,25));assert.ok(stream);
  const payload='id: donated\nevent: donation\ndata: '+JSON.stringify({user:{id:'u',nickname:'후원자'},amount:300,time:new Date().toISOString()})+'\n\n';stream.write(payload);stream.write(payload);
  let result;for(let i=0;i<30;i++){result=await(await fetch(origin+'/api/screen-capture/events',{headers:relayHeaders})).json();if(result.events.length)break;await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(result.events.length,1,'quiet mode and duplicate delivery must not lose or repeat a capture trigger');assert.equal(result.events[0].amount,300);assert.equal(result.dj,'DJ captur');assert.equal('userId' in result.events[0],false);
  const rotated=await(await fetch(origin+'/api/screen-capture',{method:'POST',headers,body:'{"action":"issue"}'})).json();assert.equal((await fetch(origin+'/api/screen-capture/events',{headers:relayHeaders})).status,401);
  await fetch(origin+'/api/screen-capture',{method:'POST',headers,body:'{"action":"revoke"}'});assert.equal((await fetch(origin+'/api/screen-capture/events',{headers:{Authorization:'Bearer '+rotated.token}})).status,401);
 }finally{const exited=new Promise(resolve=>proc.once('exit',resolve));proc.kill();await exited;stream?.destroy();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));rmSync(data,{recursive:true,force:true});}
});
