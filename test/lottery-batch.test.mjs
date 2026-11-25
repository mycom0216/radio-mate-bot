import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine,defaults} from '../core.mjs';
import {lotterySummary,lotteryPrize,lotteryRewardTable,LOTTERY_CHUNK,LOTTERY_EXACT_MAX,binomial,aggregateLottery,drawLottery} from '../lottery.mjs';
test('batch outcome weights preserve the exact 3-of-9 lottery distribution',()=>{
  let roll=0;const counts=lotterySummary(84,()=>roll++);assert.deepEqual(counts,[20,45,18,1]);// 기본 보상: 1등 300 EXP+300 PT, 2등 150 EXP, 3등 50 PT → EXP 18×150+300=3,000 / PT 45×50+300=2,550
  assert.deepEqual(lotteryPrize(counts,lotteryRewardTable(defaults())),{exp:3000,pt:2550});
});
function setup(count){const store=new Store();store.create('a','A');const time=Date.parse('2026-11-16T00:00:00Z');store.transaction('a',r=>{r.users.u={id:'u',name:'팬',month:'2026-11',tickets:count,exp:0,pt:0,lastCommand:0,daily:{day:'2026-11-16'}};});const engine=new Engine(store,{now:()=>time,int:()=>0});return {store,engine,event:{id:'batch',message:'!복권 자동',user:{id:'u',nickname:'팬'}}};}
test('batch lottery consumes all held tickets atomically and replay never adds EXP',()=>{
  const f=setup(9);const out=f.engine.handle('a',f.event);assert.match(out.text,/9장 사용/);let u=f.store.load('a').users.u;assert.equal(u.tickets,0);assert.equal(u.exp,2700);assert.equal(f.engine.handle('a',f.event).duplicate,true);assert.equal(f.store.load('a').users.u.exp,2700);f.store.db.close();
});
// ───── 대량 복권은 비동기 준비 없이 어디서든 바로 추첨합니다 ─────
test('large lottery runs right away without any async preparation and uses every ticket',()=>{
  const f=setup(LOTTERY_CHUNK+1);const out=f.engine.handle('a',f.event);        // 동기 handle로도 대량 추첨이 됩니다. (예전에는 "비동기 처리로 실행해주세요" 오류)
  assert.match(out.text,/자동 복권 10,001장 사용/);assert.doesNotMatch(out.text,/비동기/);
  // 난수가 항상 0인 시험용 엔진이라 등수 분포는 정해져 있지 않으므로, 기록된 등수별 횟수로 보상 합계가 맞는지 확인합니다.
  const u=f.store.load('a').users.u,log=f.store.logs('a').filter(l=>l.type==='lottery');assert.equal(log.length,1);
  const counts=log[0].data.counts,prize=lotteryPrize(counts,lotteryRewardTable(defaults()));
  assert.equal(counts.reduce((x,y)=>x+y,0),LOTTERY_CHUNK+1);assert.equal(u.tickets,0);assert.equal(u.exp,prize.exp);assert.equal(u.pt,prize.pt);f.store.db.close();
});
test('handleAsync gives the same result as handle for large lotteries (no separate prepare step)',async()=>{
  const sync=setup(LOTTERY_CHUNK+1),asy=setup(LOTTERY_CHUNK+1);
  const a=sync.engine.handle('a',sync.event),b=await asy.engine.handleAsync('a',asy.event);
  assert.equal(a.text,b.text);assert.equal(sync.store.load('a').users.u.exp,asy.store.load('a').users.u.exp);sync.store.db.close();asy.store.db.close();
});
test('regression: a large !복권 자동 arriving inside the response gap (queued, not dropped) no longer fails',async()=>{
  const f=setup(LOTTERY_CHUNK+1);f.store.transaction('a',r=>{r.lastResponse=Date.parse('2026-11-16T00:00:00Z')-500;}); // 봇이 0.5초 전에 답해 응답 간격(3초) 안
  const out=await f.engine.handleAsync('a',{...f.event,delivery:true});
  assert.match(out.text,/자동 복권 10,001장 사용/);assert.doesNotMatch(out.text,/비동기|수량이 변경/);
  assert.equal(f.store.load('a').users.u.tickets,0);f.store.db.close();
});
test('after a ticket reset there is nothing to draw, and a regrant is drawn in full',()=>{
  const count=LOTTERY_CHUNK+1,f=setup(count),dj={isDj:true,user:{id:'dj',nickname:'DJ'}};
  f.engine.handle('a',{id:'reset',message:'!복권 초기화 @u',...dj});
  const empty=f.engine.handle('a',{...f.event,id:'after-reset',isDj:true});assert.match(empty.text,/복권이 부족/);assert.equal(f.store.load('a').users.u.exp,0);
  f.engine.handle('a',{id:'regrant',message:`!복권지급 @u ${count}`,...dj});
  const out=f.engine.handle('a',{...f.event,id:'after-regrant',isDj:true});
  assert.match(out.text,/10,001장 사용/);const u=f.store.load('a').users.u,log=f.store.logs('a').find(l=>l.type==='lottery');
  assert.equal(u.tickets,0);assert.equal(log.data.used,count);assert.equal(u.exp,lotteryPrize(log.data.counts,lotteryRewardTable(defaults())).exp);f.store.db.close();
});
test('drawLottery: exact one-by-one draw up to 1,000 tickets, aggregate sampling above it, always instant',()=>{
  let calls=0;const counting=(min,max)=>{calls++;return min+(calls*7)%(max-min+1);};
  const small=drawLottery(LOTTERY_EXACT_MAX,counting);assert.equal(calls,LOTTERY_EXACT_MAX);assert.equal(small.reduce((x,y)=>x+y,0),LOTTERY_EXACT_MAX);
  calls=0;const big=drawLottery(LOTTERY_EXACT_MAX+1,counting);assert.ok(calls<200,`합산 방식은 난수를 조금만 씁니다: ${calls}`);assert.equal(big.reduce((x,y)=>x+y,0),LOTTERY_EXACT_MAX+1);
  for(const count of [1,2,999,1001,10001,1e6,1e9,1e12,5e14]){const start=performance.now(),counts=drawLottery(count,(a,b)=>a+Math.floor(Math.random()*(b-a+1)));
    assert.equal(counts.reduce((x,y)=>x+y,0),count);assert.ok(counts.every(x=>Number.isSafeInteger(x)&&x>=0));assert.ok(performance.now()-start<50,`${count}장: ${performance.now()-start}ms`);}
});
test('large lottery shares the same distribution as the one-by-one draw (mean of category counts)',()=>{
  const trials=400,n=5000,sums=[0,0,0,0];for(let i=0;i<trials;i++){const counts=drawLottery(n,(a,b)=>a+Math.floor(Math.random()*(b-a+1)));counts.forEach((x,k)=>sums[k]+=x);}
  [20,45,18,1].forEach((weight,k)=>{const p=weight/84,mean=n*p,sd=Math.sqrt(n*p*(1-p)/trials);assert.ok(Math.abs(sums[k]/trials-mean)<6*sd,`카테고리 ${k}: ${sums[k]/trials} vs ${mean}`);});
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
