// 기상청 동네예보(1시간 단위 RSS, 서비스키 불필요)와 중기예보(서비스키 필요) 연동.
// 네이버에는 날씨 공식 API가 없고(NAVER API HUB: 검색·검색어트렌드·쇼핑인사이트만 제공), 기상청 공식 자료를 사용합니다.
// 외부 요청은 SQLite 트랜잭션 밖에서만 실행하며 DB에는 파싱된 값만 저장합니다.
import {shiftDate} from './weather-periods.mjs';
export const KMA_LABEL='기상청';
export const KMA_HOURLY_URL='https://www.weather.go.kr/w/rss/dfs/hr1-forecast.do';
const HOURLY_TTL=30*60000,STALE_MAX=12*3600000,MID_TTL=60*60000,MID_RETRY=10*60000,CURRENT_MAX_AGE=6*3600000;
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
 constructor({db,fetcher=fetch,now=Date.now,key='',base='https://apis.data.go.kr/1360000',keyParam='serviceKey'}){
  Object.assign(this,{db,fetcher,now,base:String(base).replace(/\/$/,''),keyParam,key:normalizeKey(key)});
  this.memo=new Map();this.inflight=new Map();this.midRetryAt=new Map();
 }
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
   try{
    const url=new URL(KMA_HOURLY_URL);url.search=new URLSearchParams({zone:loc.zone});
    const response=await this.fetcher(url,{signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw Error('기상청 서버가 응답하지 않습니다.');
    const data=parseHourlyRss(await response.text(),loc.kmaName);
    this.db.saveSnapshot('kma-hourly',loc.id,data.issued,JSON.stringify(data),this.now());
    this.db.saveDaily(loc.id,dailyFromRows(data.rows),this.now());
    return data;
   }catch(error){
    if(saved&&this.now()-snap.fetched<STALE_MAX)return {...saved,stale:true};
    throw error;
   }
  });
 }
 midItem(service,reg,tmFc){
  return this.once(`mid:${service}:${reg}:${tmFc}`,MID_TTL,async()=>{
   const url=new URL(`${this.base}/MidFcstInfoService/${service}`);
   url.search=new URLSearchParams({[this.keyParam]:this.key,pageNo:'1',numOfRows:'10',dataType:'JSON',regId:reg,tmFc});
   const response=await this.fetcher(url,{signal:AbortSignal.timeout(6000)});
   if(!response.ok)throw Error('중기예보 서버가 응답하지 않습니다.');
   let json;try{json=await response.json();}catch{throw Error('중기예보 응답 형식을 확인하지 못했습니다.');}
   if(json?.response?.header?.resultCode!=='00')throw Error('중기예보 요청이 거절되었습니다.');
   const item=json.response.body?.items?.item;return Array.isArray(item)?item[0]:item;
  });
 }
 // 중기예보는 서비스키가 있을 때만 사용합니다. 실패하면 10분 동안 다시 요청하지 않습니다.
 async mid(loc){
  if(!this.key||!loc.midLand||!loc.midTemp||this.midRetryAt.get(loc.id)>this.now())return null;
  const tmFc=latestTmFc(this.now());
  try{
   const [land,temp]=await Promise.all([this.midItem('getMidLandFcst',loc.midLand,tmFc),this.midItem('getMidTa',loc.midTemp,tmFc)]);
   if(!land||!temp)throw Error('empty');
   this.midRetryAt.delete(loc.id);
   return parseMid(land,temp,`${tmFc.slice(0,4)}-${tmFc.slice(4,6)}-${tmFc.slice(6,8)}`);
  }catch{this.midRetryAt.set(loc.id,this.now()+MID_RETRY);return null;}
 }
 async current(locations){
  const items=[],failed=[];
  await this.each(locations,async loc=>{
   try{const hourly=await this.hourly(loc);items.push({region:loc.id,...currentFromRows(hourly.rows,this.now())});}catch{failed.push(loc.id);}
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
     const old=stored.get(date);
     days.set(date,{...day,min:!day.exactMin&&old?Math.min(day.min,old.min):day.min,max:!day.exactMax&&old?Math.max(day.max,old.max):day.max,source:KMA_LABEL,stale:!!hourly.stale});
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
