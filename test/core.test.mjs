import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Store, defaults, validateSettings, LIMIT, dates } from '../core.mjs';
import { frames,seal,unseal } from '../spoon.mjs';
function setup(){
  const store=new Store();let time=Date.parse('2026-11-16T00:00:00Z'),sequence=[];
  const engine=new Engine(store,{now:()=>time,int:(a,b)=>{const x=sequence.shift();return x===undefined?a:Math.min(b,Math.max(a,x));}});
  store.create('a','A');store.create('b','B');
  for(const r of ['a','b'])store.transaction(r,x=>{x.settings.fishing=true;x.settings.odd=true;});
  let counter=0;
  const say=(message,{id='u1',name='청취자',dj=false,event,room='a',wait=21000}={})=>{time+=wait;return engine.handle(room,{id:event||`event-${++counter}`,user:{id,nickname:name},message,isDj:dj});};
  const user=()=>store.load('a').users.u1;
  const mutate=fn=>store.transaction('a',r=>fn(r,r.users.u1));
  const draw=(...values)=>sequence.push(...values);
  return {store,engine,say,user,mutate,draw,advance:ms=>time+=ms,setTime:ms=>time=ms};
}
test('attendance once a Korean day, room isolation and deduplicated events',()=>{
  const f=setup();f.say('! 내정보 생성');f.say('!출석',{event:'attendance'});assert.equal(f.user().tickets,1);
  assert.equal(f.say('!출석',{event:'attendance'}).duplicate,true);f.say('!출석');assert.equal(f.user().tickets,1);
  f.say('!내정보 생성',{room:'b'});assert.equal(f.store.load('b').users.u1.tickets,0);
  f.setTime(Date.parse('2026-11-16T15:00:00Z'));f.say('!출석');assert.equal(f.user().tickets,2);
});
test('lottery rejects duplicates, matches without order, and consumes one ticket',()=>{
  const f=setup();f.say('!내정보 생성');f.say('!출석');
  f.say('!복권 3 3 9');assert.equal(f.user().tickets,1);
  f.draw(2,4,6); // 3,6,9 after removal from the shrinking pool
  const result=f.say('!복권 9 3 6');assert.match(result.text,/3개 일치/);assert.equal(f.user().exp,300);assert.equal(f.user().tickets,0);
});
test('fishing EXP and PT cap independently; EXP doubles and clips to the cap',()=>{
  const f=setup();f.say('!내정보 생성');
  f.mutate((r,u)=>{u.daily.fishExp=199950;u.buffs.exp=Date.parse('2026-11-20');});
  f.say('!낚시');assert.equal(f.user().daily.fishExp,LIMIT.exp);assert.equal(f.user().exp,50);assert.ok(f.user().pt>0);
  const pt=f.user().pt;f.say('!낚시');assert.equal(f.user().exp,50);assert.ok(f.user().pt>pt);
  f.mutate((r,u)=>{u.daily.fishExp=0;u.daily.fishPt=LIMIT.fish;});const before=f.user().pt;
  f.say('!낚시');assert.equal(f.user().exp,170);assert.equal(f.user().pt,before);
});
test('odd/even: win returns stake plus profit, loss never reduces daily winnings',()=>{
  const f=setup();f.say('!내정보 생성');f.mutate((r,u)=>u.pt=100000);f.draw(1);f.say('!홀 20000');
  assert.equal(f.user().pt,120000);assert.equal(f.user().daily.oddPt,20000);assert.equal(f.user().daily.totalPt,20000);
  f.draw(100);f.say('!홀 20000');assert.equal(f.user().pt,100000);assert.equal(f.user().daily.oddPt,20000);
  const before=f.user().pt;f.say('!짝 -20');assert.equal(f.user().pt,before);
  f.mutate((r,u)=>u.daily.oddPt=499990);f.say('!홀 100');assert.equal(f.user().pt,before);
});
test('PT cap clips rewards, spending does not reopen cap and achiever is unique',()=>{
  const f=setup();f.say('!내정보 생성');
  f.mutate((r,u)=>{u.daily.totalPt=999990;f.engine.credit(r,u,30000,'legend-special');f.engine.credit(r,u,30000,'legend-special');});
  assert.equal(f.user().pt,10);assert.equal(f.user().daily.totalPt,1000000);assert.equal(f.store.load('a').achievers.length,1);
  f.mutate((r,u)=>{u.pt=0;f.engine.credit(r,u,100,'fish');});assert.equal(f.user().pt,0);
});
test('month reset keeps EXP, inventory, buffs, book and fan ranking',()=>{
  const f=setup();f.say('!내정보 생성');f.mutate((r,u)=>{u.exp=1234;u.pt=300;u.tickets=2;u.keeps=['보상'];u.bag.exp=1;u.book.x={name:'붕어',count:3,rarity:0};});
  f.setTime(Date.parse('2026-11-30T15:00:00Z'));f.say('!내정보');
  const u=f.user();assert.equal(u.pt,0);assert.equal(u.tickets,0);assert.deepEqual(u.keeps,[]);assert.equal(u.exp,1234);assert.equal(u.bag.exp,1);assert.equal(u.book.x.count,3);
});
test('next song is read-only, consecutive 2-request limit and DJ-only toggles',()=>{
  const f=setup();f.say('!내정보 생성');f.say('!신청곡 가수 - A');f.say('!신청곡 가수 - B');
  assert.match(f.say('!신청곡 가수 - C').text,/연속 신청/);assert.equal(f.store.load('a').songs.length,2);
  f.say('!다음곡');assert.equal(f.store.load('a').songs.length,2);assert.equal(f.store.load('a').current,null);
  f.say('!낚시 off');assert.equal(f.store.load('a').settings.fishing,true);
  f.say('!낚시 off',{dj:true});assert.equal(f.store.load('a').settings.fishing,false);
  assert.equal(f.say('!낚시').text,null);
});
test('cooldown prevents rewards, quiet stops games, shop spends only PT and extends buff',()=>{
  const f=setup();f.say('!내정보 생성');assert.equal(f.say('!낚시',{wait:1000}).text,null);assert.equal(f.user().exp,0);
  f.mutate((r,u)=>{u.pt=100000;u.exp=300;});f.say('!아이템 구매 exp');assert.equal(f.user().pt,80000);assert.equal(f.user().exp,300);
  f.say('!아이템 사용 exp');const until=f.user().buffs.exp;
  f.say('!아이템 구매 exp');f.say('!아이템 사용 exp');assert.equal(f.user().buffs.exp,until+1200000);
  f.say('!조용 on',{dj:true});const before=f.user().exp;f.say('!낚시');assert.equal(f.user().exp,before);
});
test('rare buff selects above-rare pool 70 percent, golden roll automatically held by default',()=>{
  const f=setup();f.say('!내정보 생성');f.mutate((r,u)=>{u.buffs.rare=Date.parse('2026-11-20');});
  f.draw(10000,70,0,20,5050);const result=f.say('!낚시');assert.match(result.text,/희귀/);
  f.mutate((r,u)=>{r.settings.fish=r.settings.fish.filter(x=>x.golden||x.rarity===0);r.settings.goldenPolicy='pending';});
  f.draw(10000,1,0,5,60000,4);assert.match(f.say('!낚시').text,/240000 PT/);assert.equal(f.store.load('a').special.at(-1).status,'policy-pending');
});
test('invalid settings rejected; restore cannot change a different room',()=>{
  const s=defaults();s.cooldown=0;assert.throws(()=>validateSettings(s));
  const f=setup();const id=f.store.backup('a');assert.equal(f.store.db.prepare('SELECT 1 FROM backups WHERE id=? AND room=?').get(id,'b'),undefined);
});
test('shop stock is consumed atomically and sold-out purchase never deducts PT',()=>{
  const f=setup();f.say('!내정보 생성');f.mutate((r,u)=>{u.pt=100000;r.settings.items.find(i=>i.id==='exp').stock=1;});
  f.say('!아이템 구매 exp');assert.equal(f.user().pt,80000);assert.equal(f.user().bag.exp,1);
  assert.match(f.say('!아이템 구매 exp').text,/품절/);assert.equal(f.user().pt,80000);assert.equal(f.user().bag.exp,1);
});
test('SSE parser handles split CRLF, multiple data lines, heartbeats; token encryption authenticates',async()=>{
  const encoder=new TextEncoder(),chunks=[':heartbeat\r\n\r\nid:1\r\nevent:chat\r','\ndata:{"a":\r\ndata:1}\r\n\r\n'];
  const body=new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(encoder.encode(chunk));c.close();}});const result=[];for await(const frame of frames(body))result.push(frame);
  assert.equal(result.length,1);assert.equal(result[0].id,'1');assert.deepEqual(result[0].data,{a:1});
  const key='a'.repeat(64),token={access_token:'secret'};assert.deepEqual(unseal(seal(token,key),key),token);assert.throws(()=>unseal(seal(token,key),'b'.repeat(64)));
});
