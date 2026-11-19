// 기상청 동네예보(1시간 단위 RSS, 서비스키 불필요)와 중기예보·단기예보·초단기실황(공공데이터포털 서비스키 필요) 연동.
// 네이버에는 날씨 공식 API가 없고(NAVER API HUB: 검색·검색어트렌드·쇼핑인사이트만 제공), 기상청 공식 자료를 사용합니다.
// 외부 요청은 SQLite 트랜잭션 밖에서만 실행하며 DB에는 파싱된 값만 저장합니다.
import {shiftDate} from './weather-periods.mjs';
export const KMA_LABEL='기상청';
export const KMA_HOURLY_URL='https://www.weather.go.kr/w/rss/dfs/hr1-forecast.do';
const HOURLY_TTL=30*60000,STALE_MAX=12*3600000,MID_TTL=60*60000,MID_RETRY=10*60000,CURRENT_MAX_AGE=6*3600000;
const RSS_RETRY=30*60000,VILAGE_TTL=6*3600000,OBS_TTL=10*60000,OBS_RETRY=10*60000; // RSS 실패 후 API만 쓰는 시간 · 단기예보 발표분 캐시 · 실황 캐시/재시도
const VILAGE_PATH='/VilageFcstInfoService_2.0',VILAGE_BASES=['0200','0500','0800','1100','1400','1700','2000','2300'];
const PTY_WORD={1:'비',2:'비/눈',3:'눈',4:'소나기'},SKY_WORD={1:'맑음',3:'구름많음',4:'흐림'},OBS_PTY_WORD={1:'비',2:'비/눈',3:'눈',5:'빗방울',6:'빗방울눈날림',7:'눈날림'};
const dashed=compactDate=>`${compactDate.slice(0,4)}-${compactDate.slice(4,6)}-${compactDate.slice(6,8)}`;
const skyOnly=word=>/비|눈|소나기/.test(word)?'흐림':word; // 실황에 강수가 없으면 비·눈 예보 시각의 하늘 상태는 흐림으로 봅니다.
const tag=(text,name)=>new RegExp('<'+name+'>([^<]*)</'+name+'>').exec(text)?.[1];
const number=value=>{if(value===undefined||value===null||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};
const known=value=>value!==null&&value>-900; // 기상청은 값이 없을 때 -999를 씁니다.
const compact=text=>String(text??'').replace(/\s+/g,'');
const SKY_RANK={'맑음':0,'구름많음':1,'흐림':2};
const rowTime=row=>Date.parse(row.date+'T00:00:00Z')+row.hour*3600000-9*3600000; // hour 24 = 다음 날 0시
function dominant(values){
 const counts=new Map();for(const value of values)counts.set(value,(counts.get(value)||0)+1);
 let best=null;for(const [value,count] of counts){if(best===null||count>counts.get(best)||(count===counts.get(best)&&(SKY_RANK[value]??-1)>(SKY_RANK[best]??-1)))best=value;}
 return best;
}
// 시간별 RSS → {issued,name,x,y,rows}. 잘못된 지역 코드는 기상청이 다른 지역을 돌려주므로 표기 대조로 걸러냅니다.
export function parseHourlyRss(xml,expectedName=''){
 const text=String(xml);
 if(!/<rss[\s>]/.test(text))throw Error('기상청 응답 형식을 확인하지 못했습니다.');
 const name=tag(text,'category')?.trim();
 if(expectedName&&name!==expectedName)throw Error('기상청 지역 코드를 확인해주세요: '+expectedName);
 const issued=tag(text,'tm');if(!/^\d{12}$/.test(issued||''))throw Error('기상청 발표시각을 확인하지 못했습니다.');
 const base=`${issued.slice(0,4)}-${issued.slice(4,6)}-${issued.slice(6,8)}`,rows=[];
 for(const match of text.matchAll(/<data seq="\d+">([\s\S]*?)<\/data>/g)){
  const block=match[1],day=number(tag(block,'day')),hour=number(tag(block,'hour')),temp=number(tag(block,'temp')),pop=number(tag(block,'pop'));
  if(!Number.isInteger(day)||day<0||day>6||!Number.isInteger(hour)||hour<1||hour>24||!known(temp))throw Error('기상청 시간별 예보 값을 확인하지 못했습니다.');
  rows.push({date:shiftDate(base,day),hour,temp,tmx:number(tag(block,'tmx')),tmn:number(tag(block,'tmn')),pop:known(pop)&&pop>=0&&pop<=100?pop:null,pty:number(tag(block,'pty'))??0,wf:compact(tag(block,'wfKor'))||'확인 중'});
 }
 if(rows.length<12)throw Error('기상청 시간별 예보가 부족합니다.');
 return {issued,name,x:number(tag(text,'x')),y:number(tag(text,'y')),rows};
}
// 날짜별 요약: 기온은 기상청 일 최저/최고(tmn/tmx), 없으면 시간별 값에서 계산. 강수확률은 하루 중 최댓값, 날씨는 낮(6~21시) 우세 상태,
// 비·눈이 3시간 이상이면 그 강수 형태로 표시합니다. 오늘은 이미 지난 시간이 빠져 있어 exact=false(부분값)일 수 있습니다.
export function dailyFromRows(rows){
 const byDate=new Map();for(const row of rows){if(!byDate.has(row.date))byDate.set(row.date,[]);byDate.get(row.date).push(row);}
 const days=new Map();
 for(const [date,list] of byDate){
  const temps=list.map(row=>row.temp),tmn=list.map(row=>row.tmn).find(known)??null,tmx=list.map(row=>row.tmx).find(known)??null;
  const wet=list.filter(row=>row.pty>0),daytime=list.filter(row=>row.hour>=6&&row.hour<=21),pool=wet.length>=3?wet:daytime.length?daytime:list;
  const pops=list.map(row=>row.pop).filter(Number.isFinite),full=list.length>=24;
  days.set(date,{date,min:tmn??Math.min(...temps),max:tmx??Math.max(...temps),exactMin:tmn!==null||full,exactMax:tmx!==null||full,rain:pops.length?Math.max(...pops):null,condition:dominant(pool.map(row=>row.wf)),hours:list.length});
 }
 return days;
}
// 현재 시각 이전 중 가장 가까운 시간의 예보값(관측값이 아님). 자료가 6시간 넘게 지났으면 쓰지 않습니다.
export function currentFromRows(rows,now){
 let best=null;for(const row of rows)if(rowTime(row)<=now&&(!best||rowTime(row)>rowTime(best)))best=row;
 best??=rows.reduce((a,b)=>rowTime(b)<rowTime(a)?b:a);
 if(Math.abs(now-rowTime(best))>CURRENT_MAX_AGE)throw Error('기상청 예보 자료가 오래되었습니다.');
 return {temperature:best.temp,condition:best.wf,rainChance:best.pop,time:new Date(rowTime(best)+9*3600000).toISOString().slice(0,16)};
}
// 중기예보 발표(매일 06시·18시, 약 10분 뒤 조회 가능) 중 가장 최근 것의 tmFc
export function latestTmFc(now){
 const kst=new Date(now+9*3600000),date=kst.toISOString().slice(0,10),minutes=kst.getUTCHours()*60+kst.getUTCMinutes();
 const [day,time]=minutes>=18*60+10?[date,'1800']:minutes>=6*60+10?[date,'0600']:[shiftDate(date,-1),'1800'];
 return day.replaceAll('-','')+time;
}
// 단기예보 발표(02·05·08·11·14·17·20·23시, 약 10분 뒤 조회 가능) 중 가장 최근 것부터 count개. [{date:'YYYYMMDD',time:'HHMM'}]
export function vilageBases(now,count=3){
 const kst=new Date(now-10*60000+9*3600000),day=kst.toISOString().slice(0,10),minutes=kst.getUTCHours()*60+kst.getUTCMinutes(),out=[];
 for(const [date,limit] of [[day,minutes],[shiftDate(day,-1),24*60]])for(const time of [...VILAGE_BASES].reverse())if(Number(time.slice(0,2))*60<=limit)out.push({date:date.replaceAll('-',''),time});
 return out.slice(0,count);
}
// 초단기실황은 매시 정각 자료를 10분 뒤부터 조회할 수 있어, 가장 최근 정시와 그 한 시간 전을 차례로 시도합니다.
export function ncstBases(now){
 const hour=Math.floor((now-10*60000)/3600000)*3600000;
 return [hour,hour-3600000].map(ms=>{const kst=new Date(ms+9*3600000).toISOString();return {date:kst.slice(0,10).replaceAll('-',''),time:kst.slice(11,13)+'00'};});
}
// 단기예보(getVilageFcst) 응답 → parseHourlyRss와 같은 {issued,name,x,y,rows}. 일 최저·최고(TMN·TMX)는 날짜별 한 건이라 그날의 모든 행에 채웁니다.
export function parseVilage(items,{name='',x=null,y=null}={}){
 if(!Array.isArray(items)||!items.length)throw Error('기상청 단기예보 응답이 비어 있습니다.');
 const slots=new Map(),daily={TMN:new Map(),TMX:new Map()};
 for(const item of items){
  const {category,fcstDate,fcstTime}=item;
  if(!/^\d{8}$/.test(fcstDate||'')||!/^\d{4}$/.test(fcstTime||''))continue;
  const date=dashed(fcstDate),value=number(item.fcstValue);
  if(category==='TMN'||category==='TMX'){if(known(value))daily[category].set(date,value);continue;}
  if(category!=='TMP'&&category!=='SKY'&&category!=='PTY'&&category!=='POP')continue;
  const key=fcstDate+fcstTime;if(!slots.has(key))slots.set(key,{date,hour:Number(fcstTime.slice(0,2))});slots.get(key)[category]=value;
 }
 const rows=[];
 for(const key of [...slots.keys()].sort()){
  const slot=slots.get(key);if(!known(slot.TMP??null))continue;
  const [date,hour]=slot.hour===0?[shiftDate(slot.date,-1),24]:[slot.date,slot.hour],pty=slot.PTY??0; // 0시 예보는 전날의 24시
  rows.push({date,hour,temp:slot.TMP,tmx:daily.TMX.get(date)??null,tmn:daily.TMN.get(date)??null,pop:known(slot.POP??null)&&slot.POP>=0&&slot.POP<=100?slot.POP:null,pty,wf:PTY_WORD[pty]||SKY_WORD[slot.SKY]||'확인 중'});
 }
 if(rows.length<12)throw Error('기상청 단기예보 자료가 부족합니다.');
 const issued=`${items[0].baseDate}${items[0].baseTime}`;if(!/^\d{12}$/.test(issued))throw Error('기상청 발표시각을 확인하지 못했습니다.');
 return {issued,name,x,y,rows};
}
// 중기예보: 발표일 기준 +3~+10일. 육상예보(강수확률·날씨)와 기온예보(최저/최고)를 날짜별로 합칩니다.
export function parseMid(land,temp,issuedDate){
 const days=new Map();
 for(let k=3;k<=10;k++){
  const min=number(temp?.[`taMin${k}`]),max=number(temp?.[`taMax${k}`]);
  if(!known(min)||!known(max)||min>max)continue;
  const rains=(k<=7?[`rnSt${k}Am`,`rnSt${k}Pm`]:[`rnSt${k}`]).map(key=>number(land?.[key])).filter(value=>value!==null&&value>=0&&value<=100);
  const words=(k<=7?[`wf${k}Am`,`wf${k}Pm`]:[`wf${k}`]).map(key=>String(land?.[key]??'').trim()).filter(Boolean);
  const date=shiftDate(issuedDate,k);
  days.set(date,{date,min,max,exactMin:true,exactMax:true,rain:rains.length?Math.max(...rains):null,condition:words.find(word=>/비|눈|소나기/.test(word))??words.at(-1)??'확인 중',hours:0});
 }
 return days;
}
export function normalizeKey(key){
 const text=String(key||'').trim();
 try{return /%[0-9a-f]{2}/i.test(text)?decodeURIComponent(text):text;}catch{return text;}
}
export class KmaWeather{
 constructor({db,fetcher=fetch,now=Date.now,key='',base='https://apis.data.go.kr/1360000',keyParam='serviceKey',log=()=>{}}){
  Object.assign(this,{db,fetcher,now,base:String(base).replace(/\/$/,''),keyParam,key:normalizeKey(key)});
  this.memo=new Map();this.inflight=new Map();this.midRetryAt=new Map();this.rssPausedUntil=new Map();this.obsRetryAt=new Map();this.log=log;
  this.health={hourly:{failed:new Set(),viaApi:new Set(),lastOk:0,lastError:'',lastLogged:0},mid:{failed:new Set(),lastOk:0,lastError:'',lastLogged:0}};
 }
 // 실패를 조용히 묻지 않고 로그로 남깁니다: 처음 실패했을 때 한 번, 계속 실패하면 6시간마다 한 번, 모두 회복되면 한 번.
 note(kind,id,error,extra=''){
  const h=this.health[kind],label=kind==='mid'?'중기예보':'동네예보';
  if(error){
   const first=!h.failed.size;h.failed.add(id);h.lastError=String(error?.message||error).slice(0,120);
   if(first||this.now()-h.lastLogged>=6*3600000){h.lastLogged=this.now();const names=[...h.failed];this.log(`기상청 ${label} 요청 실패(${names.slice(0,3).join('·')}${names.length>3?` 외 ${names.length-3}곳`:''}): ${h.lastError}${extra?` · ${extra}`:''}`);}
  }else{
   h.lastOk=this.now();
   if(h.failed.delete(id)&&!h.failed.size){h.lastLogged=0;this.log(`기상청 ${label} 요청이 다시 정상입니다.`);}
  }
 }
 status(){const view=h=>({ok:!h.failed.size,lastOk:h.lastOk||null,failing:[...h.failed],lastError:h.failed.size?h.lastError:null});return {hourly:{...view(this.health.hourly),viaApi:[...this.health.hourly.viaApi]},mid:{...view(this.health.mid),enabled:!!this.key}};}
 once(key,ttl,task){
  const hit=this.memo.get(key);if(hit&&hit.until>this.now())return Promise.resolve(hit.value);
  if(this.inflight.has(key))return this.inflight.get(key);
  const run=task().then(value=>{if(this.memo.size>=300)this.memo.delete(this.memo.keys().next().value);this.memo.set(key,{value,until:this.now()+(typeof ttl==='function'?ttl(value):ttl)});return value;}).finally(()=>this.inflight.delete(key));
  this.inflight.set(key,run);return run;
 }
 async each(list,fn,limit=6){let next=0;await Promise.all(Array.from({length:Math.min(limit,list.length)},async()=>{while(next<list.length)await fn(list[next++]);}));}
 // 동네예보(오늘~글피). 30분 캐시 → DB 스냅샷 → 기상청 요청 순으로 시도하고, 요청이 실패하면 12시간 이내 스냅샷을 대신 사용합니다.
 hourly(loc){
  return this.once('hourly:'+loc.id,value=>value.stale?60000:HOURLY_TTL,async()=>{
   const snap=this.db.snapshot('kma-hourly',loc.id);let saved=null;
   try{const data=snap&&JSON.parse(snap.payload);if(data?.name===loc.kmaName&&Array.isArray(data.rows)&&data.rows.length)saved=data;}catch{}
   if(saved&&this.now()-snap.fetched<HOURLY_TTL)return saved;
   // 서비스키가 있으면 RSS가 실패했을 때 단기예보 API로 대신 받고(RSS는 30분 동안 쉼), 없으면 예전처럼 RSS만 사용합니다.
   const paused=!!this.key&&this.rssPausedUntil.get(loc.id)>this.now();
   let data=null,failure=null,viaApi=false;
   if(!paused){
    try{data=await this.hourlyRss(loc);this.rssPausedUntil.delete(loc.id);}
    catch(error){failure=error;if(this.key)this.rssPausedUntil.set(loc.id,this.now()+RSS_RETRY);}
   }
   if(!data&&this.key){
    try{data=await this.hourlyApi(loc);viaApi=true;}
    catch(apiError){failure=Error(`${failure?.message??'기상청 RSS 일시 중단'} / API: ${apiError.message}`);}
   }
   if(data){
    this.db.saveSnapshot('kma-hourly',loc.id,data.issued,JSON.stringify(data),this.now());
    this.db.saveDaily(loc.id,dailyFromRows(data.rows),this.now());
    if(viaApi){this.health.hourly.viaApi.add(loc.id);this.health.hourly.lastOk=this.now();if(failure)this.note('hourly',loc.id,failure,'단기예보 API로 대체합니다');}
    else{this.health.hourly.viaApi.delete(loc.id);this.note('hourly',loc.id);}
    return data;
   }
   this.health.hourly.viaApi.delete(loc.id);this.note('hourly',loc.id,failure);
   if(saved&&this.now()-snap.fetched<STALE_MAX)return {...saved,stale:true};
   throw failure;
  });
 }
 async hourlyRss(loc){
  const url=new URL(KMA_HOURLY_URL);url.search=new URLSearchParams({zone:loc.zone});
  const response=await this.fetcher(url,{signal:AbortSignal.timeout(6000)});
  if(!response.ok)throw Error('기상청 서버가 응답하지 않습니다(HTTP '+response.status+').');
  const data=parseHourlyRss(await response.text(),loc.kmaName);
  await this.fillToday(loc,data);
  return data;
 }
 // 단기예보 API로 RSS와 같은 모양의 자료를 만듭니다. 가장 최근 발표분이 아직 없으면(자료 없음) 이전 발표분을 씁니다.
 async hourlyApi(loc){
  if(!loc.nx||!loc.ny)throw Error('기상청 격자 좌표가 없습니다: '+loc.id);
  for(const base of vilageBases(this.now(),3)){
   const data=await this.vilageForecast(loc,base.date,base.time);
   if(data){await this.fillToday(loc,data);return data;}
  }
  throw Error('기상청 단기예보 자료를 받지 못했습니다.');
 }
 // RSS와 최근 발표분에는 오늘 최저(06시)·최고(15시)가 빠져 있을 수 있어, 오늘 02시 발표분의 값으로 채웁니다(서비스키가 있을 때만, 실패해도 무시).
 async fillToday(loc,data){
  if(!this.key||!loc.nx||!loc.ny)return;
  const today=new Date(this.now()+9*3600000).toISOString().slice(0,10),compact=today.replaceAll('-',''),rows=data.rows.filter(row=>row.date===today);
  const needMin=rows.length>0&&!rows.some(row=>known(row.tmn)),needMax=rows.length>0&&!rows.some(row=>known(row.tmx));
  if(!needMin&&!needMax||data.issued===compact+'0200')return;
  try{
   const early=await this.vilageForecast(loc,compact,'0200'),tmn=early?.rows.find(row=>row.date===today&&known(row.tmn))?.tmn,tmx=early?.rows.find(row=>row.date===today&&known(row.tmx))?.tmx;
   for(const row of rows){if(needMin&&tmn!==undefined)row.tmn=tmn;if(needMax&&tmx!==undefined)row.tmx=tmx;}
  }catch{}
 }
 vilageForecast(loc,date,time){
  return this.once(`vilage:${loc.id}:${date}${time}`,value=>value?VILAGE_TTL:60000,async()=>{
   const items=await this.vilageCall('getVilageFcst',{base_date:date,base_time:time,nx:String(loc.nx),ny:String(loc.ny)});
   return items?.length?parseVilage(items,{name:loc.kmaName,x:loc.nx,y:loc.ny}):null;
  });
 }
 // 단기예보 서비스 호출. 자료 없음(03)·조회할 수 없는 시각(10)은 null, 그 밖의 오류는 예외로 알립니다.
 async vilageCall(service,params,rows=1500){
  const items=[];
  for(let page=1;page<=4;page++){
   const url=new URL(`${this.base}${VILAGE_PATH}/${service}`);
   url.search=new URLSearchParams({[this.keyParam]:this.key,pageNo:String(page),numOfRows:String(rows),dataType:'JSON',...params});
   const json=await this.apiJSON(url,'단기예보'),header=json?.response?.header||{};
   if(header.resultCode==='03'||header.resultCode==='10')return null;
   if(header.resultCode!=='00')throw Error('단기예보 요청이 거절되었습니다('+(header.resultCode||'?')+' '+String(header.resultMsg||'').slice(0,60)+').');
   const body=json.response.body||{},part=body.items?.item;if(Array.isArray(part))items.push(...part);
   if(items.length>=Number(body.totalCount||0))break;
  }
  return items;
 }
 // 공공데이터포털 응답을 JSON으로 읽습니다. HTTP 오류에는 포털이 알려 준 사유(예: SERVICE_KEY_IS_NOT_REGISTERED_ERROR)를 붙이며 서비스키는 메시지에 넣지 않습니다.
 async apiJSON(url,label){
  const response=await this.fetcher(url,{signal:AbortSignal.timeout(8000)});
  if(!response.ok){let reason='';try{reason=String((await response.json())?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg||'').slice(0,60);}catch{}throw Error(`${label} 서버가 응답하지 않습니다(HTTP ${response.status}${reason?' '+reason:''}).`);}
  try{return await response.json();}catch{throw Error(label+' 응답 형식을 확인하지 못했습니다.');}
 }
 // 초단기실황(관측값): 현재 기온 등을 가장 최근 정시 자료로 받습니다. 키가 없거나 실패하면 null(동네예보값을 그대로 씀)이며 실패 뒤 10분은 다시 요청하지 않습니다.
 observe(loc){
  if(!this.key||!loc.nx||!loc.ny||this.obsRetryAt.get(loc.id)>this.now())return Promise.resolve(null);
  return this.once('obs:'+loc.id,value=>value?OBS_TTL:60000,async()=>{
   try{
    for(const base of ncstBases(this.now())){
     const items=await this.vilageCall('getUltraSrtNcst',{base_date:base.date,base_time:base.time,nx:String(loc.nx),ny:String(loc.ny)},100);
     if(!items?.length)continue;
     const values=new Map(items.map(item=>[item.category,number(item.obsrValue)])),temperature=values.get('T1H')??null;
     if(!known(temperature))continue;
     return {temperature,rain:OBS_PTY_WORD[values.get('PTY')]||'',time:`${dashed(base.date)}T${base.time.slice(0,2)}:00`};
    }
    return null;
   }catch{this.obsRetryAt.set(loc.id,this.now()+OBS_RETRY);return null;}
  });
 }
 midItem(service,reg,tmFc){
  return this.once(`mid:${service}:${reg}:${tmFc}`,MID_TTL,async()=>{
   const url=new URL(`${this.base}/MidFcstInfoService/${service}`);
   url.search=new URLSearchParams({[this.keyParam]:this.key,pageNo:'1',numOfRows:'10',dataType:'JSON',regId:reg,tmFc});
   const json=await this.apiJSON(url,'중기예보');
   if(json?.response?.header?.resultCode!=='00'){const header=json?.response?.header||{};throw Error('중기예보 요청이 거절되었습니다('+(header.resultCode||'?')+' '+String(header.resultMsg||'').slice(0,60)+').');}
   const item=json.response.body?.items?.item;return Array.isArray(item)?item[0]:item;
  });
 }
 // 중기예보는 서비스키가 있을 때만 사용합니다. 실패하면 10분 동안 다시 요청하지 않습니다.
 async mid(loc){
  if(!this.key||!loc.midLand||!loc.midTemp||this.midRetryAt.get(loc.id)>this.now())return null;
  const tmFc=latestTmFc(this.now());
  try{
   const [land,temp]=await Promise.all([this.midItem('getMidLandFcst',loc.midLand,tmFc),this.midItem('getMidTa',loc.midTemp,tmFc)]);
   if(!land||!temp)throw Error('중기예보 응답이 비어 있습니다.');
   const days=parseMid(land,temp,`${tmFc.slice(0,4)}-${tmFc.slice(4,6)}-${tmFc.slice(6,8)}`);
   this.midRetryAt.delete(loc.id);this.note('mid',loc.id);
   return days;
  }catch(error){this.note('mid',loc.id,error);this.midRetryAt.set(loc.id,this.now()+MID_RETRY);return null;}
 }
 async current(locations){
  const items=[],failed=[];
  await this.each(locations,async loc=>{
   try{
    const hourly=await this.hourly(loc),item={region:loc.id,...currentFromRows(hourly.rows,this.now())},obs=await this.observe(loc);
    // 서비스키가 있으면 현재 기온은 초단기실황(관측값)으로 바꾸고, 날씨 상태는 실황의 강수 형태 → 동네예보의 하늘 상태 순으로 씁니다.
    if(obs)Object.assign(item,{temperature:obs.temperature,time:obs.time,condition:obs.rain||skyOnly(item.condition),observed:true});
    items.push(item);
   }catch{failed.push(loc.id);}
  });
  return {items,failed};
 }
 // 지역별 {날짜 → 일 요약}. 우선순위: 동네예보 → 중기예보 → (지난 날짜) DB에 저장해 둔 기상청 예보값. 없는 날짜는 비워 둡니다.
 async days(range,locations){
  const out=new Map();
  await this.each(locations,async loc=>{
   const days=new Map();
   try{
    const hourly=await this.hourly(loc),stored=new Map(this.db.storedDays(loc.id,[range.today]).map(day=>[day.date,day]));
    for(const [date,day] of dailyFromRows(hourly.rows)){
     // 오늘은 이미 지난 시간이 빠져 최저(06시)·최고(15시)가 부분값일 수 있습니다. 저장된 기록의 수집 시간 수가 19 이상이면 06시를, 10 이상이면 15시를 포함한 발표분이라 확정값으로 봅니다.
     const old=stored.get(date),minOk=day.exactMin||(!!old&&old.hours>=19),maxOk=day.exactMax||(!!old&&old.hours>=10);
     days.set(date,{...day,min:!day.exactMin&&old?Math.min(day.min,old.min):day.min,max:!day.exactMax&&old?Math.max(day.max,old.max):day.max,partial:!(minOk&&maxOk),source:KMA_LABEL,stale:!!hourly.stale});
    }
   }catch{}
   if(range.dates.some(date=>date>=range.today&&!days.has(date))){const mid=await this.mid(loc);if(mid)for(const [date,day] of mid)if(!days.has(date))days.set(date,{...day,source:KMA_LABEL});}
   const past=range.dates.filter(date=>date<range.today&&!days.has(date));
   for(const row of this.db.storedDays(loc.id,past))days.set(row.date,{...row,source:KMA_LABEL});
   out.set(loc.id,days);
  });
  return out;
 }
}
