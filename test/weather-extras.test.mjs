import test from 'node:test';import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {sunTimes,sunReply,feelsLike,currentLine,outfitFor,outfitReply,hourlyReply,umbrellaReply,briefingReply,yesterdayReply,expandWeatherTokens,weatherHelp} from '../weather-extras.mjs';
import {parseWeatherQuery} from '../weather-periods.mjs';
import {assistantRequest} from '../lifestyle.mjs';

const NOW=Date.parse('2026-11-19T15:15:00+09:00'); // 2026-11-19(목) 15:15 KST
const row=(date,hour,over={})=>({date,hour,temp:3,tmx:null,tmn:null,pop:0,pty:0,wf:'맑음',...over});

test('sunrise and sunset match the official Seoul values within two minutes and handle polar days',()=>{
 const at=date=>{const t=sunTimes(37.5665,126.978,date);return [Math.round(t.sunrise),Math.round(t.sunset)];};
 const near=(actual,hour,minute)=>assert.ok(Math.abs(actual-(hour*60+minute))<=2,`${actual} vs ${hour}:${minute}`);
 const [winterRise,winterSet]=at('2026-12-22');near(winterRise,7,43);near(winterSet,17,17); // 동지(한국천문연구원 07:43/17:17)
 const [summerRise,summerSet]=at('2026-06-21');near(summerRise,5,11);near(summerSet,19,57); // 하지(05:11/19:57)
 assert.equal(sunTimes(80,0,'2026-06-21'),null);assert.equal(sunTimes(80,0,'2026-12-21'),null);
 assert.match(sunReply('서울',37.5665,126.978,'2026-11-19','오늘'),/^서울 오늘 일출 07:1\d · 일몰 17:[12]\d · 낮 10시간 \d+분\n11-19 · 천문 계산값/);
 assert.match(sunReply('서울',80,0,'2026-06-21','오늘'),/계산할 수 없어요/);
});
test('wind chill follows the official winter formula and only shows when it matters',()=>{
 assert.equal(feelsLike(0,5),-4.9);assert.equal(feelsLike(4.1,6.1),-0.3);assert.equal(feelsLike(15,5),null);assert.equal(feelsLike(5,1),null);assert.equal(feelsLike(Number.NaN,3),null);
 const item={region:'서울',temperature:4.1,condition:'구름많음',feels:-0.3,humidity:40,wind:6.1};
 assert.equal(currentLine(item,true),'서울 4.1℃(체감 -0.3℃) 구름많음 · 습도 40% · 바람 6.1m/s');assert.equal(currentLine(item,false),'서울 4.1℃ 구름많음');
 assert.equal(currentLine({...item,feels:3.6},true),'서울 4.1℃ 구름많음 · 습도 40% · 바람 6.1m/s'); // 체감 차이가 1℃ 미만이면 생략
 assert.equal(currentLine({region:'서울',temperature:4,condition:'맑음'},true),'서울 4℃ 맑음'); // 실황이 없으면 예전 모양
});
test('outfit advice follows temperature bands and mentions big daily ranges',()=>{
 assert.equal(outfitFor(28),'민소매·반팔·반바지');assert.equal(outfitFor(27.9),'반팔·얇은 셔츠·반바지·면바지');assert.equal(outfitFor(5),'코트·가죽자켓·히트텍·니트·레깅스');assert.equal(outfitFor(4.9),'패딩·두꺼운 코트·목도리·기모 제품');assert.equal(outfitFor(-12),'패딩·두꺼운 코트·목도리·기모 제품');
 const text=outfitReply('서울',{temp:4.1,feels:-0.3,min:-1,max:9});
 assert.equal(text,'서울 옷차림 · 지금 4.1℃(체감 -0.3℃)\n패딩·두꺼운 코트·목도리·기모 제품 추천 · 오늘 -1~9℃ · 일교차가 커요, 겉옷을 챙기세요\n기상청 · KST');
 assert.ok(text.length<=200);assert.doesNotMatch(outfitReply('서울',{temp:20}),/오늘/);assert.match(outfitReply('서울',{temp:20}),/얇은 가디건·긴팔·면바지·청바지 추천/);
});
test('hourly forecast picks every third future hour and labels tomorrow',()=>{
 const rows=[];for(let hour=10;hour<=24;hour++)rows.push(row('2026-11-19',hour,{temp:hour-10,pop:hour>=20?30:0}));for(let hour=1;hour<=24;hour++)rows.push(row('2026-11-20',hour,{temp:-1,wf:'구름많음'}));
 const text=hourlyReply('서울',rows,NOW);
 assert.equal(text,'서울 시간별 예보 · 11-19\n16시 6℃ 맑음 0%\n19시 9℃ 맑음 0%\n22시 12℃ 맑음 30%\n내일 01시 -1℃ 구름많음 0%\n내일 04시 -1℃ 구름많음 0%\n내일 07시 -1℃ 구름많음 0%\n기상청 · KST');
 assert.ok(text.length<=200);assert.equal(hourlyReply('서울',rows,Date.parse('2026-11-21T10:00:00+09:00')),null);
});
test('umbrella advice separates today, tomorrow and later rainy days',()=>{
 const base=[];for(let hour=10;hour<=24;hour++)base.push(row('2026-11-19',hour,{pop:hour>=17?20:0}));
 const wetHour=hour=>hour>=6&&hour<=9,tomorrow=Array.from({length:24},(_,i)=>row('2026-11-20',i+1,{pop:wetHour(i+1)?70:10,pty:wetHour(i+1)?1:0,wf:wetHour(i+1)?'비':'흐림'}));
 assert.equal(umbrellaReply('서울',[...base,...tomorrow],NOW,[{date:'2026-11-22',condition:'비',rainChance:60},{date:'2026-11-20',condition:'비',rainChance:70}]),
  '서울 우산 · 오늘 우산은 필요 없어요 (남은 시간 강수확률 최대 20%)\n내일 비 06~09시 (강수확률 최대 70%)\n이후 비·눈: 11-22(일)\n기상청 · KST');
 const wetToday=base.map(item=>item.hour>=17&&item.hour<=19?{...item,pty:1,wf:'비',pop:80}:item);
 assert.match(umbrellaReply('부산',wetToday,NOW,[]),/^부산 우산 · 오늘 우산 챙기세요 ☂ \(비 17~19시 · 강수확률 최대 80%\)\n이번 주·다음 주 이후 비·눈 소식은 없어요\n기상청 · KST$/);
 assert.match(umbrellaReply('강원',base.map(item=>item.hour===18?{...item,pty:3,wf:'눈',pop:60}:item),NOW),/눈이 와요, 미끄럼 조심하세요 \(눈 18시 · 강수확률 최대 60%\)/);
 assert.match(umbrellaReply('대구',base.map(item=>item.hour===20?{...item,pop:40}:item),NOW),/접이식 우산 하나 챙기면 좋아요 \(남은 시간 강수확률 최대 40%\)/);
 assert.match(umbrellaReply('서울',[row('2026-11-19',10)],NOW),/^서울 우산 · 오늘은 남은 예보가 없어요/);
});
test('briefing combines current, daily range, umbrella verdict, sun times and outfit and skips what is missing',()=>{
 const rows=[];for(let hour=10;hour<=24;hour++)rows.push(row('2026-11-19',hour,{pop:hour>=17?20:0}));
 const text=briefingReply('서울',{now:NOW,item:{temperature:4.1,feels:-0.3,condition:'구름많음'},day:{min:-1,max:4},rows,lat:37.5665,lon:126.978});
 assert.match(text,/^서울 오늘 브리핑 · 11-19\(목\)\n지금 4\.1℃\(체감 -0\.3℃\) 구름많음 · 최저 -1 · 최고 4℃\n우산은 필요 없어요 · 일출 07:1\d · 일몰 17:[12]\d\n패딩·두꺼운 코트·목도리·기모 제품 추천\n기상청 · KST$/);assert.ok(text.length<=200);
 assert.equal(briefingReply('서울',{now:NOW}),'서울 오늘 브리핑 · 11-19(목)\n기상청 · KST');
 assert.match(briefingReply('서울',{now:NOW,day:{min:2,max:13}}),/최저 2 · 최고 13℃\n코트·가죽자켓·히트텍·니트·레깅스 추천 · 일교차 큼\n/);
 assert.match(briefingReply('서울',{now:NOW,rows:rows.map(item=>item.hour>=17&&item.hour<=19?{...item,pty:1,wf:'비',pop:80}:item)}),/\n우산 챙기세요 ☂ \(비 17~19시\)\n/);
});
test('yesterday comparison reports the gap in max and min and works inside the briefing',()=>{
 assert.equal(yesterdayReply('서울',{yesterday:{min:-3,max:6,source:'저장된 예보값'},today:{min:-1,max:4}}),'서울 어제 -3~6℃ (저장된 예보값)\n오늘 -1~4℃ · 최고는 어제보다 2℃ 낮아요, 최저는 2℃ 높아요\n기상청 · KST');
 assert.match(yesterdayReply('서울',{yesterday:{min:0,max:4,source:'모델 자료'},today:{min:0,max:4}}),/최고는 어제보다 같아요, 최저는 같아요/);
 assert.equal(yesterdayReply('서울',{yesterday:null,today:{min:0,max:4}}),'서울 어제 기록이 아직 없어요. 서버가 날씨를 저장한 날부터 비교할 수 있어요.');
 assert.match(briefingReply('서울',{now:NOW,day:{min:-1,max:4},yesterday:{min:-3,max:6}}),/최저 -1 · 최고 4℃ \(어제보다 2℃ 낮음\)/);assert.match(briefingReply('서울',{now:NOW,day:{min:-1,max:4},yesterday:{max:4}}),/최고 4℃ \(어제와 같음\)/);
});
test('weather placeholders expand to answers, drop failed lookups and leave plain text untouched',async()=>{
 const seen=[],answer=async request=>{seen.push(request);if(request.arg==='실패')throw Error('x');return request.kind+':'+request.arg;};
 assert.equal(await expandWeatherTokens('일반 안내',answer),'일반 안내');assert.deepEqual(seen,[]);
 assert.equal(await expandWeatherTokens('아침 {브리핑 서울} 그리고 {날씨 부산} 끝',answer),'아침 날씨:서울 브리핑 그리고 날씨:부산 끝');
 assert.deepEqual(seen,[{kind:'날씨',arg:'서울 브리핑'},{kind:'날씨',arg:'부산'}]);
 assert.equal(await expandWeatherTokens('{전국날씨}',answer),'전국날씨:');assert.equal(await expandWeatherTokens('{우산}',answer),'날씨:우산');
 assert.equal(await expandWeatherTokens('{날씨 실패}',answer),'');assert.equal(await expandWeatherTokens('안내 {날씨 실패}',answer),'안내');
 assert.equal((await expandWeatherTokens('{브리핑}',async()=>'가'.repeat(300))).length,200);assert.equal(await expandWeatherTokens('{모르는 서울}',answer),'{모르는 서울}');
});
test('weather helper words are modes, not regions, and short aliases route to the weather command',async()=>{
 for(const [text,mode,region] of [['브리핑 대구','briefing','대구'],['서울 시간별','hourly','서울'],['시간대별 부산','hourly','부산'],['우산','umbrella',''],['제주 내일 일출','sun','제주'],['옷차림 대구','outfit','대구'],['도움말','help',''],['도움 서울','help','서울']]){const query=parseWeatherQuery(text,NOW);assert.deepEqual([query.mode,query.region],[mode,region],text);}
 assert.equal(parseWeatherQuery('서울 내일',NOW).mode,null);assert.equal(parseWeatherQuery('제주 내일 일출',NOW).period,'tomorrow');
 assert.deepEqual(assistantRequest('!우산 부산'),{kind:'날씨',arg:'부산 우산'});assert.deepEqual(assistantRequest('!일출'),{kind:'날씨',arg:'일출'});assert.deepEqual(assistantRequest('!시간별 서울'),{kind:'날씨',arg:'서울 시간별'});assert.deepEqual(assistantRequest('!옷차림'),{kind:'날씨',arg:'옷차림'});
 assert.deepEqual(assistantRequest('!브리핑'),{kind:'날씨',arg:'브리핑'});assert.deepEqual(assistantRequest('!채팅 서울 우산 알려줘'),{kind:'날씨',arg:'서울 우산'});assert.deepEqual(assistantRequest('!채팅 오늘 옷차림 추천해줘'),{kind:'날씨',arg:'오늘 옷차림'});assert.deepEqual(assistantRequest('!채팅 서울 미세먼지 어때'),{kind:'날씨',arg:'서울 미세먼지'});assert.deepEqual(assistantRequest('!미세먼지 부산'),{kind:'날씨',arg:'부산 미세먼지'});assert.deepEqual(assistantRequest('!어제 서울'),{kind:'날씨',arg:'서울 어제'});assert.deepEqual(assistantRequest('!채팅 어제 뭐했어'),{kind:'greeting',arg:'어제 뭐했어'});assert.deepEqual(assistantRequest('!채팅 안녕'),{kind:'greeting',arg:'안녕'}); // 웹 대화창·!채팅에서도 자연스럽게assert.equal(assistantRequest('!우산비'),null);assert.ok(weatherHelp.length<=200);
 const store=new Store();store.create('a','A');const engine=new Engine(store,{now:()=>NOW}),seen=[];engine.lifestyle={answer:async request=>{seen.push(request);return '우산 안내';}};
 const event={id:'umbrella-1',message:'!우산 부산',isDj:true,user:{id:'dj',nickname:'DJ'}};assert.equal((await engine.handleAsync('a',event)).text,'우산 안내');assert.deepEqual(seen,[{kind:'날씨',arg:'부산 우산'}]);store.db.close(); // 엔진의 명령 검사를 통과
});
