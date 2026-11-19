import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {WeatherDb} from '../weather-db.mjs';
import {KmaWeather,parseHourlyRss,dailyFromRows,currentFromRows,latestTmFc,parseMid,normalizeKey,vilageBases,ncstBases,parseVilage} from '../weather-kma.mjs';
import {Lifestyle,regions} from '../lifestyle.mjs';
import {weatherHelp} from '../weather-extras.mjs';
import {shiftDate} from '../weather-periods.mjs';
import {weatherHTML} from '../public/weather-ui.mjs';

const NOW=Date.parse('2026-11-19T01:30:00Z'); // 2026-11-19(목) 10:30 KST
const DEFAULT_NAME='서울특별시 동작구 신대방제2동'; // 기상청이 알 수 없는 코드에 오류 대신 돌려주는 기본 지역
const memoryDb=()=>new WeatherDb(new DatabaseSync(':memory:'));
const EXTRAS=['서귀포','목포','여수','순천'];

// 기상청 1시간 단위 동네예보 RSS와 같은 필드 구성(실제 응답을 확인해 만든 형태)
function hourlyRows({startHour=10,days=4,offset=0,rainDay=1,rainHours=[10,11,12,13,14,15]}={}){
 const rows=[];
 for(let day=0;day<days;day++)for(let hour=day===0?startHour:1;hour<=24;hour++){
  const shift=offset+2*day,wet=day===rainDay&&rainHours.includes(hour);
  rows.push({day,hour,temp:shift+(hour<7?-3:hour<16?3:0),tmx:day===0&&startHour>15?null:shift+3,tmn:day===0&&startHour>6?null:shift-3,pop:wet?60:day===3?30:0,pty:wet?1:0,wf:wet?'비':hour<12?'구름 많음':'맑음'});
 }
 return rows;
}
const field=value=>value===null||value===undefined?'-999.0':Number(value).toFixed(1);
function xml(rows,{name='서울특별시 중구',issued='202611190800',x=60,y=127}={}){
 return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>기상청 1시간단위 동네예보 웹서비스 - ${name}</title><item><author>기상청</author><category>${name}</category><description><header><tm>${issued}</tm><ts>2</ts><x>${x}</x><y>${y}</y></header><body>${rows.map((r,i)=>`<data seq="${i}"><hour>${r.hour}</hour><day>${r.day}</day><temp>${field(r.temp)}</temp><tmx>${field(r.tmx)}</tmx><tmn>${field(r.tmn)}</tmn><sky>1</sky><pty>${r.pty??0}</pty><wfKor>${r.wf}</wfKor><wfEn>x</wfEn><pcp>0.0</pcp><sno>0.0</sno><pop>${r.pop}</pop><ws>4.0</ws><wd>7</wd><wdKor>북서</wdKor><wdEn>NW</wdEn><reh>50</reh></data>`).join('')}</body></description></item></channel></rss>`;
}
function modelDaily(start,end){const dates=[];for(let d=start;d<=end;d=shiftDate(d,1))dates.push(d);return regions.map(()=>({daily:{time:dates,weather_code:dates.map(()=>3),temperature_2m_min:dates.map(()=>-2.5),temperature_2m_max:dates.map(()=>15.7),precipitation_probability_max:dates.map(()=>40)}}));}

const probe=memoryDb(),ZONES=new Map([...probe.national(),...EXTRAS.map(name=>probe.get(name))].map(loc=>[loc.zone,loc]));
// 기상청·중기예보·Open-Meteo를 한 곳에서 흉내 내는 fetcher. 요청 URL을 모두 기록합니다.
// 단기예보 API(getVilageFcst) 응답 항목: hourlyRows와 같은 값을 발표 시각부터 만듭니다. 오늘 최저(TMN)는 02시 발표분에만, 오늘 최고(TMX)는 15시 전 발표분에만 들어갑니다(실제 응답 확인).
const GRIDS=new Map([...ZONES.values()].map(loc=>[loc.nx+','+loc.ny,loc]));
function vilageItems(baseDate,baseTime,loc){
 const baseHour=Number(baseTime.slice(0,2)),offset=loc?loc.nx%5:0,rows=hourlyRows({startHour:baseHour+1,offset}),base=`${baseDate.slice(0,4)}-${baseDate.slice(4,6)}-${baseDate.slice(6,8)}`,items=[];
 const add=(category,fcstDate,fcstTime,value)=>items.push({baseDate,baseTime,category,fcstDate,fcstTime,fcstValue:String(value),nx:loc?.nx,ny:loc?.ny}),compact=date=>date.replaceAll('-','');
 for(const row of rows){
  const [date,time]=row.hour===24?[shiftDate(base,row.day+1),'0000']:[shiftDate(base,row.day),String(row.hour).padStart(2,'0')+'00'],d=compact(date);
  add('TMP',d,time,row.temp);add('POP',d,time,row.pop);add('PTY',d,time,row.pty);add('SKY',d,time,row.wf==='맑음'?1:row.wf==='구름 많음'?3:4);
 }
 for(let day=0;day<4;day++){const shift=offset+2*day,d=compact(shiftDate(base,day));if(day>0||baseHour===2)add('TMN',d,'0600',(shift-3).toFixed(1));if(day>0||baseHour<14)add('TMX',d,'1500',(shift+3+(day===0?(baseHour>=8?1:0)+(baseHour>=11?1:0):0)).toFixed(1));} // 오늘 최고는 발표가 거듭될수록 오르고(02·05시 3, 08시 4, 11시 5), 14시 이후 발표분에는 없습니다
 return items;
}
function world({fail=[],wrong=[],startHour=10,issued='202611190800',modelFails=false,apiFail=false,noObs=false,obsPty=0,vilageNoData=[]}={}){
 const calls=[],mid={land:{},temp:{}};
 const envelope=(items,code='00',msg='NORMAL_SERVICE')=>({ok:true,status:200,json:async()=>({response:{header:{resultCode:code,resultMsg:msg},body:items?{items:{item:items},totalCount:items.length}:{totalCount:0}}})});
 const vilage=url=>{
  if(apiFail)return {ok:false,status:403,json:async()=>({OpenAPI_ServiceResponse:{cmmMsgHeader:{errMsg:'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'}}})};
  const date=url.searchParams.get('base_date'),time=url.searchParams.get('base_time'),loc=GRIDS.get(url.searchParams.get('nx')+','+url.searchParams.get('ny')),service=url.pathname.split('/').pop();
  if(service==='getUltraSrtNcst'){
   if(noObs)return envelope(null,'03','NO_DATA');
   return envelope([['T1H',(4.3+(loc?loc.nx%5:0)/10).toFixed(1)],['PTY',obsPty],['REH',40],['RN1',0],['WSD',2.1]].map(([category,value])=>({baseDate:date,baseTime:time,category,nx:loc?.nx,ny:loc?.ny,obsrValue:String(value)})));
  }
  if(service==='getVilageFcst')return vilageNoData.includes(date+time)?envelope(null,'03','NO_DATA'):envelope(vilageItems(date,time,loc));
  return envelope(null,'10','알 수 없는 서비스');
 };
 for(let k=3;k<=10;k++){
  if(k<=7)Object.assign(mid.land,{[`rnSt${k}Am`]:10*k,[`rnSt${k}Pm`]:10*k+5,[`wf${k}Am`]:'맑음',[`wf${k}Pm`]:'구름많음'});
  else Object.assign(mid.land,{[`rnSt${k}`]:20+k,[`wf${k}`]:'흐림'});
  Object.assign(mid.temp,{[`taMin${k}`]:k-10,[`taMax${k}`]:k});
 }
 const fetcher=async input=>{
  const url=new URL(input);calls.push(url);
  if(url.hostname==='www.weather.go.kr'){
   const zone=url.searchParams.get('zone');if(fail.includes(zone))return {ok:false,status:503};
   const loc=ZONES.get(zone);
   return {ok:true,status:200,text:async()=>xml(hourlyRows({startHour,offset:loc?loc.nx%5:0}),{issued,name:!loc||wrong.includes(zone)?DEFAULT_NAME:loc.kmaName})};
  }
  if(url.hostname==='apis.data.go.kr'&&url.pathname.includes('/VilageFcstInfoService_2.0/'))return vilage(url);
  if(url.hostname==='apis.data.go.kr'){const item=url.pathname.endsWith('getMidTa')?mid.temp:mid.land;return {ok:true,status:200,json:async()=>({response:{header:{resultCode:'00',resultMsg:'NORMAL_SERVICE'},body:{items:{item:[item]},totalCount:1}}})};}
  if(url.hostname.endsWith('open-meteo.com')){
   if(modelFails)return {ok:false,status:503};
   return url.searchParams.get('current')?{ok:true,json:async()=>regions.map(()=>({current:{temperature_2m:7.5,weather_code:3,time:'2026-11-19T10:00'}}))}:{ok:true,json:async()=>modelDaily(url.searchParams.get('start_date'),url.searchParams.get('end_date'))};
  }
  throw Error('unexpected host '+url.hostname);
 };
 return {fetcher,calls,hosts:name=>calls.filter(url=>url.hostname===name),mid:()=>calls.filter(url=>url.pathname.includes('/MidFcstInfoService/')),vilage:()=>calls.filter(url=>url.pathname.includes('/VilageFcstInfoService_2.0/')),model:()=>calls.filter(url=>url.hostname.endsWith('open-meteo.com'))};
}
const lifestyle=(w,extra={})=>new Lifestyle({weatherSource:'kma',now:()=>NOW,fetcher:w.fetcher,...extra});
const storedDay=(date,over={})=>({date,min:-3,max:5,rain:30,condition:'맑음',hours:24,exactMin:true,exactMax:true,...over});

test('KMA hourly RSS parsing shifts day offsets, keeps 24시 and rejects wrong regions or non-RSS pages',()=>{
 const data=parseHourlyRss(xml(hourlyRows()),'서울특별시 중구');
 assert.equal(data.issued,'202611190800');assert.equal(data.rows.length,15+72);assert.deepEqual([data.x,data.y],[60,127]);
 assert.deepEqual([data.rows[0].date,data.rows[0].hour,data.rows[0].wf],['2026-11-19',10,'구름많음']);
 assert.deepEqual([data.rows.at(-1).date,data.rows.at(-1).hour],['2026-11-22',24]);
 assert.throws(()=>parseHourlyRss(xml(hourlyRows()),'부산광역시 연제구'),/지역 코드/);
 assert.throws(()=>parseHourlyRss(xml(hourlyRows(),{name:DEFAULT_NAME}),'광주'),/지역 코드/);
 assert.throws(()=>parseHourlyRss('<!DOCTYPE html><html><body>오류</body></html>','서울특별시 중구'),/형식/);
 assert.throws(()=>parseHourlyRss(xml(hourlyRows().slice(0,5)),'서울특별시 중구'),/부족/);
 const broken=hourlyRows();broken[2].temp=-999;assert.throws(()=>parseHourlyRss(xml(broken),'서울특별시 중구'),/값/);
 assert.throws(()=>parseHourlyRss(xml(hourlyRows(),{issued:'2026'}),'서울특별시 중구'),/발표시각/);
});
test('daily summaries use KMA min/max, mark today as partial and need three wet hours to show rain',()=>{
 const days=dailyFromRows(parseHourlyRss(xml(hourlyRows()),'서울특별시 중구').rows),today=days.get('2026-11-19'),rainy=days.get('2026-11-20'),sunny=days.get('2026-11-21');
 assert.deepEqual([today.min,today.max,today.exactMin,today.exactMax,today.hours],[0,3,false,true,15]);
 assert.deepEqual([rainy.min,rainy.max,rainy.rain,rainy.condition,rainy.exactMin],[-1,5,60,'비',true]);
 assert.deepEqual([sunny.min,sunny.max,sunny.rain,sunny.condition],[1,7,0,'맑음']);assert.equal(days.get('2026-11-22').rain,30);
 const brief=dailyFromRows(parseHourlyRss(xml(hourlyRows({rainHours:[10,11]})),'서울특별시 중구').rows).get('2026-11-20');
 assert.equal(brief.condition,'맑음');assert.equal(brief.rain,60); // 2시간 강수는 날씨를 바꾸지 않고 강수확률로만 나타냄
});
test('current weather is the latest hourly row at or before now and refuses stale data',()=>{
 const {rows}=parseHourlyRss(xml(hourlyRows()),'서울특별시 중구');
 assert.deepEqual(currentFromRows(rows,NOW),{temperature:3,condition:'구름많음',rainChance:0,time:'2026-11-19T10:00'});
 assert.equal(currentFromRows(rows,Date.parse('2026-11-19T00:30:00Z')).time,'2026-11-19T10:00'); // 첫 행보다 이르면 첫 행
 assert.equal(currentFromRows(rows,Date.parse('2026-11-19T15:30:00Z')).time,'2026-11-20T00:00'); // 24시는 다음 날 0시
 assert.throws(()=>currentFromRows(rows,Date.parse('2026-11-25T00:00:00Z')),/오래/);
});
test('mid-term helpers pick the latest 06/18 announcement and merge land and temperature forecasts',()=>{
 const at=text=>latestTmFc(Date.parse(text+'+09:00'));
 assert.equal(at('2026-11-19T05:00:00'),'202611181800');assert.equal(at('2026-11-19T06:09:00'),'202611181800');assert.equal(at('2026-11-19T06:10:00'),'202611190600');
 assert.equal(at('2026-11-19T18:09:00'),'202611190600');assert.equal(at('2026-11-19T18:10:00'),'202611191800');assert.equal(at('2027-01-01T00:30:00'),'202612311800');
 const land={rnSt3Am:10,rnSt3Pm:20,wf3Am:'맑음',wf3Pm:'구름많음',rnSt4Am:30,rnSt4Pm:70,wf4Am:'구름많음',wf4Pm:'구름많고 비',rnSt8:40,wf8:'흐림'};
 const temp={taMin3:-1,taMax3:5,taMin4:0,taMax4:6,taMin5:null,taMax5:7,taMin8:-2,taMax8:4,taMin9:9,taMax9:1};
 const days=parseMid(land,temp,'2026-11-19');
 assert.deepEqual([...days.keys()],['2026-11-22','2026-11-23','2026-11-27']); // 기온이 없거나 최저>최고인 날은 제외
 assert.deepEqual([days.get('2026-11-22').rain,days.get('2026-11-22').condition],[20,'구름많음']);
 assert.deepEqual([days.get('2026-11-23').rain,days.get('2026-11-23').condition],[70,'구름많고 비']);
 assert.equal(normalizeKey('abc%2Bdef%3D'),'abc+def=');assert.equal(normalizeKey(' plain+key/== '),'plain+key/==');assert.equal(normalizeKey('%E0%A4%A'),'%E0%A4%A');
});
test('weather DB seeds the 17 regions plus extras, resolves names and keeps manual edits',()=>{
 const db=memoryDb();
 assert.deepEqual(db.national().map(loc=>loc.id),regions.map(region=>region[0]));assert.deepEqual(db.names().slice(17,21),EXTRAS);
 assert.equal(db.names().length,47);for(const name of db.names().slice(17)){const loc=db.get(name);assert.ok(!loc.national&&/^\d{10}$/.test(loc.zone)&&loc.nx>0&&loc.ny>0&&loc.midLand&&loc.midTemp,name);} // 주요 시·군 추가 지역
 assert.deepEqual(['성남시','서울시','강릉','세종시'].map(text=>db.resolve(text)?.id),['성남','서울','강릉','세종']);
 for(const [text,id] of [['서울특별시','서울'],['광주광역시','광주'],['전남광주통합특별시','광주'],['강원특별자치도','강원'],['세종특별자치시','세종'],['제주시','제주'],['수원','경기'],['여수','여수'],['충청남도','충남']])assert.equal(db.resolve(text)?.id,id,text);
 assert.equal(db.resolve('없는곳'),null);assert.equal(db.resolve('  '),null);
 for(const [name,lat,lon] of regions){const loc=db.get(name);assert.deepEqual([loc.lat,loc.lon],[lat,lon],name);assert.match(loc.zone,/^\d{10}$/);assert.ok(loc.kmaName.length>2);}
 db.db.prepare("UPDATE weather_location SET zone='9999999999' WHERE id='부산'").run();
 db.db.prepare("UPDATE weather_location SET zone='8888888888',managed=0 WHERE id='대구'").run();
 db.db.prepare("UPDATE weather_location SET enabled=0 WHERE id='인천'").run();
 db.seed(); // 서버를 다시 시작한 것과 같음
 assert.equal(db.get('부산').zone,'2647000000');assert.equal(db.get('대구').zone,'8888888888');assert.equal(db.get('인천'),null);assert.equal(db.national().length,16);
 assert.equal(new WeatherDb(db.db).get('대구').zone,'8888888888'); // 같은 DB를 다시 열어도 유지
});
test('daily records keep exact temperatures, the most complete forecast, and expire after 400 days',()=>{
 const db=memoryDb(),one=day=>new Map([[day.date,day]]),read=()=>db.storedDays('서울',['2026-11-19'])[0];
 db.saveDaily('서울',one(storedDay('2026-11-19')),NOW);
 db.saveDaily('서울',one(storedDay('2026-11-19',{min:0,max:4,rain:0,condition:'흐림',hours:6,exactMin:false,exactMax:false})),NOW+1);
 assert.deepEqual(read(),{date:'2026-11-19',min:-3,max:5,rain:30,condition:'맑음',hours:24,source:'기상청'}); // 부분 예보가 온전한 기록을 덮지 않음
 db.saveDaily('서울',one(storedDay('2026-11-19',{min:-4,rain:70,condition:'비',hours:20})),NOW+2);
 assert.deepEqual([read().min,read().rain,read().condition],[-4,70,'비']);
 assert.deepEqual(db.storedDays('서울',[]),[]);assert.deepEqual(db.storedDays('부산',['2026-11-19']),[]);
 const fresh=memoryDb();fresh.saveDaily('서울',one(storedDay('2025-01-01')),NOW);assert.deepEqual(fresh.storedDays('서울',['2025-01-01']),[]);
});
test('KMA hourly snapshots survive restarts, serve stale data during outages and reject mismatched regions',async()=>{
 const db=memoryDb(),loc=db.get('서울');let time=NOW,calls=0,broken=false,wrongPage=false;
 const fetcher=async()=>{calls++;return broken?{ok:false,status:503}:{ok:true,text:async()=>xml(hourlyRows(),{name:wrongPage?DEFAULT_NAME:loc.kmaName})};};
 const make=()=>new KmaWeather({db,fetcher,now:()=>time}),first=make();
 await first.hourly(loc);await first.hourly(loc);assert.equal(calls,1);
 time+=10*60000;await make().hourly(loc);assert.equal(calls,1); // 재시작해도 30분 이내 DB 스냅샷 재사용
 time+=60*60000;broken=true;const stale=await make().hourly(loc);assert.equal(stale.stale,true);assert.equal(calls,2);
 time+=13*3600000;await assert.rejects(make().hourly(loc),/기상청/);
 broken=false;wrongPage=true;time+=3600000;await assert.rejects(make().hourly(loc),/지역 코드/);
 db.db.prepare("UPDATE weather_location SET kma_name='다른 지역' WHERE id='서울'").run();broken=true;wrongPage=false;
 await assert.rejects(make().hourly(db.get('서울')),/기상청/); // 이름이 바뀐 지역의 옛 스냅샷은 쓰지 않음
});
test('kma current weather labels the source, fits Spoon 200 characters and caches regional lookups',async()=>{
 const w=world(),service=lifestyle(w);
 const national=await service.answer({kind:'전국날씨',arg:''});
 assert.ok(national.length<=200,national);assert.match(national,/출처 기상청 · 대표 지점/);assert.match(national,/2026-11-19 10:00 KST/);assert.equal(w.hosts('www.weather.go.kr').length,17);
 assert.equal(w.model().length,0);
 const seoul=await service.answer({kind:'날씨',arg:'서울특별시'});assert.match(seoul,/서울특별시 날씨/);assert.match(seoul,/서울 3℃ 구름많음/);assert.equal(w.hosts('www.weather.go.kr').length,17);
 assert.match(await service.answer({kind:'날씨',arg:'없는곳'}),/^지원 지역: 서울 .*목포.*\(시·도 대표 지점\)$/);
 const before=w.hosts('www.weather.go.kr').length,mokpo=await service.answer({kind:'날씨',arg:'목포'});
 assert.match(mokpo,/목포 날씨/);assert.equal(w.hosts('www.weather.go.kr').length,before+1);assert.equal(w.hosts('www.weather.go.kr').at(-1).searchParams.get('zone'),'1211000000');
 const page=await service.weather();assert.equal(page.source,'기상청');assert.equal(page.items.length,17);assert.match(weatherHTML(page),/weather\.go\.kr/);assert.doesNotMatch(weatherHTML(page),/open-meteo/);
});
test('a region whose KMA response stops matching is filled from Open-Meteo, labelled, and fails loudly if both are down',async()=>{
 const gwangju=probe.get('광주').zone,w=world({wrong:[gwangju]}),service=lifestyle(w),data=await service.weather();
 assert.equal(data.items.length,17);assert.equal(data.source,'기상청+Open-Meteo');assert.match(data.note,/Open-Meteo/);
 assert.deepEqual([data.items.find(i=>i.region==='광주').source,data.items.find(i=>i.region==='서울').source],['Open-Meteo','기상청']);
 assert.match(await service.answer({kind:'전국날씨',arg:'1'}),/출처 기상청\+Open-Meteo · 대표 지점/);
 await assert.rejects(lifestyle(world({fail:[gwangju],modelFails:true})).weather(),/누락/);
});
test('kma weekly forecast uses KMA for Thu-Sun and marks Open-Meteo for the past days it cannot know',async()=>{
 const w=world(),service=lifestyle(w),week=await service.forecast('thisWeek'),seoul=week.items.find(i=>i.region==='서울').days;
 assert.deepEqual(seoul.map(d=>d.source),['Open-Meteo','Open-Meteo','Open-Meteo','기상청','기상청','기상청','기상청']);assert.equal(week.source,'기상청+Open-Meteo');assert.deepEqual(week.sources,['기상청','Open-Meteo']);
 assert.deepEqual([seoul[3].min,seoul[3].max,seoul[3].rainChance],[0,3,0]);
 assert.deepEqual([seoul[4].min,seoul[4].max,seoul[4].rainChance,seoul[4].condition],[-1,5,60,'비']);
 assert.equal(seoul[0].past,true);assert.equal(seoul[0].stored,undefined);
 const text=await service.answer({kind:'날씨',arg:'서울 이번주'});
 assert.ok(text.length<=200,text);assert.match(text,/기상청\+Open-Meteo\(\*\) · KST · 오늘은 남은 시간 기준 · 과거=모델자료/);assert.match(text,/11-16 .*℃ 흐림 40%\*/);
 const national=await service.answer({kind:'전국날씨',arg:'이번주'});assert.ok(national.length<=200,national);
 const html=weatherHTML(week);assert.match(html,/weather\.go\.kr/);assert.match(html,/open-meteo\.com/);assert.match(html,/과거 모델자료/);assert.doesNotMatch(html,/null℃/);
 const down=await lifestyle(world({fail:ZONES.keys().toArray(),modelFails:true})).forecast('tomorrow');
 assert.ok(down.items.every(item=>!item.days[0].available&&item.days[0].condition==='예보 미제공'));assert.equal(down.source,'기상청');
});
test('past days of the week come from stored KMA records without calling Open-Meteo',async()=>{
 const db=memoryDb(),w=world(),service=lifestyle(w,{weatherDb:db});
 for(const loc of db.national())for(const [date,min] of [['2026-11-16',-4],['2026-11-17',-3],['2026-11-18',-2]])db.saveDaily(loc.id,new Map([[date,storedDay(date,{min,max:min+8,rain:20})]]),NOW-86400000);
 const week=await service.forecast('thisWeek'),seoul=week.items.find(i=>i.region==='서울').days;
 assert.deepEqual(seoul.slice(0,3).map(d=>[d.source,d.stored,d.min,d.max,d.rainChance]),[['기상청',true,-4,4,20],['기상청',true,-3,5,20],['기상청',true,-2,6,20]]);
 assert.equal(week.source,'기상청');assert.equal(w.model().length,0);
 const text=await service.answer({kind:'날씨',arg:'서울 이번주'});assert.match(text,/기상청 · KST · 오늘은 남은 시간 기준 · 과거=저장예보/);assert.doesNotMatch(text,/\*/);
 assert.match(weatherHTML(week),/저장된 예보값/);
});
test("today's minimum keeps the exact early-morning value after later partial forecasts",async()=>{
 const db=memoryDb();let time=Date.parse('2026-11-18T17:30:00Z'); // 11-19 02:30 KST
 const early=world({startHour:4,issued:'202611190200'}),first=new Lifestyle({weatherSource:'kma',weatherDb:db,now:()=>time,fetcher:early.fetcher});
 await first.collectWeather();assert.equal(early.hosts('www.weather.go.kr').length,17);
 assert.deepEqual([db.storedDays('서울',['2026-11-19'])[0].min,db.snapshot('kma-hourly','서울').issued],[-3,'202611190200']);
 time=NOW;const second=new Lifestyle({weatherSource:'kma',weatherDb:db,now:()=>time,fetcher:world().fetcher});
 const today=(await second.forecast('thisWeek')).items.find(i=>i.region==='서울').days[3];
 assert.deepEqual([today.min,today.max],[-3,3]);assert.equal(db.storedDays('서울',['2026-11-19'])[0].min,-3);
});
test('next week uses KMA mid-term forecasts only when a service key is set and never leaks the key',async()=>{
 const plain=world(),without=await lifestyle(plain).forecast('nextWeek');
 assert.equal(without.source,'Open-Meteo');assert.ok(without.items.every(item=>item.days.every(d=>d.source==='Open-Meteo')));assert.equal(plain.hosts('apis.data.go.kr').length,0);
 const w=world(),keyed=lifestyle(w,{kmaKey:'abc%2Bdef'}),next=await keyed.forecast('nextWeek'),mid=w.mid();
 assert.equal(next.source,'기상청');assert.match(next.note,/중기예보/);assert.equal(w.model().length,0);
 assert.equal(mid.length,26); // 육상 9곳 + 기온 17곳
 assert.ok(mid.every(url=>url.searchParams.get('serviceKey')==='abc+def'&&url.searchParams.get('tmFc')==='202611190600'&&url.searchParams.get('dataType')==='JSON'));
 assert.deepEqual(mid.filter(url=>url.pathname.endsWith('getMidTa')&&url.searchParams.get('regId')==='11B10101').length,1);
 assert.ok([...w.hosts('www.weather.go.kr'),...w.model()].every(url=>!url.href.includes('abc')));
 const seoul=next.items.find(i=>i.region==='서울').days;
 assert.deepEqual(seoul.map(d=>d.date),['2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-28','2026-11-29']);
 assert.deepEqual([seoul[0].min,seoul[0].max,seoul[0].rainChance,seoul[0].condition],[-6,4,45,'구름많음']);
 assert.deepEqual([seoul[4].min,seoul[4].max,seoul[4].rainChance,seoul[4].condition],[-2,8,28,'흐림']);
 const text=await keyed.answer({kind:'전국날씨',arg:'다음주'});assert.ok(text.length<=200,text);assert.match(text,/기상청 · KST/);assert.doesNotMatch(text,/Open-Meteo/);
 await keyed.forecast('thisWeek');assert.equal(w.mid().length,26); // 이번 주 목~일은 동네예보로 충분해 중기예보를 다시 부르지 않음
});
test('a rejected mid-term key falls back to Open-Meteo and pauses retries',async()=>{
 const w=world(),base=w.fetcher;let time=NOW;
 const fetcher=async input=>new URL(input).hostname==='apis.data.go.kr'?{ok:true,json:async()=>({response:{header:{resultCode:'30',resultMsg:'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'}}})}:base(input);
 const service=new Lifestyle({weatherSource:'kma',now:()=>time,fetcher,kmaKey:'bad-key'}),next=await service.forecast('nextWeek');
 assert.equal(next.source,'Open-Meteo');assert.ok(next.items.every(item=>item.days.every(d=>d.available)));
 const attempts=w.hosts('apis.data.go.kr').length;await service.kma.mid(probe.get('서울'));assert.equal(w.hosts('apis.data.go.kr').length,attempts); // 10분 동안 재시도 안 함
});
test('KMA failures are logged once, listed in status(), and recovery is announced',()=>{
 let time=NOW;const logs=[],kma=new KmaWeather({db:memoryDb(),now:()=>time,log:message=>logs.push(message)});
 assert.deepEqual(kma.status().hourly,{ok:true,lastOk:null,failing:[],lastError:null,viaApi:[]});assert.equal(kma.status().mid.enabled,false);
 kma.note('hourly','서울');assert.equal(kma.status().hourly.lastOk,NOW);assert.equal(logs.length,0);
 kma.note('hourly','서울',Error('기상청 서버가 응답하지 않습니다(HTTP 503).'));kma.note('hourly','부산',Error('시간 초과'));
 assert.equal(logs.length,1);assert.match(logs[0],/동네예보 요청 실패\(서울\): .*HTTP 503/); // 이미 실패 중이면 다른 지역이 더 실패해도 다시 쓰지 않음
 assert.deepEqual([kma.status().hourly.ok,kma.status().hourly.failing,kma.status().hourly.lastError],[false,['서울','부산'],'시간 초과']);
 kma.note('hourly','서울');assert.equal(logs.length,1); // 부산이 아직 실패 중이라 회복 알림은 아직
 time+=6*3600000;kma.note('hourly','부산',Error('시간 초과'));assert.equal(logs.length,2);assert.match(logs[1],/\(부산\)/); // 계속 실패하면 6시간마다 한 번
 kma.note('hourly','부산');assert.equal(logs.length,3);assert.match(logs[2],/동네예보 요청이 다시 정상/);assert.deepEqual(kma.status().hourly.failing,[]);
 kma.note('hourly','서울',Error('또 실패'));assert.equal(logs.length,4); // 회복 뒤의 새 장애는 바로 기록
 for(const id of ['b','c','d','e'])kma.note('hourly',id,Error('x'));assert.equal(logs.length,4);
 time+=6*3600000;kma.note('hourly','f',Error('x'));assert.equal(logs.length,5);assert.match(logs[4],/\(서울·b·c 외 3곳\): x/);
});
test('a rejected or broken mid-term response is logged with its reason, never prints the service key and recovers',async()=>{
 const good=world().fetcher,logs=[],seoul=probe.get('서울');let time=NOW,mode='rejected';
 const fetcher=async input=>mode==='good'?good(input):mode==='http'?{ok:false,status:500}:{ok:true,json:async()=>({response:{header:{resultCode:'30',resultMsg:'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'}}})};
 const kma=new KmaWeather({db:memoryDb(),now:()=>time,key:'secret-key-123',fetcher,log:message=>logs.push(message)});
 assert.equal(await kma.mid(seoul),null);
 assert.equal(logs.length,1);assert.match(logs[0],/중기예보 요청 실패\(서울\): 중기예보 요청이 거절되었습니다\(30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR\)/);
 assert.deepEqual([kma.status().mid.enabled,kma.status().mid.ok,kma.status().mid.failing],[true,false,['서울']]);assert.equal(kma.status().hourly.ok,true);
 time+=11*60000;mode='http';assert.equal(await kma.mid(seoul),null);assert.match(kma.status().mid.lastError,/HTTP 500/);assert.equal(logs.length,1); // 같은 장애는 반복해서 쓰지 않음
 time+=11*60000;mode='good';assert.ok((await kma.mid(seoul)).size>0);
 assert.equal(logs.length,2);assert.match(logs[1],/중기예보 요청이 다시 정상/);assert.equal(kma.status().mid.ok,true);assert.doesNotMatch(logs.join('\n'),/secret-key-123/);
});
test('collectWeather warms every national region and weatherStatus feeds the diagnostics page',async()=>{
 const gwangju=probe.get('광주').zone,w=world({fail:[gwangju]}),logs=[],service=lifestyle(w,{log:message=>logs.push(message)});
 assert.equal(service.weatherStatus().collectedAt,null);
 await service.collectWeather();
 const status=service.weatherStatus();
 assert.deepEqual([status.source,status.collectedAt,status.hourly.ok,status.hourly.failing,status.mid.enabled],['kma',NOW,false,['광주'],false]);
 assert.equal(w.hosts('www.weather.go.kr').length,17);assert.equal(logs.length,1);assert.match(logs[0],/동네예보 요청 실패\(광주\).*HTTP 503/);
 const plain=new Lifestyle({now:()=>NOW});assert.deepEqual(plain.weatherStatus(),{source:'openmeteo'});assert.equal(await plain.collectWeather(),undefined); // Open-Meteo 모드에서는 수집하지 않음
});
test("today's range is flagged as partial in chat, UI and API until a full-day forecast confirms it",async()=>{
 const w=world(),service=lifestyle(w),week=await service.forecast('thisWeek'),seoul=week.items.find(i=>i.region==='서울').days;
 assert.deepEqual(seoul.map(d=>!!d.partial),[false,false,false,true,false,false,false]); // 오늘(목)만 남은 시간 기준
 assert.match(week.note,/"남은 시간 기준"/);
 const text=await service.answer({kind:'날씨',arg:'서울 이번주'});assert.ok(text.length<=200,text);assert.match(text,/오늘은 남은 시간 기준/);
 const html=weatherHTML(week);assert.equal(html.match(/<small>[^<]*남은 시간 기준/g).length,17);
 const tomorrow=await service.forecast('tomorrow');assert.ok(tomorrow.items.every(item=>!item.days[0].partial));assert.doesNotMatch(tomorrow.note,/남은 시간/);
 assert.doesNotMatch(await service.answer({kind:'날씨',arg:'서울 내일'}),/남은 시간/);
});
test("today's range is confirmed by an early-morning or afternoon record and stays partial otherwise",async()=>{
 const early=Date.parse('2026-11-18T17:30:00Z'),late=Date.parse('2026-11-19T07:30:00Z'); // 02:30 · 16:30 KST
 const today=async(db,w,when)=>(await new Lifestyle({weatherSource:'kma',weatherDb:db,now:()=>when,fetcher:w.fetcher}).forecast('thisWeek')).items.find(i=>i.region==='서울').days[3];
 const night=world({startHour:4,issued:'202611190200'}),morning=world(),evening=world({startHour:17,issued:'202611191500'});
 const full=memoryDb();await new Lifestyle({weatherSource:'kma',weatherDb:full,now:()=>early,fetcher:night.fetcher}).collectWeather();
 let day=await today(full,morning,NOW);assert.deepEqual([day.min,day.max,!!day.partial],[-3,3,false]); // 새벽 기록이 오늘 최저를 확정
 day=await today(full,evening,late);assert.deepEqual([day.min,day.max,!!day.partial],[-3,3,false]); // 15시가 지나 기상청 최고가 사라져도 저장값을 사용
 day=await today(memoryDb(),evening,late);assert.deepEqual([day.min,day.max,day.partial],[0,0,true]); // 저녁에 처음 받으면 확정할 근거가 없음
 const noon=memoryDb();await today(noon,morning,NOW);
 day=await today(noon,evening,late);assert.deepEqual([day.min,day.max,day.partial],[0,3,true]); // 낮에 처음 받으면 최고만 확정되고 최저는 알 수 없음
});
test('short-term base times: the newest published base first (10 minutes after the issue), falling back across midnight',()=>{
 const at=(text,count=3)=>vilageBases(Date.parse(text+':00+09:00'),count).map(base=>base.date+base.time);
 assert.deepEqual(at('2026-11-19T10:30'),['202611190800','202611190500','202611190200']);
 assert.equal(at('2026-11-19T11:09',1)[0],'202611190800');assert.equal(at('2026-11-19T11:10',1)[0],'202611191100');
 assert.deepEqual(at('2026-11-19T02:05'),['202611182300','202611182000','202611181700']);assert.equal(at('2026-11-19T02:10',1)[0],'202611190200');
 const ncst=text=>ncstBases(Date.parse(text+':00+09:00')).map(base=>base.date+base.time);
 assert.deepEqual(ncst('2026-11-19T15:15'),['202611191500','202611191400']);assert.deepEqual(ncst('2026-11-19T15:05'),['202611191400','202611191300']);assert.deepEqual(ncst('2026-11-19T00:05'),['202611182300','202611182200']);
});
test('short-term API items become the same rows as the RSS: 0시 is the previous day 24시 and daily min/max sit on every row',()=>{
 const seoul=probe.get('서울'),data=parseVilage(vilageItems('20261119','0200',seoul),{name:seoul.kmaName,x:seoul.nx,y:seoul.ny});
 assert.deepEqual([data.issued,data.name,data.x,data.y,data.rows.length],['202611190200',seoul.kmaName,60,127,22+72]);
 assert.deepEqual([data.rows[0].date,data.rows[0].hour,data.rows[0].temp],['2026-11-19',3,-3]);assert.deepEqual([data.rows.at(-1).date,data.rows.at(-1).hour],['2026-11-22',24]);
 const days=dailyFromRows(data.rows),today=days.get('2026-11-19');
 assert.deepEqual([today.min,today.max,today.exactMin,today.exactMax],[-3,3,true,true]);assert.deepEqual([days.get('2026-11-20').min,days.get('2026-11-20').max],[-1,5]);
 const wet=data.rows.find(row=>row.date==='2026-11-20'&&row.hour===10),cloudy=data.rows.find(row=>row.date==='2026-11-19'&&row.hour===5);
 assert.deepEqual([wet.wf,wet.pty,wet.pop],['비',1,60]);assert.deepEqual([cloudy.wf,cloudy.pop],['구름많음',0]);
 const morning=dailyFromRows(parseVilage(vilageItems('20261119','0800',seoul),{name:seoul.kmaName}).rows).get('2026-11-19'),evening=dailyFromRows(parseVilage(vilageItems('20261119','1700',seoul),{name:seoul.kmaName}).rows).get('2026-11-19');
 assert.deepEqual([morning.exactMin,morning.exactMax],[false,true]);assert.deepEqual([evening.exactMin,evening.exactMax],[false,false]); // 오늘 최저는 02시 발표분에만, 최고는 15시 전 발표분에만
 assert.throws(()=>parseVilage([],{}),/비어/);assert.throws(()=>parseVilage(vilageItems('20261119','0200',seoul).slice(0,10),{}),/부족/);
});
test('when the RSS fails and a key is set, hourly data comes from the short-term API and the RSS is retried after 30 minutes',async()=>{
 const seoul=probe.get('서울'),fail=[seoul.zone],w=world({fail}),logs=[];let time=NOW;
 const kma=new KmaWeather({db:memoryDb(),fetcher:w.fetcher,now:()=>time,key:'k-123',log:message=>logs.push(message)}),data=await kma.hourly(seoul);
 assert.deepEqual([data.issued,data.name,w.hosts('www.weather.go.kr').length],['202611190800',seoul.kmaName,1]);
 assert.deepEqual(w.vilage().map(url=>url.searchParams.get('base_time')),['0800','0200']); // 최근 발표분 + 오늘 최저를 위한 02시 발표분
 assert.deepEqual([kma.status().hourly.ok,kma.status().hourly.failing,kma.status().hourly.viaApi],[false,['서울'],['서울']]);
 assert.equal(logs.length,1);assert.match(logs[0],/동네예보 요청 실패\(서울\): .*HTTP 503.*단기예보 API로 대체/);assert.ok(!logs.join('\n').includes('k-123'));
 const today=dailyFromRows(data.rows).get('2026-11-19');assert.deepEqual([today.min,today.max,today.exactMin],[-3,4,true]); // 최저는 02시 발표분, 최고는 08시 발표분(02시 발표분은 3)
 time+=31*60000;await kma.hourly(seoul);assert.equal(w.hosts('www.weather.go.kr').length,2);assert.equal(logs.length,1); // 30분 뒤 RSS를 다시 시도, 같은 장애는 다시 쓰지 않음
 fail.length=0;time+=31*60000;await kma.hourly(seoul);
 assert.equal(w.hosts('www.weather.go.kr').length,3);assert.deepEqual([kma.status().hourly.ok,kma.status().hourly.viaApi],[true,[]]);assert.match(logs.at(-1),/다시 정상/);
});
test("after 15시 the RSS has no maximum: today's max comes from the newest base before 14시 and the min from the 02시 base",async()=>{
 const seoul=probe.get('서울'),w=world({startHour:16,issued:'202611191400'}),time=Date.parse('2026-11-19T15:30:00+09:00');
 const kma=new KmaWeather({db:memoryDb(),fetcher:w.fetcher,now:()=>time,key:'k-123'}),data=await kma.hourly(seoul),today=dailyFromRows(data.rows).get('2026-11-19');
 assert.deepEqual([today.min,today.max,today.exactMin,today.exactMax],[-3,5,true,true]); // 02시 발표분 최저 -3, 11시 발표분 최고 5(02시 발표분은 3)
 assert.deepEqual(w.vilage().map(url=>url.searchParams.get('base_time')),['0200','1400','1100']); // 최저용 02시, 최고용은 14시(오늘 최고 없음)를 건너뛰고 11시
});
test('a base that is not published yet falls back to the previous one without an error',async()=>{
 const seoul=probe.get('서울'),w=world({fail:[seoul.zone],vilageNoData:['202611190800']}),kma=new KmaWeather({db:memoryDb(),fetcher:w.fetcher,now:()=>NOW,key:'k-123'}),data=await kma.hourly(seoul);
 assert.equal(data.issued,'202611190500');assert.deepEqual(w.vilage().map(url=>url.searchParams.get('base_time')),['0800','0500','0200']);
});
test('a rejected service key is explained with the portal reason and never printed',async()=>{
 const seoul=probe.get('서울'),logs=[],w=world({fail:[seoul.zone],apiFail:true}),kma=new KmaWeather({db:memoryDb(),fetcher:w.fetcher,now:()=>NOW,key:'secret-key-777',log:message=>logs.push(message)});
 await assert.rejects(kma.hourly(seoul),error=>/HTTP 503/.test(error.message)&&/API: 단기예보 서버가 응답하지 않습니다\(HTTP 403 SERVICE_KEY_IS_NOT_REGISTERED_ERROR\)/.test(error.message)&&!error.message.includes('secret-key-777'));
 assert.equal(logs.length,1);assert.ok(!logs.join('\n').includes('secret-key-777'));assert.deepEqual([kma.status().hourly.failing,kma.status().hourly.viaApi],[['서울'],[]]);
});
test("with a key, today's min and max are filled from the 02시 base so the day is not partial without an earlier record",async()=>{
 const w=world(),service=lifestyle(w,{kmaKey:'k-123'}),week=await service.forecast('thisWeek'),today=week.items.find(i=>i.region==='서울').days[3];
 assert.deepEqual([today.min,today.max,!!today.partial],[-3,3,false]);
 assert.equal(w.vilage().filter(url=>url.pathname.endsWith('getVilageFcst')&&url.searchParams.get('base_time')==='0200').length,17); // 지역마다 한 번(발표분은 6시간 캐시)
 assert.doesNotMatch(await service.answer({kind:'날씨',arg:'서울 이번주'}),/남은 시간/);assert.equal(service.weatherDb.storedDays('서울',['2026-11-19'])[0].min,-3);
});
test('with a key, the current temperature is the observed 초단기실황 value and the answer says so',async()=>{
 const w=world(),service=lifestyle(w,{kmaKey:'k-123'}),seoul=await service.answer({kind:'날씨',arg:'서울'});
 assert.match(seoul,/서울 날씨 · 2026-11-19 10:00 KST/);assert.match(seoul,/서울 4\.3℃\(체감 2\.4℃\) 구름많음 · 습도 40% · 바람 2\.1m\/s/);assert.match(seoul,/출처 기상청 실황 · 대표 지점/);
 const national=await service.answer({kind:'전국날씨',arg:''});assert.ok(national.length<=200,national);assert.match(national,/출처 기상청 실황 · 대표 지점/);
 const page=await service.weather();assert.equal(page.observed,true);assert.ok(page.items.every(item=>item.observed));assert.match(page.note,/초단기실황\(관측값\)/);assert.equal(w.vilage().filter(url=>url.pathname.endsWith('getUltraSrtNcst')).length,17);
 const rainy=await lifestyle(world({obsPty:1}),{kmaKey:'k-123'}).weather();assert.ok(rainy.items.every(item=>item.condition==='비'));
 const none=await lifestyle(world({noObs:true}),{kmaKey:'k-123'}).answer({kind:'날씨',arg:'서울'});assert.match(none,/서울 3℃ 구름많음/);assert.match(none,/출처 기상청 · 대표 지점/);
 const denied=await lifestyle(world({apiFail:true}),{kmaKey:'secret-key-777'}).answer({kind:'날씨',arg:'서울'});assert.match(denied,/서울 3℃/);assert.doesNotMatch(denied,/secret-key-777/);
});
test('weather extras: hourly, umbrella, outfit and sunrise answers fit Spoon 200 characters and need no region',async()=>{
 const w=world(),service=lifestyle(w,{kmaKey:'k-123'});
 const hourly=await service.answer({kind:'날씨',arg:'서울 시간별'});assert.ok(hourly.length<=200,hourly);assert.match(hourly,/^서울 시간별 예보 · 11-19\n11시 /);assert.match(hourly,/\n내일 0\d시 .*\n기상청 · KST$/);
 const umbrella=await service.answer({kind:'날씨',arg:'서울 우산'});assert.ok(umbrella.length<=200,umbrella);
 assert.match(umbrella,/^서울 우산 · 오늘 우산은 필요 없어요 \(남은 시간 강수확률 최대 0%\)\n내일 비 10~15시 \(강수확률 최대 60%\)\n이후 비·눈: 11-25\(수\) · 11-26\(목\)\n기상청 · KST$/); // 다음 주 수·목은 중기예보 강수확률 65·75%
 const outfit=await service.answer({kind:'날씨',arg:'서울 옷차림'});assert.ok(outfit.length<=200,outfit);
 assert.equal(outfit,'서울 옷차림 · 지금 4.3℃(체감 2.4℃)\n패딩·두꺼운 코트·목도리·기모 제품 추천 · 오늘 -3~3℃\n기상청 · KST');
 assert.match(await service.answer({kind:'날씨',arg:'서울 일출'}),/^서울 오늘 일출 07:1\d · 일몰 17:[12]\d/);assert.match(await service.answer({kind:'날씨',arg:'제주 내일 일몰'}),/^제주 내일 일출 07:\d\d · 일몰 17:\d\d/);
 assert.equal(await service.answer({kind:'날씨',arg:'도움말'}),weatherHelp);assert.match(await service.answer({kind:'날씨',arg:'우산'}),/^서울 우산/);assert.match(await service.answer({kind:'날씨',arg:'없는곳 우산'}),/^지원 지역: /);
 assert.match(await lifestyle(world()).answer({kind:'날씨',arg:'서울 옷차림'}),/^서울 옷차림 · 지금 3℃\n/); // 서비스키가 없으면 체감온도 없이 예보값으로 안내
 const legacy=new Lifestyle({now:()=>NOW});assert.match(await legacy.answer({kind:'날씨',arg:'서울 일출'}),/^서울 오늘 일출/);assert.match(await legacy.answer({kind:'날씨',arg:'서울 우산'}),/기상청 자료로 날씨를 받을 때만/);
});
test('weather extras: briefing, several regions at once and the default region',async()=>{
 const w=world(),service=lifestyle(w,{kmaKey:'k-123',defaultRegion:'부산'});
 const briefing=await service.answer({kind:'날씨',arg:'서울 브리핑'});assert.ok(briefing.length<=200,briefing);
 assert.match(briefing,/^서울 오늘 브리핑 · 11-19\(목\)\n지금 4\.3℃\(체감 2\.4℃\) 구름많음 · 최저 -3 · 최고 3℃\n우산은 필요 없어요 · 일출 07:1\d · 일몰 17:[12]\d\n패딩·두꺼운 코트·목도리·기모 제품 추천\n기상청 · KST$/);
 assert.match(await service.answer({kind:'날씨',arg:'브리핑'}),/^부산 오늘 브리핑/);assert.match(await service.answer({kind:'날씨',arg:'우산'}),/^부산 우산/); // 지역을 빼면 기본 지역
 const several=await service.answer({kind:'날씨',arg:'서울 부산 제주'});assert.ok(several.length<=200,several);
 assert.match(several,/^서울·부산·제주 날씨 · 2026-11-19 10:00 KST\n서울 4\.3℃ 구름많음 · 부산 [\d.]+℃ 구름많음 · 제주 [\d.]+℃ 구름많음\n출처 기상청 실황 · 대표 지점$/);
 assert.match(await service.answer({kind:'날씨',arg:'서울 없는곳'}),/^지원 지역: /);assert.match(await lifestyle(world(),{kmaKey:'k-123',defaultRegion:'없는곳'}).answer({kind:'날씨',arg:'브리핑'}),/^서울 오늘 브리핑/); // 잘못된 기본 지역은 서울로
});
test('yesterday comparison uses the stored record, then model data for the 17 regions, and the briefing only compares stored KMA values',async()=>{
 const db=memoryDb(),w=world(),service=lifestyle(w,{weatherDb:db,kmaKey:'k-123'});
 const model=await service.answer({kind:'날씨',arg:'서울 어제'});assert.match(model,/^서울 어제 -2\.5~15\.7℃ \(모델 자료\)\n오늘 -3~3℃ · 최고는 어제보다 12\.7℃ 낮아요, 최저는 .*℃ 낮아요\n기상청 · KST$/);
 assert.doesNotMatch(await service.answer({kind:'날씨',arg:'서울 브리핑'}),/어제/); // 기록이 없으면 브리핑에는 어제 비교를 넣지 않음
 assert.match(await service.answer({kind:'날씨',arg:'목포 어제'}),/기록이 아직 없어요/); // 추가 지역은 모델 대체 없음
 db.saveDaily('서울',new Map([['2026-11-18',storedDay('2026-11-18',{min:-3,max:6})]]),NOW-86400000);
 assert.equal(await service.answer({kind:'날씨',arg:'서울 어제'}),'서울 어제 -3~6℃ (저장된 예보값)\n오늘 -3~3℃ · 최고는 어제보다 3℃ 낮아요, 최저는 같아요\n기상청 · KST');
 const briefing=await service.answer({kind:'날씨',arg:'서울 브리핑'});assert.ok(briefing.length<=200,briefing);assert.match(briefing,/최저 -3 · 최고 3℃ \(어제보다 3℃ 낮음\)/);
});
test('weather source is validated and Open-Meteo stays the library default',()=>{
 assert.throws(()=>new Lifestyle({weatherSource:'naver'}),/WEATHER_SOURCE/);
 const legacy=new Lifestyle();assert.equal(legacy.weatherSource,'openmeteo');assert.equal(legacy.weatherDb,undefined);assert.equal(legacy.resolveRegion('서울특별시'),'서울');assert.equal(legacy.resolveRegion('목포'),null);
});
