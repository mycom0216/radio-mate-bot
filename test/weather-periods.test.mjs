import test from 'node:test';import assert from 'node:assert/strict';
import {Lifestyle,regions,assistantRequest} from '../lifestyle.mjs';
import {weatherRange,parseWeatherQuery,shiftDate,forecastReply} from '../weather-periods.mjs';
import {weatherHTML} from '../public/weather-ui.mjs';import {Store,Engine} from '../core.mjs';
const now=Date.parse('2026-11-18T05:00:00Z');
function fixture(start,end,{missing=false}={}){const dates=[];for(let d=start;d<=end;d=shiftDate(d,1))dates.push(d);return regions.map(()=>({daily:{time:dates,weather_code:dates.map(()=>3),temperature_2m_min:dates.map((_,i)=>missing&&i===0?null:-2.5),temperature_2m_max:dates.map(()=>15.7),precipitation_probability_max:dates.map(()=>40)}}));}
test('Korean calendar periods use Monday-Sunday across weekends, UTC midnight and year boundaries',()=>{
 assert.deepEqual(weatherRange('thisWeek',now).dates,['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22']);
 assert.equal(weatherRange('nextWeek',now).start,'2026-11-23');assert.equal(weatherRange('nextWeek',now).end,'2026-11-29');
 assert.equal(weatherRange('tomorrow',Date.parse('2026-12-31T15:01:00Z')).start,'2027-01-02');
 assert.equal(weatherRange('thisWeek',Date.parse('2026-11-22T14:59:00Z')).start,'2026-11-16');assert.equal(weatherRange('thisWeek',Date.parse('2026-11-22T15:00:00Z')).start,'2026-11-23');
 assert.throws(()=>weatherRange('wrong'),/현재·내일/);
});
test('weather aliases and natural phrasing preserve tomorrow, week, region and page',()=>{
 for(const message of ['!전국날씨 이번주','!이번주 전국날씨','!이번 주 전국 날씨','!채팅 이번 주 전국 날씨 알려줘']){const req=assistantRequest(message);assert.ok(req);assert.equal(parseWeatherQuery(req.arg,now).period,'thisWeek');}
 const tomorrow=assistantRequest('!이번주 전국 내일 날씨');assert.equal(parseWeatherQuery(tomorrow.arg,now).period,'tomorrow');
 const query=parseWeatherQuery('서울 다음 주 화요일 2',now);assert.equal(query.region,'서울');assert.equal(query.date,'2026-11-24');assert.equal(query.page,2);
 assert.throws(()=>parseWeatherQuery('다음주 2026-11-20',now),/범위/);assert.throws(()=>parseWeatherQuery('내일 0',now),/정수/);
});
test('daily forecast requests use explicit KST ranges and never convert missing values into zero',async()=>{
 let calls=0,time=now;const service=new Lifestyle({now:()=>time,fetcher:async url=>{calls++;assert.equal(url.searchParams.get('timezone'),'Asia/Seoul');assert.match(url.searchParams.get('daily'),/precipitation_probability_max/);return {ok:true,json:async()=>fixture(url.searchParams.get('start_date'),url.searchParams.get('end_date'),{missing:true})};}});
 const a=await service.weather({period:'nextWeek'}),b=await service.weather({period:'nextWeek'});assert.equal(a,b);assert.equal(calls,1);assert.equal(a.items.length,17);assert.equal(a.items[0].days.length,7);assert.equal(a.items[0].days[0].available,false);assert.equal(a.items[0].days[0].min,null);assert.equal(a.items[0].days[1].min,-2.5);
 time=Date.parse('2026-11-18T15:01:00Z');await service.weather({period:'nextWeek'});assert.equal(calls,2);
});
test('district weekly pages, legacy daily regional forecasts and summary formatting show their sources',async()=>{
 const service=new Lifestyle({now:()=>now,fetcher:async url=>({ok:true,json:async()=>fixture(url.searchParams.get('start_date'),url.searchParams.get('end_date')).slice(0,url.searchParams.get('latitude').split(',').length)})});
 for(const arg of ['이번주','이번주 2','다음주','내일','다음주 화요일','서울 다음주']){
  const text=await service.answer({kind:arg.startsWith('서울')?'날씨':'전국날씨',arg});assert.ok(text.length<=200,text);assert.match(text,/Open-Meteo/);assert.match(text,/2026-11-/);
 }
 const data=await service.forecast('thisWeek'),text=forecastReply(data,parseWeatherQuery('이번주',now));assert.match(text,/전체 기온범위/);assert.match(text,/과거=모델자료/);
 const missing=await new Lifestyle({now:()=>now,fetcher:async url=>({ok:true,json:async()=>fixture(url.searchParams.get('start_date'),url.searchParams.get('end_date'),{missing:true})})}).forecast('nextWeek');assert.match(weatherHTML(missing),/예보 미제공/);assert.match(weatherHTML(missing),/weather-week-scroll/);assert.ok(!weatherHTML(missing).includes('null℃'));
});
test('weather aliases pass the real Engine command gate and remain idempotent',async()=>{
 const store=new Store();store.create('a','A');const engine=new Engine(store,{now:()=>now});let calls=0;engine.lifestyle={answer:async()=>{calls++;return '다음주 예보';}};
 const event={id:'alias',message:'!다음주 전국 날씨',isDj:true,user:{id:'dj',nickname:'DJ'}};assert.equal((await engine.handleAsync('a',event)).text,'다음주 예보');assert.equal((await engine.handleAsync('a',event)).duplicate,true);assert.equal(calls,1);store.db.close();
});
test('weather service can use the authenticated edge bridge without transmitting API keys',async()=>{
 const service=new Lifestyle({now:()=>now,weatherProxyURL:'https://fixed.example/__radiomate/weather',weatherProxyKey:'test-router-key',clientSecret:'private-naver-key',fetcher:async(url,options)=>{assert.equal(url,'https://fixed.example/__radiomate/weather');assert.equal(options.method,'POST');assert.match(options.headers['x-radiomate-signature'],/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(options).includes('private-naver-key'));assert.ok(!JSON.stringify(options.headers).includes('test-router-key'));const {period}=JSON.parse(options.body),range=weatherRange(period,now);return {ok:true,json:async()=>fixture(range.start,range.end)};}});
 const result=await service.weather({period:'nextWeek'});assert.equal(result.items.length,17);assert.equal(result.end,'2026-11-29');
});
test('weather falls back after proxy and upstream failure and retries the primary later',async()=>{
 let time=now;const hosts=[];
 const service=new Lifestyle({now:()=>time,weatherProxyURL:'https://fixed.example/__radiomate/weather',weatherProxyKey:'test-router-key',fetcher:async(input,options)=>{
  const url=new URL(input);hosts.push(url.hostname);
  if(url.hostname==='fixed.example')return {ok:false,status:503};
  if(url.hostname==='api.open-meteo.com')return {ok:true,json:async()=>({unexpected:true})};
  assert.equal(url.hostname,'historical-forecast-api.open-meteo.com');
  assert.equal(options.headers,undefined);
  return {ok:true,json:async()=>fixture(url.searchParams.get('start_date'),url.searchParams.get('end_date'))};
 }});
 assert.equal((await service.weather({period:'tomorrow'})).items.length,17);
 assert.equal((await service.weather({period:'nextWeek'})).items[0].days.length,7);
 assert.deepEqual(hosts,['fixed.example','api.open-meteo.com','historical-forecast-api.open-meteo.com','historical-forecast-api.open-meteo.com']);
 time+=300001;await service.weather({period:'thisWeek'});assert.deepEqual(hosts.slice(-3),hosts.slice(0,3));
});
