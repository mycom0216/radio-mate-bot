import test from 'node:test';
import assert from 'node:assert/strict';
import {Lifestyle,assistantRequest} from '../lifestyle.mjs';
import {Store,Engine} from '../core.mjs';
import {districtCatalog,selectDistricts,districtPage,districtLabel} from '../weather-districts.mjs';
import {parseWeatherQuery,districtChatPage,districtForecastReply,weatherRange} from '../weather-periods.mjs';
import {travelPlaces,travelQuery,travelCategoryMatches,nearestAirports,straightDistance} from '../travel.mjs';
import {travelHTML} from '../public/travel-ui.mjs';
const NOW=Date.parse('2026-11-20T03:00:00Z');
const model=(url)=>{const range=weatherRange(url.searchParams.get('start_date')==='2026-11-23'?'nextWeek':'thisWeek',NOW);return Array.from({length:url.searchParams.get('latitude').split(',').length},()=>({daily:{time:range.dates,temperature_2m_min:range.dates.map(()=>-3),temperature_2m_max:range.dates.map(()=>13),weather_code:range.dates.map(()=>3),precipitation_probability_max:range.dates.map(()=>60)}}));};

test('all six requested Korean nationwide phrases resolve the intended week without a spurious region',()=>{
 for(const week of ['이번주','다음주'])for(const scope of ['전국날씨','대한민국 각 지역별 전국날씨','각 지역별 전국날씨'])for(const prefix of ['!','']){
  const request=assistantRequest(prefix+week+' '+scope);assert.equal(request.kind,'전국날씨');const selection=parseWeatherQuery(request.arg,NOW);assert.equal(selection.region,'');assert.equal(selection.period,week==='이번주'?'thisWeek':'nextWeek');
 }
 assert.equal(assistantRequest('오늘 날씨 좋다'),null);
 assert.equal(parseWeatherQuery('이번주 대한민국 서울 강남구 각 지역별 전국날씨',NOW).region,'서울 강남구');
});

test('official directory has unique validated codes and covers every source province with explicit district names',()=>{
 const rows=districtCatalog.locations;assert.equal(rows.length,257);assert.equal(new Set(rows.map(row=>row.zone)).size,rows.length);assert.equal(new Set(rows.map(row=>row.province)).size,districtCatalog.provinceCount);
 assert.equal(selectDistricts('서울').length,25);assert.equal(selectDistricts('서울 강남구')[0].zone,'1168000000');assert.equal(selectDistricts('경기 수원시 영통구')[0].zone,'4111700000');assert.equal(selectDistricts('세종')[0].kmaName,'세종특별자치시');assert.equal(selectDistricts('광주 북구')[0].zone,'1230000000');assert.equal(selectDistricts('전남').length,22);assert.equal(selectDistricts('없는지역').length,0);
 assert.throws(()=>districtPage('',0),/페이지/);assert.throws(()=>districtPage('',1,10000),/페이지/);assert.throws(()=>districtPage('',999),/페이지/);
});

test('district-major chat pages cover all regions and all seven days with bounded messages and no aggregate substitution',()=>{
 const coverage=new Set(),selection=parseWeatherQuery('다음주',NOW),locations=selectDistricts(),total=locations.length*4;
 for(let page=1;page<=total;page++){
  const query={...selection,page},plan=districtChatPage(query,locations),data={...selection,items:[{region:plan.location.id,displayName:districtLabel(plan.location),days:selection.dates.map(date=>({date,available:true,min:-19.5,max:29.5,condition:'구름많고 비',rainChance:100,source:'기상청',partial:true}))}]};
  const text=districtForecastReply(data,query,plan);assert.ok(text.length<=200,text+'\nlength='+text.length);assert.match(text,/기상청/);for(const date of plan.dates)coverage.add(plan.location.zone+date);
 }
 assert.equal(coverage.size,locations.length*7);
 const plan=districtChatPage({...selection,page:1},selectDistricts('서울 강남구'));
 const text=districtForecastReply({...selection,items:[{region:'서울 강남구',days:selection.dates.map(date=>({date,available:false}))}]},{...selection,region:'서울 강남구'},plan);assert.match(text,/예보 미제공/);assert.doesNotMatch(text,/0℃/);
});

test('one nationwide chat request fetches one district, never the entire country, and caches its real coordinates',async()=>{
 const urls=[],service=new Lifestyle({now:()=>NOW,fetcher:async url=>{urls.push(url);return {ok:true,json:async()=>model(url)};}});
 const request=assistantRequest('!다음주 대한민국 각 지역별 전국날씨'),first=await service.answer(request),second=await service.answer({...request,arg:request.arg+' 2'});
 assert.match(first,/서울 종로구/);assert.match(first,/11-23/);assert.match(second,/11-25/);assert.match(first,/Open-Meteo/);assert.equal(urls.length,1);assert.equal(urls[0].searchParams.get('latitude').split(',').length,1);
 const page=await service.districtForecast('nextWeek',{region:'서울',page:2,pageSize:8});assert.equal(page.items.length,8);assert.equal(page.total,25);assert.equal(page.page,2);assert.equal(page.pages,4);
});

test('bare weekly nationwide input passes Engine while ordinary conversation and duplicate events remain safe',async t=>{
 const store=new Store();t.after(()=>store.db.close());store.create('a','A');const engine=new Engine(store,{now:()=>NOW});let calls=0;engine.lifestyle={answer:async()=>{calls++;return '지역별 예보';}};
 const event={id:'national-week',user:{id:'u'},message:'이번주 대한민국 각 지역별 전국날씨',isDj:true};assert.equal((await engine.handleAsync('a',event)).text,'지역별 예보');assert.equal((await engine.handleAsync('a',event)).duplicate,true);assert.equal(calls,1);
});

test('travel aliases, seasonal and weekly inputs survive parsing without changing named regions',()=>{
 for(const [alias,kind] of [['여행정보','여행'],['관광지','관광'],['숙소추천','숙박'],['교통편','교통'],['기차역','기차'],['버스터미널','버스'],['공항','항공'],['지하철역','지하철'],['계절옷차림','계절옷차림']])assert.equal(assistantRequest('!'+alias+' 서울 강남구').kind,kind);
 const parsed=travelQuery('서울 강남구 겨울 다음주 2',NOW);assert.equal(parsed.region,'서울 강남구');assert.equal(parsed.season,'겨울');assert.equal(parsed.period,'nextWeek');assert.equal(parsed.page,2);
});

test('transport category filters exclude cafes, chargers and advertising even when titles contain airport or station',()=>{
 for(const kind of ['기차','버스','항공','지하철'])for(const category of ['음식점>카페','교통서비스>전기차충전소','광고,마케팅>광고대행'])assert.equal(travelCategoryMatches({title:'공항 기차역 지하철 버스',category},kind),false);
 assert.ok(travelCategoryMatches({category:'기차,철도>KTX정차역'},'기차'));assert.ok(travelCategoryMatches({category:'교통,운수>지하철,전철'},'지하철'));assert.ok(travelCategoryMatches({category:'버스>정류소,정류장'},'버스'));assert.ok(travelCategoryMatches({category:'교통,운수>공항'},'항공'));
});
test('nearby airports use verified positions and label straight-line distances without claiming an available flight',()=>{
 const result=nearestAirports('서울 강남구');assert.equal(result.items.length,3);assert.equal(result.items[0].title,'김포국제공항');assert.ok(result.items.every((item,index)=>Number.isFinite(item.distanceKm)&&(!index||item.distanceKm>=result.items[index-1].distanceKm)));assert.match(result.note,/직선거리/);assert.match(result.note,/현재 운항 여부/);assert.equal(straightDistance({lat:37,lon:127},{lat:37,lon:127}),0);assert.equal(nearestAirports('정확하지 않은 지역'),null);
});

test('travel result cards use actual filtered businesses and never invent fares, stars, room inventory or duration',async()=>{
 const service=new Lifestyle({now:()=>NOW,clientId:'id',clientSecret:'private-key',fetcher:async()=>({ok:true,json:async()=>({items:[{title:'<b>실제 숙소</b>',category:'숙박>호텔',roadAddress:'서울 강남구',link:'javascript:evil'},{title:'공항 카페',category:'음식점>카페'}]})})});
 const result=await service.travel({region:'서울 강남구',kind:'숙박'});assert.equal(result.sections[0].items.length,1);assert.equal(result.sections[0].items[0].title,'실제 숙소');assert.equal(result.sections[0].items[0].originalUrl,'');assert.equal(result.sections[0].items[0].price,undefined);assert.equal(result.sections[0].items[0].rating,undefined);assert.ok(!JSON.stringify(result).includes('private-key'));
 result.region='<img src=x onerror=alert(1)>';const html=travelHTML(result);assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;img'));assert.match(html,/공식 여행 정보/);
});

test('missing travel API keys give usable links, explicit lack of places and valid seasonal information',async()=>{
 const service=new Lifestyle({now:()=>NOW,fetcher:()=>{throw Error('must not call');}});
 const result=await service.travel({region:'지역 미지정',kind:'교통'});assert.equal(result.sections.length,4);assert.ok(result.sections.every(section=>section.items.length===0&&!section.configured&&section.searchUrl.startsWith('https://map.naver.com/')));assert.equal(Object.keys(result.clothing.seasons).length,4);assert.match(result.note,/운행 시간표/);
});

test('travel weather-based outfit uses the selected district forecast, rain and day-night difference',async()=>{
 const service=new Lifestyle({now:()=>NOW,fetcher:async url=>({ok:true,json:async()=>model(url)})});
 const result=await service.travel({region:'서울 강남구',kind:'계절옷차림',period:'nextWeek',season:'겨울'});assert.equal(result.weather.items[0].region,'서울특별시 강남구');assert.equal(result.clothing.season,'겨울');assert.match(result.clothing.forecastTip,/-3~13℃/);assert.match(result.clothing.forecastTip,/일교차/);assert.match(result.clothing.forecastTip,/우산/);
});

test('travel prompts support immediate region replies and malformed pages return an answer rather than breaking ingestion',async t=>{
 const store=new Store();t.after(()=>store.db.close());store.create('a','A');const engine=new Engine(store,{now:()=>NOW}),calls=[];engine.lifestyle={answer:async request=>{calls.push(request);return '실제 관광지';}};
 const say=(id,message)=>engine.handleAsync('a',{id,user:{id:'u'},message});assert.match((await say('p','!관광지')).text,/지역/);assert.equal((await say('r','서울 강남구')).text,'실제 관광지');assert.equal(calls[0].kind,'관광');
 assert.match((await engine.handleAsync('a',{id:'bad-page',isDj:true,user:{id:'u'},message:'!여행 서울 0'})).text,/정수/);
});

test('one failed travel provider section does not hide other verified sections',async()=>{
 const service=new Lifestyle({clientId:'id',clientSecret:'key',fetcher:async url=>url.searchParams.get('query').includes('기차')?{ok:false,status:403}:{ok:true,json:async()=>({items:[{title:'실제 지하철',category:'교통>지하철,전철'}]})}});
 const result=await service.travel({region:'서울 강남구',kind:'교통'});assert.equal(result.partial,true);assert.ok(result.sections.find(section=>section.kind==='지하철').items.length>0);assert.match(result.sections.find(section=>section.kind==='기차').message,/실패/);
});
