import test from 'node:test';import assert from 'node:assert/strict';
import {AirKorea,sidoOf,forecastKeys,dustGrade,GRADES,dustReply,dustShort,dustForecastReply,maskAdvice} from '../air-korea.mjs';
import {Lifestyle} from '../lifestyle.mjs';

const NOW=Date.parse('2026-11-19T01:30:00Z'); // 2026-11-19(목) 10:30 KST
const station=(pm10,pm25,time='2026-11-19 10:00')=>({stationName:'가',sidoName:'서울',dataTime:time,pm10Value:String(pm10),pm25Value:String(pm25)});
// 에어코리아 응답을 흉내 내는 fetcher: 시도별 실시간(서울 평균 PM10 50·PM2.5 40), 예보통보(내일 서울 보통/나쁨).
function air({deny=false,empty=false,calls=[]}={}){
 const envelope=items=>({ok:true,status:200,json:async()=>({response:{header:{resultCode:'00',resultMsg:'NORMAL_SERVICE'},body:{items,totalCount:items.length}}})});
 return async input=>{
  const url=new URL(input);calls.push(url);
  if(deny)return {ok:false,status:403,json:async()=>({OpenAPI_ServiceResponse:{cmmMsgHeader:{errMsg:'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'}}})};
  if(url.pathname.endsWith('getCtprvnRltmMesureDnsty'))return envelope(empty?[station('-','-')]:[station(40,30),station(50,40),station(60,50),station('-','-'),station(70,'-')]);
  if(url.pathname.endsWith('getMinuDustFrcstDspth')){
   const grade=url.searchParams.get('informCode')==='PM10'?'서울 : 보통,경기남부 : 나쁨,경기북부 : 보통,영서 : 좋음,영동 : 보통,제주 : 좋음':'서울 : 나쁨,경기남부 : 매우나쁨,경기북부 : 나쁨,영서 : 보통,영동 : 보통,제주 : 보통'; // 강원 권역은 실제 응답처럼 영동·영서
   return envelope([{informData:'2026-11-19',dataTime:'2026-11-19 05시 발표',informGrade:'서울 : 좋음'},{informData:'2026-11-20',dataTime:'2026-11-19 05시 발표',informGrade:'서울 : 좋음'},{informData:'2026-11-20',dataTime:'2026-11-19 17시 발표',informGrade:grade}]);
  }
  throw Error('unexpected '+url.pathname);
 };
}
test('dust grades follow the 4-level standard and the sido mapping covers regions and cities',()=>{
 assert.deepEqual([0,30,31,80,81,150,151].map(value=>GRADES[dustGrade('pm10',value)]),['좋음','좋음','보통','보통','나쁨','나쁨','매우나쁨']);
 assert.deepEqual([0,15,16,35,36,75,76].map(value=>GRADES[dustGrade('pm25',value)]),['좋음','좋음','보통','보통','나쁨','나쁨','매우나쁨']);
 assert.equal(dustGrade('pm10',null),null);assert.equal(dustGrade('pm10',Number.NaN),null);
 assert.deepEqual(['서울','제주','성남','목포','서귀포','강릉','없는곳'].map(sidoOf),['서울','제주','경기','전남','제주','강원',null]);
 assert.deepEqual([forecastKeys('성남'),forecastKeys('고양'),forecastKeys('강릉'),forecastKeys('원주'),forecastKeys('부산'),forecastKeys('없는곳')],[['경기남부','경기'],['경기북부','경기'],['영동','강원영동','강원'],['영서','강원영서','강원'],['부산'],[]]);
});
test('realtime readings average the valid stations, skip missing values and cache for 20 minutes',async()=>{
 const calls=[];let time=NOW;const client=new AirKorea({fetcher:air({calls}),now:()=>time,key:'secret-air-key'});
 const data=await client.realtime('서울');
 assert.deepEqual(data,{sido:'서울',time:'2026-11-19 10:00',pm10:55,pm25:40,stations:4}); // PM10 40·50·60·70 → 55, PM2.5 30·40·50 → 40
 await client.realtime('서울');assert.equal(calls.length,1);assert.equal(calls[0].searchParams.get('sidoName'),'서울');assert.equal(calls[0].searchParams.get('returnType'),'json');
 time+=19*60000;await client.realtime('서울');assert.equal(calls.length,1);time+=2*60000;await client.realtime('서울');assert.equal(calls.length,2); // 20분 캐시
 await assert.rejects(new AirKorea({fetcher:air({empty:true}),now:()=>NOW,key:'k'}).realtime('서울'),/측정값이 아직 없어요/);
 await assert.rejects(new AirKorea({fetcher:air({deny:true}),now:()=>NOW,key:'secret-air-key'}).realtime('서울'),error=>/HTTP 403 SERVICE_KEY_IS_NOT_REGISTERED_ERROR/.test(error.message)&&!error.message.includes('secret-air-key'));
});
test('forecast notices pick the latest issue for the day and the matching sub-region',async()=>{
 const client=new AirKorea({fetcher:air(),now:()=>NOW,key:'k'});
 assert.deepEqual(await client.forecast('서울','2026-11-20','2026-11-19'),{pm10:'보통',pm25:'나쁨'});
 assert.deepEqual(await client.forecast('성남','2026-11-20','2026-11-19'),{pm10:'나쁨',pm25:'매우나쁨'});assert.deepEqual(await client.forecast('고양','2026-11-20','2026-11-19'),{pm10:'보통',pm25:'나쁨'});
 assert.deepEqual(await client.forecast('강릉','2026-11-20','2026-11-19'),{pm10:'보통',pm25:'보통'});assert.deepEqual(await client.forecast('서울','2026-11-21','2026-11-19'),{pm10:null,pm25:null}); // 아직 발표 전
});
test('dust replies fit Spoon 200 characters and advise masks only for bad air',()=>{
 const data={sido:'서울',time:'2026-11-19 10:00',pm10:55,pm25:40,stations:4};
 assert.equal(dustReply('서울',data),'서울 미세먼지 · 10:00 기준 (측정소 4곳 평균)\n미세먼지 보통(PM10 55㎍/㎥) · 초미세먼지 나쁨(PM2.5 40㎍/㎥)\n외출 시 마스크(KF94)를 권장해요\n에어코리아 · 한국환경공단');
 assert.match(dustReply('서울',{...data,pm10:20,pm25:10}),/야외 활동에 큰 문제 없어요/);assert.match(dustReply('서울',{...data,pm25:null}),/초미세먼지 측정값 없음/);
 assert.equal(dustShort(data),'미세먼지 보통 · 초미세먼지 나쁨');assert.equal(maskAdvice({pm10:100,pm25:10}),'외출 시 마스크(KF94)를 권장해요');
 assert.equal(dustForecastReply('서울','내일',{pm10:'보통',pm25:'나쁨'}),'서울 내일 미세먼지 예보\n미세먼지 보통 · 초미세먼지 나쁨\n에어코리아 예보통보');assert.match(dustForecastReply('서울','내일',{pm10:null,pm25:null}),/아직 발표되지 않았어요/);
 assert.ok(dustReply('서울(경기)',data).length<=200);
});
test('an URL-encoded service key is decoded once so it is not double-encoded',async()=>{
 const calls=[],client=new AirKorea({fetcher:air({calls}),now:()=>NOW,key:' abc%2Bdef%3D '});await client.realtime('서울');
 assert.equal(calls[0].searchParams.get('serviceKey'),'abc+def='); // 운영 키가 Encoding 형태여도 한 번만 인코딩됩니다
});
test('chat commands answer dust now and tomorrow, need a key, and explain a missing approval',async()=>{
 const calls=[],service=new Lifestyle({now:()=>NOW,kmaKey:'secret-air-key',fetcher:air({calls})});
 assert.match(await service.answer({kind:'날씨',arg:'서울 미세먼지'}),/^서울 미세먼지 · 10:00 기준 \(측정소 4곳 평균\)\n미세먼지 보통\(PM10 55㎍\/㎥\) · 초미세먼지 나쁨/);
 assert.match(await new Lifestyle({weatherSource:'kma',now:()=>NOW,kmaKey:'secret-air-key',fetcher:air({calls})}).answer({kind:'날씨',arg:'성남 미세먼지'}),/^성남\(경기\) 미세먼지/); // 시·군은 소속 시도 기준
 assert.equal(await service.answer({kind:'날씨',arg:'서울 내일 미세먼지'}),'서울 내일 미세먼지 예보\n미세먼지 보통 · 초미세먼지 나쁨\n에어코리아 예보통보');
 assert.match(await service.answer({kind:'날씨',arg:'미세먼지'}),/^서울 미세먼지/); // 지역을 빼면 기본 지역
 assert.match(await new Lifestyle({now:()=>NOW,fetcher:air()}).answer({kind:'날씨',arg:'서울 미세먼지'}),/서비스키\(KMA_SERVICE_KEY\)와 에어코리아 활용신청/);
 const denied=await new Lifestyle({now:()=>NOW,kmaKey:'secret-air-key',fetcher:air({deny:true})}).answer({kind:'날씨',arg:'서울 미세먼지'});assert.match(denied,/승인이 아직 안 된 것 같아요/);assert.doesNotMatch(denied,/secret-air-key/);
});
