import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {gateway,validTunnel} from '../deploy/gateway-worker.mjs';
function fixture(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE gateway_route(id INTEGER PRIMARY KEY,origin TEXT,sequence INTEGER,updated_at INTEGER)');return {db,env:{ROUTER_KEY:'test-only-key',DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:r.changes}};}};}}}};}
function update(origin,sequence=1,now=Date.now(),key='test-only-key'){const body=JSON.stringify({origin,sequence}),signature=createHmac('sha256',key).update(now+'\n'+body).digest('hex');return new Request('https://fixed.example/__radiomate/route',{method:'POST',headers:{'x-radiomate-time':String(now),'x-radiomate-signature':signature},body});}
test('fixed gateway requires signed updates, rejects private targets and prevents stale route replay',async()=>{
 const {db,env}=fixture();assert.equal((await gateway(update('https://live.trycloudflare.com',1,Date.now(),'bad'),env)).status,401);assert.equal((await gateway(update('http://127.0.0.1'),env)).status,400);assert.equal(validTunnel('https://evil.trycloudflare.com.attacker.test'),null);assert.equal(validTunnel('https://user:pass@live.trycloudflare.com'),null);
 assert.equal((await gateway(update('https://first.trycloudflare.com',2),env)).status,200);await gateway(update('https://old.trycloudflare.com',1),env);assert.equal(db.prepare('SELECT origin FROM gateway_route').get().origin,'https://first.trycloudflare.com');db.close();
});
test('fixed gateway forwards cookie, Origin, body, ranges and redirects without leaking platform headers',async()=>{
 const {db,env}=fixture();await gateway(update('https://first.trycloudflare.com'),env);const request=new Request('https://fixed.example/api/example?q=1',{method:'POST',headers:{Cookie:'studio=example',Origin:'https://fixed.example','oai-authenticated-user-email':'private@example.test',Range:'bytes=0-10'},body:'hello'});
 const result=await gateway(request,env,async upstream=>{assert.equal(upstream.url,'https://first.trycloudflare.com/api/example?q=1');assert.equal(upstream.headers.get('cookie'),'studio=example');assert.equal(upstream.headers.get('origin'),'https://fixed.example');assert.equal(upstream.headers.get('range'),'bytes=0-10');assert.equal(upstream.headers.get('oai-authenticated-user-email'),null);assert.equal(await upstream.text(),'hello');return new Response(null,{status:302,headers:{Location:'/oauth/start','Set-Cookie':'studio=new; HttpOnly; Secure'}});});assert.equal(result.status,302);assert.equal(result.headers.get('set-cookie'),'studio=new; HttpOnly; Secure');assert.equal(result.headers.get('cache-control'),'no-store');db.close();
});
test('authenticated weather bridge only queries fixed provider coordinates and rejects arbitrary targets',async()=>{
 const {db,env}=fixture(),now=Date.now(),body=JSON.stringify({period:'nextWeek'}),signature=createHmac('sha256','test-only-key').update(now+'\n'+body).digest('hex');
 const request=new Request('https://fixed.example/__radiomate/weather',{method:'POST',headers:{'x-radiomate-time':String(now),'x-radiomate-signature':signature},body});
 const response=await gateway(request,env,async(target,options)=>{assert.equal(target.hostname,'api.open-meteo.com');assert.equal(target.searchParams.get('latitude').split(',').length,17);assert.equal(target.searchParams.get('timezone'),'Asia/Seoul');assert.match(target.searchParams.get('daily'),/precipitation_probability_max/);assert.equal(options.headers,undefined);return new Response(JSON.stringify(Array.from({length:17},()=>({daily:{time:[]}}))),{headers:{'Content-Type':'application/json'}});});assert.equal(response.status,200);assert.equal((await response.json()).length,17);db.close();
});

test('a slash-prefixed path stays on the registered tunnel origin', async () => {
 const {db,env}=fixture();
 await gateway(update('https://first.trycloudflare.com'),env);
 const response=await gateway(new Request('https://fixed.example//other.example/path?q=1'),env,async upstream=>{
  assert.equal(upstream.url,'https://first.trycloudflare.com//other.example/path?q=1');
  return new Response('ok');
 });
 assert.equal(response.status,200);
 db.close();
});
