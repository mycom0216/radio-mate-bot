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

test('suppressed command metadata explains waiting and quiet mode without changing balances',()=>{
  const f=setup();f.say('!내정보 생성');
  const out=f.say('!게임 on',{wait:1000});assert.equal(out.text,null);assert.equal(out.suppressed,'cooldown');assert.equal(out.retryAfterMs,19000);
  f.mutate((r,u)=>{r.settings.quiet=true;u.tickets=3;});
  const quiet=f.say('!복권 자동');assert.equal(quiet.suppressed,'quiet');assert.equal(f.user().tickets,3);
  assert.equal(f.user().exp,0);f.store.db.close();
});

test('DJ ticket command accepts signed integers, zero and the default quantity',()=>{
  const f=setup();f.say('!내정보 생성');
  assert.match(f.say('!복권지급 @u1 5',{dj:true}).text,/5장 지급/);assert.equal(f.user().tickets,5);
  assert.match(f.say('!복권지급 @u1 -2',{dj:true}).text,/2장 회수/);assert.equal(f.user().tickets,3);
  assert.match(f.say('!복권지급 @u1 0',{dj:true}).text,/변경 없음/);assert.equal(f.user().tickets,3);
  f.say('!복권지급 @u1',{dj:true});assert.equal(f.user().tickets,4);
  f.say('!복권지급 @u1 +2',{dj:true});assert.equal(f.user().tickets,6);
  const logs=f.store.logs('a').filter(l=>l.type==='ticket-grant');assert.equal(logs.length,5);assert.equal(logs.find(l=>l.data.count===-2).data.balance,3);
  f.say('!내정보 생성',{room:'b'});f.say('!복권지급 @u1 99',{dj:true,room:'b'});
  assert.equal(f.store.logs('a').filter(l=>l.type==='ticket-grant').length,5);
  assert.equal(f.store.logs('b').filter(l=>l.type==='ticket-grant')[0].data.count,99);
  f.store.db.close();
});

test('DJ ticket reset supports both spellings, logs previous balance and never replays over a new grant',()=>{
  const f=setup();f.say('!내정보 생성');f.mutate((r,u)=>{u.tickets=500000000650000;u.exp=750;u.pt=120;});
  assert.match(f.say('!복권 초기화 @u1',{dj:true,event:'reset-once'}).text,/500,000,000,650,000장 → 0장/);
  assert.equal(f.user().tickets,0);assert.equal(f.user().exp,750);assert.equal(f.user().pt,120);
  const log=f.store.logs('a').find(l=>l.type==='ticket-reset');assert.equal(log.data.previous,500000000650000);assert.equal(log.data.balance,0);
  f.say('!복권지급 @u1 5',{dj:true});assert.equal(f.say('!복권 초기화 @u1',{dj:true,event:'reset-once'}).duplicate,true);assert.equal(f.user().tickets,5);
  assert.match(f.say('!복권초기화 @u1',{dj:true}).text,/5장 → 0장/);assert.match(f.say('!복권초기화 @u1',{dj:true}).text,/0장 → 0장/);
  f.store.db.close();
});

test('ticket reset requires DJ and exactly one existing target and stays within its room',()=>{
  const f=setup();f.say('!내정보 생성');f.say('!내정보 생성',{room:'b'});
  f.say('!복권지급 @u1 8',{dj:true});f.say('!복권지급 @u1 9',{dj:true,room:'b'});
  for(const command of ['!복권 초기화 @u1','!복권초기화 @u1'])assert.match(f.say(command).text,/DJ 전용/);
  for(const command of ['!복권 초기화','!복권초기화','!복권초기화 @u1 @u2'])assert.match(f.say(command,{dj:true}).text,/사용법/);
  f.say('!복권초기화 @missing',{dj:true});assert.equal(f.user().tickets,8);
  f.say('!복권초기화 @u1',{dj:true});assert.equal(f.store.load('b').users.u1.tickets,9);f.store.db.close();
});

test('ticket recovery rejects overdrafts, fractions, unsafe integers and non-DJs; replay never recovers twice',()=>{
  const f=setup();f.say('!내정보 생성');f.say('!복권지급 @u1 4',{dj:true});
  assert.match(f.say('!복권지급 @u1 -5',{dj:true}).text,/보유 복권/);
  for(const amount of ['0.5','-0.5','1e3','NaN','9007199254740992','-9007199254740992']){
    f.say(`!복권지급 @u1 ${amount}`,{dj:true});assert.equal(f.user().tickets,4);
  }
  assert.match(f.say('!복권지급 @u1 -1').text,/DJ 전용/);
  assert.match(f.say('!복권지급 @u1 1 extra',{dj:true}).text,/사용법/);
  assert.match(f.say('!복권지급',{dj:true}).text,/사용법/);
  assert.equal(f.store.logs('a').filter(l=>l.type==='ticket-grant').length,1);
  f.say('!복권지급 @u1 -4',{dj:true,event:'recover-once'});assert.equal(f.user().tickets,0);
  assert.equal(f.say('!복권지급 @u1 -4',{dj:true,event:'recover-once'}).duplicate,true);assert.equal(f.user().tickets,0);
  f.store.db.close();
});

test('DJ ticket grants and recovery have no 1000-ticket cap and preserve exact balances',()=>{
  const f=setup();f.say('!내정보 생성');
  assert.match(f.say('!복권지급 @u1 1001',{dj:true}).text,/1,001장 지급/);
  assert.equal(f.user().tickets,1001);
  assert.match(f.say('!복권지급 @u1 -1001',{dj:true}).text,/1,001장 회수/);
  assert.equal(f.user().tickets,0);
  f.say(`!복권지급 @u1 ${Number.MAX_SAFE_INTEGER}`,{dj:true});
  assert.equal(f.user().tickets,Number.MAX_SAFE_INTEGER);
  assert.match(f.say('!복권지급 @u1 1',{dj:true}).text,/보유량.*범위/);
  assert.equal(f.user().tickets,Number.MAX_SAFE_INTEGER);
  assert.equal(f.store.logs('a').filter(l=>l.type==='ticket-grant').length,3);
  f.say(`!복권지급 @u1 -${Number.MAX_SAFE_INTEGER}`,{dj:true});
  assert.equal(f.user().tickets,0);
  f.store.db.close();
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
test('next song is read-only, consecutive 2-request limit and listener fishing toggles',()=>{
  const f=setup();f.say('!내정보 생성');f.say('!신청곡 가수 - A');f.say('!신청곡 가수 - B');
  assert.match(f.say('!신청곡 가수 - C').text,/연속 신청/);assert.equal(f.store.load('a').songs.length,2);
  f.say('!다음곡');assert.equal(f.store.load('a').songs.length,2);assert.equal(f.store.load('a').current,null);
  assert.match(f.say('!낚시 off').text,/DJ 전용/);assert.equal(f.store.load('a').settings.fishing,true);
  f.say('!낚시 on');assert.equal(f.store.load('a').settings.fishing,true);
  f.say('!낚시 off',{dj:true});assert.equal(f.store.load('a').settings.fishing,false);
  assert.equal(f.say('!낚시').text,null);
});

test('listeners enable games and attend; disabling games and sensitive commands stay DJ-only',()=>{
  const f=setup();assert.match(f.say('!게임 on').text,/게임 ON/);
  for(const key of ['fishing','odd','rps','dice','numberGuess','quiz'])assert.equal(f.store.load('a').settings[key],true);
  assert.equal(f.store.load('a').settings.roulette,false);
  f.say('!내정보 생성');assert.match(f.say('!게임 off').text,/DJ 전용/);assert.match(f.say('!게임 off',{dj:true}).text,/게임 OFF/);
  assert.equal(f.say('!게임 on',{wait:1000}).text,null);assert.equal(f.store.load('a').settings.fishing,false);
  assert.match(f.say('!출석').text,/복권 1장 지급/);assert.equal(f.user().tickets,1);
  assert.match(f.say('!출석').text,/이미 출석/);assert.equal(f.user().tickets,1);
  f.say('!게임 on');assert.match(f.say('!홀짝 off').text,/DJ 전용/);f.say('!홀짝 off',{dj:true});assert.equal(f.store.load('a').settings.odd,false);assert.equal(f.store.load('a').settings.fishing,true);
  assert.match(f.say('!게임 상태').text,/홀짝 OFF/);
  assert.match(f.say('!조용 on').text,/DJ 전용/);assert.equal(f.store.load('a').settings.quiet,false);
  assert.match(f.say('!복권지급 @u1 9').text,/DJ 전용/);assert.equal(f.user().tickets,1);
  assert.equal(f.store.load('b').settings.rps,false);f.store.db.close();
});

test('automatic lottery picks 3 distinct numbers, spends one ticket and preserves all payout levels',()=>{
  for(const [draw,expected]of [[[0,0,0],300],[[0,0,1],150],[[0,2,2],50],[[3,3,3],0]]){
    const f=setup();f.say('!내정보 생성');f.say('!출석');f.draw(0,0,0,...draw);
    const result=f.say('!복권 자동');assert.match(result.text,/자동 선택 1 2 3/);assert.equal(f.user().tickets,0);assert.equal(f.user().exp,expected);
    const log=f.store.logs('a').find(l=>l.type==='lottery');assert.equal(log.data.auto,true);assert.equal(new Set(log.data.input).size,3);assert.ok(log.data.input.every(n=>Number(n)>=1&&Number(n)<=9));assert.equal(new Set(log.data.draw).size,3);f.store.db.close();
  }
});

test('automatic lottery respects ticket shortage, cooldown, invalid arguments and event deduplication',()=>{
  const f=setup();f.say('!내정보 생성');assert.match(f.say('!복권 자동').text,/부족/);assert.equal(f.user().exp,0);
  f.mutate((r,u)=>u.tickets=2);assert.match(f.say('!복권 자동 1').text,/사용법/);assert.equal(f.user().tickets,2);
  f.say('!복권 자동',{event:'auto-once'});assert.equal(f.user().tickets,0);const exp=f.user().exp;
  assert.equal(f.say('!복권 자동',{event:'auto-once'}).duplicate,true);assert.equal(f.user().tickets,0);assert.equal(f.user().exp,exp);
  f.say('!복권 자동');assert.equal(f.user().tickets,0);
  f.mutate((r,u)=>u.tickets=1);assert.equal(f.say('!복권 자동',{wait:1000}).text,null);assert.equal(f.user().tickets,1);f.store.db.close();
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
