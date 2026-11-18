import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store,Engine} from '../core.mjs';
import {RoomChat} from '../chat-room.mjs';
import {Lifestyle,regions,assistantRequest} from '../lifestyle.mjs';
test('read-only provider requests recover from one network failure without retrying invalid keys',async()=>{
 let calls=0;const service=new Lifestyle({fetcher:async()=>{if(++calls===1)throw Error('transient');return {ok:true,json:async()=>({ok:true})};}});assert.deepEqual(await service.json('https://api.open-meteo.com/'),{ok:true});assert.equal(calls,2);
 calls=0;const denied=new Lifestyle({fetcher:async()=>{calls++;return {ok:false,status:401};}});await assert.rejects(denied.json('https://naverapihub.apigw.ntruss.com/'),/인증/);assert.equal(calls,1);
});
test('chat links isolate rooms, revoke on rotation and never expose actor identifiers',()=>{
 const store=new Store();store.create('a','A');store.create('b','B');let now=100000;const chat=new RoomChat(store,{now:()=>now});
 const token=chat.link('a','enable');assert.equal(chat.resolve(token),'a');const message={id:randomUUID(),name:'<img src=x>',text:'안녕하세요 <script>'};
 chat.send('a',message,'127.0.0.1');assert.equal(chat.send('a',message,'127.0.0.1').duplicate,true);assert.throws(()=>chat.send('a',{...message,id:randomUUID()},'127.0.0.1'),/2초/);
 assert.equal(chat.publicList('a').messages[0].actor,undefined);assert.equal(chat.publicList('a').messages[0].role,'guest');assert.equal(chat.list('b').messages.length,0);
 now+=2100;chat.send('a',{...message,id:randomUUID(),name:'DJ'},'guest-ip');assert.equal(chat.list('a').messages[1].role,'guest');
 const next=chat.link('a','rotate');assert.notEqual(next,token);assert.throws(()=>chat.resolve(token),/만료/);chat.link('a','disable');assert.throws(()=>chat.resolve(next),/만료/);assert.throws(()=>chat.send('a',{...message,id:randomUUID()},'other-ip'),/닫힌/);
 now+=8*86400000;assert.equal(chat.list('a').messages.length,0);store.db.close();
});
test('chat bounds input, respects banned words, caps history and allows DJ moderation',()=>{
 const store=new Store();store.create('a','A');store.transaction('a',r=>r.settings.bannedWords=['금칙']);let now=1000;const chat=new RoomChat(store,{now:()=>now});chat.link('a','enable');
 assert.throws(()=>chat.send('a',{id:randomUUID(),text:'금칙',name:'손님'},'g'),/제한/);assert.throws(()=>chat.send('a',{id:randomUUID(),text:'a'.repeat(401),name:'손님'},'g'),/400/);
 for(let i=0;i<105;i++){now+=2100;chat.send('a',{id:randomUUID(),text:'hello '+i,name:'DJ'},'dj');}
 assert.equal(chat.list('a').messages.length,100);const id=chat.list('a').messages[0].id;chat.remove('a',id);assert.equal(chat.list('a').messages.length,99);assert.equal(chat.list('a').messages.some(m=>m.id===id),false);store.db.close();
});
test('national weather caches and coalesces requests, validates data and splits chat replies',async()=>{
 let calls=0;const service=new Lifestyle({fetcher:async url=>{calls++;assert.equal(url.searchParams.get('timezone'),'Asia/Seoul');return {ok:true,json:async()=>regions.map(()=>({current:{temperature_2m:12.1,weather_code:3,time:'2026-11-18T12:00'}}))};}});
 const [a,b]=await Promise.all([service.weather(),service.weather()]);assert.equal(a.items.length,17);assert.equal(a,b);assert.equal(calls,1);
 for(const arg of ['1','2','3']){const text=await service.answer({kind:'전국날씨',arg});assert.ok(text.length<=200);assert.match(text,/Open-Meteo/);}
 assert.match(await service.answer({kind:'날씨',arg:'수원'}),/수원 날씨/);assert.equal(calls,1);
 const bad=new Lifestyle({fetcher:async()=>({ok:true,json:async()=>[]})});await assert.rejects(bad.weather(),/응답/);
});
test('Naver searches use server headers, safe map links and meal-specific query without fabricated ratings',async()=>{
 const service=new Lifestyle({clientId:'test-id',clientSecret:'test-secret',fetcher:async(url,options)=>{
  assert.equal(url.hostname,'naverapihub.apigw.ntruss.com');assert.equal(url.searchParams.get('display'),'5');assert.match(url.searchParams.get('query'),/광주 점심 식사 맛집/);assert.equal(options.headers['X-NCP-APIGW-API-KEY'],'test-secret');
  return {ok:true,json:async()=>({items:[{title:'<b>카페</b> &amp; 밥',category:'한식',roadAddress:'광주',link:'javascript:evil'}]})};
 }});const result=await service.places({region:'광주',kind:'맛집',meal:'점심'});assert.equal(result.items[0].title,'카페 & 밥');assert.ok(result.items[0].url.startsWith('https://map.naver.com/'));assert.equal(result.items[0].rating,undefined);assert.ok(!JSON.stringify(result).includes('test-secret'));
 const fallback=await new Lifestyle().places({region:'서울',kind:'카페'});assert.equal(fallback.configured,false);assert.equal(fallback.items.length,0);
 await assert.rejects(service.places({region:'',kind:'맛집'}),/지역/);
});
test('bot assistant observes quiet mode, response cooldown and event idempotency before remote fetch',async()=>{
 const store=new Store();store.create('a','A');let now=Date.now(),calls=0;const engine=new Engine(store,{now:()=>now});engine.lifestyle={answer:async()=>{assert.equal(store.db.isTransaction,false);calls++;return '서울 12도';}};
 const event={id:'weather-1',user:{id:'u',nickname:'사용자'},message:'!날씨 서울'};assert.equal((await engine.handleAsync('a',event)).text,'서울 12도');assert.equal(calls,1);assert.equal(JSON.parse(store.db.prepare('SELECT result FROM events WHERE id=?').get(event.id).result).text,null);assert.equal((await engine.handleAsync('a',event)).duplicate,true);assert.equal(calls,1);
 assert.equal((await engine.handleAsync('a',{...event,id:'weather-2'})).suppressed,'cooldown');assert.equal(calls,1);now+=30000;store.transaction('a',r=>r.settings.quiet=true);assert.equal((await engine.handleAsync('a',{...event,id:'weather-3'})).suppressed,'quiet');assert.equal(calls,1);
 assert.deepEqual(assistantRequest('!채팅 서울 날씨 알려줘'),{kind:'날씨',arg:'서울'});store.db.close();
});
