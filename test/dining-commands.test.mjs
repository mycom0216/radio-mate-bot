import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {Lifestyle,assistantRequest} from '../lifestyle.mjs';
import {diningQuery} from '../dining.mjs';
import {Outbox} from '../outbox.mjs';

function fixture(t){
 const store=new Store();t.after(()=>store.db.close());store.create('a','A');store.create('b','B');
 let now=1805600000000,id=0;const engine=new Engine(store,{now:()=>now}),calls=[];
 engine.lifestyle={answer:async request=>{assert.equal(store.db.isTransaction,false);calls.push(request);return '확인된 장소 검색 결과';}};
 const say=(message,extra={})=>engine.handleAsync(extra.room||'a',{id:'dining-'+(++id),user:{id:'u',nickname:'청취자'},message,...extra});
 return {store,engine,calls,say,advance:ms=>now+=ms};
}

test('all restaurant and cafe aliases canonicalize including fullwidth input and optional recommendation word',()=>{
 for(const alias of ['맛집','맛집추천','추천맛집'])for(const bang of ['!','！'])assert.deepEqual(assistantRequest(bang+alias+' 광주 동명동'),{kind:'맛집',arg:'광주 동명동'});
 for(const alias of ['카페','카페추천','추천카페'])assert.deepEqual(assistantRequest('! '+alias+' 광주 동명동'),{kind:'카페',arg:'광주 동명동'});
 assert.deepEqual(assistantRequest('!카페 추천'),{kind:'카페',arg:''});assert.equal(assistantRequest('!카페테리아'),null);
 assert.deepEqual(diningQuery('부산 국밥 점심','맛집'),{region:'부산',foodType:'국밥',meal:'점심'});
 assert.equal(diningQuery('광주 아침고요동','맛집').region,'광주 아침고요동');
});

test('registered listener can answer cafe region immediately despite normal command cooldown, once only',async t=>{
 const f=fixture(t);await f.say('!내정보 생성');f.advance(30000);
 assert.match((await f.say('!카페추천')).text,/지역을 입력/);assert.equal(f.calls.length,0);
 assert.equal((await f.say('광주 동명동')).text,'확인된 장소 검색 결과');assert.deepEqual(f.calls,[{kind:'카페',arg:'광주 동명동'}]);
 assert.equal((await f.say('광주 양림동')).text,null);assert.equal(f.calls.length,1);assert.equal(f.engine.diningPrompts.size,0);
});

test('region conversations are scoped to room and listener and preserve a selected meal',async t=>{
 const f=fixture(t);assert.match((await f.say('!맛집추천 점심')).text,/지역/);
 await f.say('부산 국밥',{user:{id:'v'}});await f.say('부산 국밥',{room:'b'});assert.equal(f.calls.length,0);
 await f.say('광주 동명동');assert.deepEqual(f.calls,[{kind:'맛집',arg:'점심 광주 동명동'}]);
});

test('cancel, expiration and another command end region selection without unintended searches',async t=>{
 const f=fixture(t);await f.say('!카페');assert.match((await f.say('!취소')).text,/취소/);await f.say('광주');assert.equal(f.calls.length,0);
 f.advance(30000);await f.say('!맛집추천');f.advance(120000);assert.match((await f.say('광주')).text,/시간이 지났/);assert.equal(f.calls.length,0);
 f.advance(30000);await f.say('!맛집');assert.match((await f.say('!내정보',{isDj:true})).text,/청취자/);await f.say('광주');assert.equal(f.calls.length,0);
});

test('quiet and normal rate limits still prevent remote requests while pending region survives quiet mode',async t=>{
 const f=fixture(t);await f.say('!카페');f.store.transaction('a',r=>r.settings.quiet=true);
 assert.equal((await f.say('광주 동명동')).suppressed,'quiet');assert.equal(f.calls.length,0);
 f.store.transaction('a',r=>r.settings.quiet=false);await f.say('광주 동명동');assert.equal(f.calls.length,1);
 assert.equal((await f.say('!카페 광주')).suppressed,'cooldown');assert.equal(f.calls.length,1);
});

test('duplicate region event never repeats search or outbox delivery, and private responses are not stored in events',async t=>{
 const f=fixture(t);await f.say('!카페추천',{delivery:true});
 const event={id:'same-region',user:{id:'u'},message:'광주 동명동',delivery:true};
 assert.equal((await f.engine.handleAsync('a',event)).text,'확인된 장소 검색 결과');
 assert.equal((await f.engine.handleAsync('a',event)).duplicate,true);assert.equal(f.calls.length,1);
 assert.equal(new Outbox(f.store).list('a').length,2);
 const saved=JSON.parse(f.store.db.prepare('SELECT result FROM events WHERE id=?').get(event.id).result);assert.deepEqual(saved,{text:null,assistant:true});
 assert.ok(!JSON.stringify(f.store.load('a')).includes('동명동'));
});

test('backend failure becomes a reply without disconnecting the incoming event loop',async t=>{
 const f=fixture(t);f.engine.lifestyle.answer=async()=>{throw Error('sensitive internal failure');};
 const result=await f.say('!카페 광주');assert.match(result.text,/다시 입력/);assert.doesNotMatch(result.text,/sensitive/);
});

test('missing region, national guide and help work for both kinds without network calls',async()=>{
 const service=new Lifestyle({fetcher:()=>{throw Error('unexpected request');}});
 for(const kind of ['맛집','카페']){
  assert.match(await service.answer({kind,arg:''}),/지역을 입력/);
  assert.match(await service.answer({kind,arg:'전국 2'}),/2\/5/);
  assert.match(await service.answer({kind,arg:'도움말'}),/지역/);
 }
});

test('normal Korean region search keeps verified names instead of rejecting a long encoded map URL',async()=>{
 const queries=[],service=new Lifestyle({clientId:'id',clientSecret:'secret',fetcher:async url=>{queries.push(url.searchParams.get('query'));return {ok:true,json:async()=>({items:[{title:'<b>동명동 카페</b>',roadAddress:'광주광역시 동구 동명동 1'},{title:'확인된 두번째 카페',roadAddress:'광주 동구'}]})};}});
 const text=await service.answer({kind:'카페',arg:'광주 동명동 디저트'});assert.match(text,/동명동 카페/);assert.match(text,/두번째 카페/);assert.doesNotMatch(text,/짧게 입력/);assert.ok(text.length<=200);assert.match(queries[0],/광주 동명동 디저트 카페/);
 const food=await service.answer({kind:'맛집',arg:'부산 국밥 점심'});assert.ok(food.length<=200);assert.match(queries[1],/부산 점심 식사 국밥 맛집/);
});

test('fallback links and missing credentials do not invent businesses and fit Spoon limits',async()=>{
 const service=new Lifestyle({fetcher:()=>{throw Error('must not call');}});
 for(const region of ['서울','광주광역시 동구 동명동 주변의 아주 긴 지역명']){
  const text=await service.answer({kind:'카페',arg:region});assert.match(text,/키 설정/);assert.ok(text.length<=200);
 }
});
