import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine,defaults} from '../core.mjs';
import {lotterySummary,lotteryPrize,lotteryRewardTable,LOTTERY_CHUNK,binomial,aggregateLottery} from '../lottery.mjs';
test('batch outcome weights preserve the exact 3-of-9 lottery distribution',()=>{
  let roll=0;const counts=lotterySummary(84,()=>roll++);assert.deepEqual(counts,[20,45,18,1]);// 기본 보상: 1등 300 EXP+300 PT, 2등 150 EXP, 3등 50 PT → EXP 18×150+300=3,000 / PT 45×50+300=2,550
  assert.deepEqual(lotteryPrize(counts,lotteryRewardTable(defaults())),{exp:3000,pt:2550});
});
function setup(count){const store=new Store();store.create('a','A');const time=Date.parse('2026-11-16T00:00:00Z');store.transaction('a',r=>{r.users.u={id:'u',name:'팬',month:'2026-11',tickets:count,exp:0,pt:0,lastCommand:0,daily:{day:'2026-11-16'}};});const engine=new Engine(store,{now:()=>time,int:()=>0});return {store,engine,event:{id:'batch',message:'!복권 자동',user:{id:'u',nickname:'팬'}}};}
test('batch lottery consumes all held tickets atomically and replay never adds EXP',()=>{
  const f=setup(9);const out=f.engine.handle('a',f.event);assert.match(out.text,/9장 사용/);let u=f.store.load('a').users.u;assert.equal(u.tickets,0);assert.equal(u.exp,2700);assert.equal(f.engine.handle('a',f.event).duplicate,true);assert.equal(f.store.load('a').users.u.exp,2700);f.store.db.close();
});
test('large lottery yields before committing and refuses to spend a changed balance',async()=>{
  const f=setup(LOTTERY_CHUNK+1);const pending=f.engine.handleAsync('a',f.event);f.store.transaction('a',r=>r.users.u.tickets++);const out=await pending;assert.match(out.text,/수량이 변경/);const u=f.store.load('a').users.u;assert.equal(u.tickets,LOTTERY_CHUNK+2);assert.equal(u.exp,0);f.store.db.close();
});

test('ticket reset cancels an in-flight automatic draw without awarding EXP',async()=>{
  const f=setup(LOTTERY_CHUNK+1),pending=f.engine.handleAsync('a',{...f.event,isDj:true});
  f.engine.handle('a',{id:'reset',message:'!복권 초기화 @u',isDj:true,user:{id:'dj',nickname:'DJ'}});
  const result=await pending;assert.match(result.text,/복권이 부족/);
  const user=f.store.load('a').users.u;assert.equal(user.tickets,0);assert.equal(user.exp,0);f.store.db.close();
});

test('reset and regrant of the same balance cannot let an older draw spend newly granted tickets',async()=>{
  const count=LOTTERY_CHUNK+1,f=setup(count),pending=f.engine.handleAsync('a',{...f.event,isDj:true});
  f.engine.handle('a',{id:'reset-new',message:'!복권 초기화 @u',isDj:true,user:{id:'dj',nickname:'DJ'}});
  f.engine.handle('a',{id:'grant-new',message:`!복권지급 @u ${count}`,isDj:true,user:{id:'dj',nickname:'DJ'}});
  const result=await pending;assert.match(result.text,/수량이 변경/);
  assert.equal(f.store.load('a').users.u.tickets,count);assert.equal(f.store.load('a').users.u.exp,0);f.store.db.close();
});
test('large lottery commits all tickets and one summary after yielding',async()=>{
  const f=setup(LOTTERY_CHUNK+1);const out=await f.engine.handleAsync('a',f.event);assert.match(out.text,/10,001장 사용/);const u=f.store.load('a').users.u;assert.equal(u.tickets,0);assert.equal(u.exp,300*(LOTTERY_CHUNK+1));assert.equal(u.pt,300*(LOTTERY_CHUNK+1));assert.equal(f.store.logs('a').filter(l=>l.type==='lottery').length,1);f.store.db.close();
});

function seeded(){let state=123456789;return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return ((state>>>0)+.5)/4294967296;};}
test('recursive binomial sampler preserves means, variance and integer support',()=>{
  const random=seeded();
  for(const [n,p]of [[10,.1],[1000,.5],[1000000,1/84],[1000,.9]]){
    const size=20000,mean=n*p,variance=n*p*(1-p);let sum=0,squared=0;
    for(let i=0;i<size;i++){const x=binomial(n,p,random);assert.ok(Number.isSafeInteger(x)&&x>=0&&x<=n);sum+=x;squared+=(x-mean)**2;}
    assert.ok(Math.abs(sum/size-mean)<6*Math.sqrt(variance/size));
    assert.ok(Math.abs(squared/size/variance-1)<.08);
  }
});
test('500 trillion tickets use bounded sampling work and category counts keep the original probabilities',()=>{
  const random=seeded();let calls=0;const count=500000000650000;
  const counts=aggregateLottery(count,(a,b)=>{calls++;assert.ok(calls<2000);return a+Math.floor(random()*(b-a+1));});
  assert.equal(counts.reduce((a,b)=>a+b,0),count);
  for(const [i,weight]of [20,45,18,1].entries()){
    const p=weight/84;assert.ok(Number.isSafeInteger(counts[i])&&counts[i]>=0);
    assert.ok(Math.abs(counts[i]-count*p)<8*Math.sqrt(count*p*(1-p)));
  }
});
test('huge automatic draws finish promptly and EXP overflow never spends tickets',async()=>{
  const count=500000000650000,f=setup(count),random=seeded();let calls=0;
  f.engine.int=(a,b)=>{calls++;assert.ok(calls<2000);return a+Math.floor(random()*(b-a+1));};
  const out=await f.engine.handleAsync('a',f.event);assert.match(out.text,/경험치.*범위/);
  assert.equal(f.store.load('a').users.u.tickets,count);assert.equal(f.store.load('a').users.u.exp,0);
  assert.equal(f.store.logs('a').filter(l=>l.type==='lottery').length,0);f.store.db.close();
});
test('aggregate automatic draw consumes every ticket, records outcome counts and deduplicates',async()=>{
  const count=1000000000,f=setup(count),random=seeded();
  f.engine.int=(a,b)=>a+Math.floor(random()*(b-a+1));
  await f.engine.handleAsync('a',f.event);
  const user=f.store.load('a').users.u,log=f.store.logs('a').find(l=>l.type==='lottery');
  assert.equal(user.tickets,0);assert.equal(log.data.counts.reduce((a,b)=>a+b,0),count);
  const prize=lotteryPrize(log.data.counts,lotteryRewardTable(defaults()));assert.equal(user.exp,prize.exp);assert.equal(user.pt,prize.pt);
  assert.equal((await f.engine.handleAsync('a',f.event)).duplicate,true);assert.equal(f.store.load('a').users.u.exp,user.exp);f.store.db.close();
});
