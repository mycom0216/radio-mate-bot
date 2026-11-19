import test from 'node:test';
import assert from 'node:assert/strict';
import {Lifestyle} from '../lifestyle.mjs';
import {diningRegions,diningAreaCount,diningGuideReply} from '../public/dining-guide.mjs';
const item=(title,address='서울 테스트구')=>({title,roadAddress:address,category:'음식점',link:'javascript:unsafe'});
test('nationwide guide covers 17 provinces, 136 distinct regional searches and bounded chat pages',async()=>{
 assert.equal(diningRegions.length,17);assert.equal(diningAreaCount,136);
 assert.equal(new Set(diningRegions.flatMap(x=>x.areas.map(a=>x.name+' '+a))).size,136);
 const service=new Lifestyle();
 for(let page=1;page<=5;page++){const text=await service.answer({kind:'맛집',arg:`전국 ${page}`});assert.ok(text.length<=200);assert.match(text,new RegExp(`${page}/5`));}
 assert.match(diningGuideReply(6),/1~5/);assert.match(await service.answer({kind:'맛집',arg:''}),/전국 맛집 탐색/);
});
test('expanded searches stay within provider limit, merge distinct restaurants and coalesce concurrent requests',async()=>{
 let calls=0;const queries=[];
 const service=new Lifestyle({clientId:'id',clientSecret:'secret',fetcher:async url=>{const batch=++calls;queries.push(url.searchParams.get('query'));assert.equal(url.searchParams.get('display'),'5');return {ok:true,json:async()=>({items:[item('공통 식당'),...Array.from({length:4},(_,i)=>item(`검색${batch} 식당${i}`))]})};}});
 const input={region:'부산',foodType:'국밥',extended:true};
 const [a,b]=await Promise.all([service.places(input),service.places(input)]);
 assert.equal(calls,3);assert.equal(new Set(queries).size,3);assert.equal(a,b);assert.equal(a.items.length,13);assert.ok(a.items.every(x=>x.originalUrl===''&&x.matchedQuery.includes('부산')));assert.equal(a.partial,false);
 await service.places(input);assert.equal(calls,3);assert.ok(!JSON.stringify(a).includes('secret'));assert.equal(a.items[0].rating,undefined);
});
test('branch addresses are preserved while whitespace duplicates are removed',async()=>{
 const service=new Lifestyle({clientId:'id',clientSecret:'secret',fetcher:async()=>({ok:true,json:async()=>({items:[item('밥집','서울 가'),item('밥 집','서울 가'),item('밥집','서울 나')]})})});
 assert.equal((await service.places({region:'서울',extended:true})).items.length,2);
});
test('missing keys still provide food-specific map search without remote calls',async()=>{
 const result=await new Lifestyle({fetcher:()=>{throw Error('must not call');}}).places({region:'제주 애월',foodType:'해산물',extended:true});
 assert.equal(result.configured,false);assert.equal(result.items.length,0);assert.match(decodeURIComponent(result.searchUrl),/제주 애월.*해산물/);
});
test('validation rejects unknown food categories and unbounded expansion values before remote calls',async()=>{
 const service=new Lifestyle({fetcher:()=>{throw Error('must not call');}});
 await assert.rejects(service.places({region:'서울',foodType:'<script>'}),/종류/);
 await assert.rejects(service.places({region:'서울',extended:'100'}),/설정/);
});
test('expanded search surfaces authentication failure instead of returning empty success',async()=>{
 let calls=0;const service=new Lifestyle({clientId:'id',clientSecret:'secret',fetcher:async()=>{calls++;return {ok:false,status:401};}});
 await assert.rejects(service.places({region:'서울',extended:true}),/인증/);assert.equal(calls,1);
});
test('secondary search failure returns verified primary items with an explicit partial indicator',async()=>{
 let calls=0;const service=new Lifestyle({clientId:'id',clientSecret:'secret',fetcher:async()=>++calls===1?{ok:true,json:async()=>({items:[item('확인된 식당')]})}:{ok:false,status:400}});
 const r=await service.places({region:'서울',extended:true});assert.equal(r.items.length,1);assert.equal(r.partial,true);assert.equal(calls,3);
});
test('different food categories have separate cache entries',async()=>{
 let calls=0;const service=new Lifestyle({clientId:'id',clientSecret:'secret',fetcher:async()=>{calls++;return {ok:true,json:async()=>({items:[]})};}});
 await service.places({region:'서울',foodType:'초밥'});await service.places({region:'서울',foodType:'한식'});assert.equal(calls,2);
});
