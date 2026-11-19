import test from 'node:test';import assert from 'node:assert/strict';
import {splitTop,parseStatus,affects,warningReply,alertShort,KmaWarnings} from '../weather-warnings.mjs';
import {briefingReply} from '../weather-extras.mjs';
import {Lifestyle} from '../lifestyle.mjs';

// 2026-11-19 10:00 발표 실제 getPwnStatus 응답(요약 없이 원문 그대로)
const T6=['o 강풍주의보 : 서해5도, 충청남도(태안, 서천, 보령(도서제외), 보령도서), 전라남도(여수, 영암, 함평, 목포, 신안(흑산면제외), 진도, 흑산도.홍도, 거문도.초도, 영광(낙월면 제외), 영광낙월면, 고흥북부, 고흥남부, 해남북부, 해남남부, 완도(여서도 제외), 완도여서도, 무안북부, 무안남부), 전북자치도(부안위도면, 군산(옥도면 제외), 군산옥도면(어청도 제외), 군산어청도), 제주도(서귀포시남부 제외), 인천(옹진, 인천영종), 울릉도.독도',
 'o 풍랑경보 : 동해남부북쪽안쪽먼바다, 동해남부북쪽바깥먼바다, 동해중부안쪽먼바다, 동해중부바깥먼바다',
 'o 풍랑주의보 : 동해남부남쪽안쪽먼바다, 서해전해상, 제주도앞바다(제주도북부앞바다, 제주도동부앞바다, 제주도서부앞바다), 제주도남쪽바깥먼바다'].join('\r\n');
const T7='(1) 대설 예비특보\r\no 11월 19일 밤(18시~24시) : 제주도(제주도산지)\r\n(2) 강풍 예비특보\r\no 11월 20일 새벽(00시~06시) : 경상북도(영양산지, 봉화산지, 울진산지)\r\n(3) 풍랑 예비특보\r\no 11월 20일 새벽(00시~06시) : 제주도앞바다(제주도남부앞바다)';
const ITEM={other:'o 없음\r\n\r\n',t6:T6,t7:T7,tmEf:202611191200,tmFc:202611191000,tmSeq:121};
const status=parseStatus(ITEM);
const NOW=Date.parse('2026-11-19T01:30:00Z');
const api=(over={})=>async input=>{
 const url=new URL(input);if(!url.pathname.endsWith('/getPwnStatus'))throw Error('unexpected '+url.pathname);
 if(over.deny)return {ok:false,status:403,json:async()=>({OpenAPI_ServiceResponse:{cmmMsgHeader:{errMsg:'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'}}})};
 return {ok:true,status:200,json:async()=>({response:{header:{resultCode:'00',resultMsg:'NORMAL_SERVICE'},body:{items:{item:over.array?[ITEM]:ITEM},totalCount:1}}})};
};

test('areas are split only at top-level commas and parsed into names and sub-areas',()=>{
 assert.deepEqual(splitTop('서해5도, 충청남도(태안, 보령(도서제외), 보령도서), 인천(옹진)'),['서해5도','충청남도(태안, 보령(도서제외), 보령도서)','인천(옹진)']);
 assert.equal(status.time,'11-19 10:00');assert.deepEqual(status.current.map(line=>line.type),['강풍주의보','풍랑경보','풍랑주의보']);
 assert.deepEqual(status.preliminary.map(entry=>[entry.type,entry.when]),[['대설 예비특보','11월 19일 밤(18시~24시)'],['강풍 예비특보','11월 20일 새벽(00시~06시)'],['풍랑 예비특보','11월 20일 새벽(00시~06시)']]);
 assert.deepEqual(status.current[0].areas.map(area=>area.name),['서해5도','충청남도','전라남도','전북자치도','제주도','인천','울릉도.독도']);
 assert.deepEqual(parseStatus({}).current,[]);
});
test('a region is affected only when its province is listed, cities by name, and excluded areas do not count',()=>{
 const wind=status.current[0].areas;
 assert.deepEqual(affects(wind,'충남'),{hit:true,subs:['태안','서천','보령','보령도서'],whole:false});
 assert.equal(affects(wind,'전남').hit,true);assert.ok(affects(wind,'전남').subs.includes('목포')&&affects(wind,'전남').subs.includes('신안'));
 assert.deepEqual([affects(wind,'목포','목포').hit,affects(wind,'여수','여수').hit,affects(wind,'순천','순천').hit],[true,true,false]);
 assert.deepEqual(affects(wind,'제주'),{hit:true,subs:[],whole:true}); // 서귀포시남부만 제외한 제주도 전체
 assert.equal(affects(wind,'서귀포','서귀포').hit,false);assert.deepEqual(affects(wind,'인천').subs,['옹진','인천영종']);
 assert.deepEqual([affects(wind,'서울').hit,affects(wind,'부산').hit,affects(wind,'경기').hit],[false,false,false]);
 assert.equal(affects(status.current[2].areas,'제주').hit,false); // 제주도앞바다(해상)는 육상 제주도가 아님
 assert.equal(affects(status.preliminary[1].areas,'경북').hit,true);
});
test('replies fit Spoon 200 characters and cover active, preliminary and no warnings',()=>{
 const south=warningReply('전남','전남',status);
 assert.match(south,/^전남 기상특보 · 11-19 10:00 발표\n강풍주의보: 여수·영암·함평·목포.* 외 \d+곳\n기상청 · KST$/);assert.ok(south.length<=200,south);
 assert.equal(warningReply('목포','목포',status,'목포'),'목포(전남) 기상특보 · 11-19 10:00 발표\n강풍주의보 (목포 포함)\n기상청 · KST');
 assert.equal(warningReply('순천','순천',status,'순천'),'순천(전남)에 발효 중인 기상특보가 없어요 (11-19 10:00 발표 기준)\n기상청 · KST');
 assert.equal(warningReply('서울','서울',status),'서울에 발효 중인 기상특보가 없어요 (11-19 10:00 발표 기준)\n기상청 · KST');
 assert.equal(warningReply('경북','경북',status),'경북 기상특보 · 11-19 10:00 발표\n발효 중인 특보 없음\n예비특보: 강풍 11월 20일 새벽\n기상청 · KST');
 assert.equal(warningReply('제주','제주',status),'제주 기상특보 · 11-19 10:00 발표\n강풍주의보\n예비특보: 대설 11월 19일 밤\n기상청 · KST');
 assert.deepEqual([alertShort('전남',status),alertShort('서울',status),alertShort('인천',status),alertShort('목포',status,'목포'),alertShort('순천',status,'순천')],['⚠ 강풍주의보 발효 중',null,'⚠ 강풍주의보 발효 중','⚠ 강풍주의보 발효 중',null]);
});
test('the status request is cached for five minutes and failures explain themselves without the key',async()=>{
 let time=NOW,calls=0;const counting=async input=>{calls++;return api()(input);};
 const client=new KmaWarnings({fetcher:counting,now:()=>time,key:'secret-warn-key'});
 assert.equal((await client.status()).time,'11-19 10:00');await client.status();assert.equal(calls,1);time+=6*60000;await client.status();assert.equal(calls,2);
 assert.equal((await new KmaWarnings({fetcher:api({array:true}),now:()=>NOW,key:'k'}).status()).current.length,3);
 await assert.rejects(new KmaWarnings({fetcher:api({deny:true}),now:()=>NOW,key:'secret-warn-key'}).status(),error=>/HTTP 403 SERVICE_KEY_IS_NOT_REGISTERED_ERROR/.test(error.message)&&!error.message.includes('secret-warn-key'));
});
test('an URL-encoded service key is decoded once so it is not double-encoded',async()=>{
 const seen=[];await new KmaWarnings({fetcher:async input=>{seen.push(new URL(input));return api()(input);},now:()=>NOW,key:'abc%2Bdef%3D'}).status();
 assert.equal(seen[0].searchParams.get('serviceKey'),'abc+def=');assert.equal(seen[0].searchParams.get('stnId'),'108');
});
test('briefing shows an active warning first and chat commands answer, need a key and explain a missing approval',async()=>{
 assert.match(briefingReply('전남',{now:NOW,alert:'⚠ 강풍주의보 발효 중',day:{min:1,max:9}}),/^전남 오늘 브리핑 · 11-19\(목\)\n⚠ 강풍주의보 발효 중\n최저 1 · 최고 9℃/);
 const service=new Lifestyle({weatherSource:'kma',now:()=>NOW,kmaKey:'secret-warn-key',fetcher:api()});
 assert.match(await service.answer({kind:'날씨',arg:'전남 특보'}),/^전남 기상특보 · 11-19 10:00 발표\n강풍주의보: /);
 assert.match(await service.answer({kind:'날씨',arg:'목포 특보'}),/^목포\(전남\) 기상특보/);assert.match(await service.answer({kind:'날씨',arg:'서울 기상특보'}),/^서울에 발효 중인 기상특보가 없어요/);
 assert.match(await service.answer({kind:'날씨',arg:'특보'}),/^서울에 발효 중인/); // 지역을 빼면 기본 지역
 assert.match(await new Lifestyle({now:()=>NOW,fetcher:api()}).answer({kind:'날씨',arg:'서울 특보'}),/서비스키\(KMA_SERVICE_KEY\)와 기상특보 활용신청/);
 const denied=await new Lifestyle({now:()=>NOW,kmaKey:'secret-warn-key',fetcher:api({deny:true})}).answer({kind:'날씨',arg:'서울 특보'});assert.match(denied,/승인이 아직 안 된 것 같아요/);assert.doesNotMatch(denied,/secret-warn-key/);
});
