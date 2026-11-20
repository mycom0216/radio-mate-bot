import {createHmac} from 'node:crypto';
import {diningRequest,diningQuery,diningPrompt,diningGuide,normalizeCommand} from './dining.mjs';
import {foodTypes,cafeTypes} from './public/dining-guide.mjs';
import {parseWeatherQuery,weatherRange,koreaDate,shiftDate,forecastReply} from './weather-periods.mjs';
import {currentLine,hourlyReply,umbrellaReply,outfitReply,briefingReply,yesterdayReply,sunReply,weatherHelp} from './weather-extras.mjs';
import {AirKorea,sidoOf,dustReply,dustShort,dustForecastReply} from './air-korea.mjs';
import {KmaWarnings,warningReply,alertShort} from './weather-warnings.mjs';
import {naverSearchRequest} from './naver-search-config.mjs';
import {DatabaseSync} from 'node:sqlite';
import {WeatherDb} from './weather-db.mjs';
import {KmaWeather,KMA_LABEL} from './weather-kma.mjs';
// External requests run outside SQLite transactions. Keys never leave the server.
export const regions=[['서울',37.5665,126.978],['부산',35.1796,129.0756],['대구',35.8714,128.6014],['인천',37.4563,126.7052],['광주',35.1595,126.8526],['대전',36.3504,127.3845],['울산',35.5384,129.3114],['세종',36.48,127.289],['경기',37.2636,127.0286],['강원',37.8813,127.73],['충북',36.6424,127.489],['충남',36.6588,126.6728],['전북',35.8242,127.148],['전남',34.8161,126.4629],['경북',36.5684,128.7294],['경남',35.2285,128.6811],['제주',33.4996,126.5312]];
const aliases={수원:'경기',춘천:'강원',청주:'충북',홍성:'충남',전주:'전북',무안:'전남',안동:'경북',창원:'경남',경기도:'경기',강원도:'강원',충청북도:'충북',충청남도:'충남',전라북도:'전북',전라남도:'전남',경상북도:'경북',경상남도:'경남',제주도:'제주'};
// 여러 출처가 섞여도 기상청을 항상 먼저 표시합니다.
const orderSources=list=>[...new Set(list)].sort((a,b)=>(a===KMA_LABEL?0:1)-(b===KMA_LABEL?0:1));
export function weatherName(code){return code===0?'맑음':[1,2].includes(code)?'구름 조금':code===3?'흐림':[45,48].includes(code)?'안개':[51,53,55,56,57].includes(code)?'이슬비':[61,63,65,66,67,80,81,82].includes(code)?'비':[71,73,75,77,85,86].includes(code)?'눈':[95,96,99].includes(code)?'뇌우':'확인 중';}
export function cleanText(value){return String(value??'').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|#39);/g,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[e])).slice(0,300);}
export function assistantRequest(message){
 message=normalizeCommand(message);
 const dining=diningRequest(message);if(dining)return dining;
 const body=String(message).trim().replace(/^!\s*/,'');
 if(String(message).trim().startsWith('!')&&/^(?:(?:이번\s*주|다음\s*주|내일|오늘|현재)\s*)*(?:전국\s*)?(?:(?:이번\s*주|다음\s*주|내일|오늘|현재)\s*)*날씨(?:\s|$)/u.test(body))return {kind:body.includes('전국')?'전국날씨':'날씨',arg:body.replace(/날씨/u,'').trim()};
 // 짧은 별칭: !우산 부산 → !날씨 부산 우산 (시간별·옷차림·일출·일몰도 같음). 엔진은 이 별칭을 날씨 명령으로 취급합니다.
 const short=/^!\s*(우산|옷차림|일출|일몰|시간별|브리핑|어제|초미세먼지|미세먼지|먼지|기상특보|특보)(?:\s+(.*))?$/u.exec(String(message).trim());if(short)return {kind:'날씨',arg:`${short[2]||''} ${short[1]}`.trim()};
 const m=/^!\s*(전국날씨|날씨|맛집|카페|채팅|대화)(?:\s+(.*))?$/u.exec(String(message).trim());if(!m)return null;
 let [,kind,arg='']=m;
 if(['채팅','대화'].includes(kind)){
   const question=arg.trim();const intent=/(전국\s*날씨|날씨|맛집|카페)/u.exec(question);
   if(intent){kind=intent[1].replace(/\s/g,'');arg=question.replace(intent[0],'').replace(/(알려줘|추천해줘|추천|어때|좀|\?)/g,'').trim();}
   else if(/(시간별|시간대별|우산|옷차림|일출|일몰|브리핑|초미세먼지|미세먼지|먼지|기상특보|특보)/u.test(question))return {kind:'날씨',arg:question.replace(/(알려줘|추천해줘|추천|어때|좀|\?)/g,'').trim()};
   else return {kind:'greeting',arg:question};
 }
 return {kind,arg};
}
export class Lifestyle {
 constructor({clientId='',clientSecret='',provider='hub',weatherProxyURL='',weatherProxyKey='',weatherSource='openmeteo',weatherDb=null,kmaKey='',kmaBase='',kmaKeyParam='',defaultRegion='',log=()=>{},fetcher=fetch,now=Date.now}={}){
  Object.assign(this,{clientId,clientSecret,provider,weatherProxyURL,weatherProxyKey,defaultRegion,fetcher,now,log});this.cache=new Map();this.pending=new Map();this.weatherRetryAt=new Map();
  // weatherSource: 'kma'(기상청 동네예보·중기예보, 운영 기본값) 또는 'openmeteo'(Open-Meteo 모델 자료). 기상청이 실패하거나 범위를 벗어난 날짜는 Open-Meteo로 보충합니다.
  if(!['kma','openmeteo'].includes(weatherSource))throw Error('WEATHER_SOURCE는 kma 또는 openmeteo여야 합니다.');
  this.weatherSource=weatherSource;
  this.air=String(kmaKey||'').trim()?new AirKorea({fetcher:(...args)=>this.fetcher(...args),now:()=>this.now(),key:kmaKey}):null; // 미세먼지(에어코리아)·기상특보는 같은 공공데이터포털 서비스키를 씁니다
  this.warn=String(kmaKey||'').trim()?new KmaWarnings({fetcher:(...args)=>this.fetcher(...args),now:()=>this.now(),key:kmaKey}):null;
  if(weatherSource==='kma'){this.weatherDb=weatherDb||new WeatherDb(new DatabaseSync(':memory:'));this.kma=new KmaWeather({db:this.weatherDb,fetcher:(...args)=>this.fetcher(...args),now:()=>this.now(),log:message=>this.log(message),key:kmaKey,...(kmaBase?{base:kmaBase}:{}),...(kmaKeyParam?{keyParam:kmaKeyParam}:{})});}
 }
 regionNames(){return this.weatherDb?this.weatherDb.names():regions.map(r=>r[0]);}
 // 안내 문구용 지역 목록: 스푼 채팅 200자를 넘지 않도록 앞에서부터 담고 나머지는 "외 N곳"으로 줄입니다.
 regionListText(){const names=this.regionNames();let text='',count=0;for(const name of names){const next=text?text+' · '+name:name;if(next.length>140)break;text=next;count++;}return text+(count<names.length?` 외 ${names.length-count}곳`:'');}
 resolveRegion(text){
  if(this.weatherDb)return this.weatherDb.resolve(text)?.id??null;
  const name=aliases[text]||text.replace(/(특별자치시|특별자치도|특별시|광역시)$/,'');return regions.some(r=>r[0]===name)?name:null;
 }
 // 전국 목록(17개)에 없는 추가 지역(예: 목포)은 그 지역만 따로 조회합니다.
 onlyRegion(region){const loc=region&&this.weatherDb?.get(region);return loc&&!loc.national?loc.id:null;}
 // 운영 서버가 주기적으로 호출해 동네예보 스냅샷과 일별 기록을 DB에 쌓습니다(오늘 최저기온은 새벽 발표분에만 들어 있음).
 async collectWeather(){if(this.weatherSource!=='kma')return;await this.kma.each(this.weatherDb.national(),loc=>this.kma.hourly(loc).catch(()=>{}));this.lastCollect=this.now();}
 // 운영 점검 화면용 요약(비밀 값 없음). 기상청 호출이 실패하면 hourly.ok / mid.ok가 false가 됩니다.
 weatherStatus(){return this.weatherSource==='kma'?{source:'kma',...this.kma.status(),collectedAt:this.lastCollect||null}:{source:'openmeteo'};}
 get configured(){return !!(this.clientId&&this.clientSecret);}
 async cached(key,ttl,fn){const old=this.cache.get(key);if(old&&old.until>this.now())return old.value;if(this.pending.has(key))return this.pending.get(key);const task=fn().then(value=>{if(this.cache.size>=200)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{value,until:this.now()+ttl});return value;}).finally(()=>this.pending.delete(key));this.pending.set(key,task);return task;}
 async json(url,headers={}){
  for(let attempt=0;attempt<2;attempt++){
   let res;try{res=await this.fetcher(url,{headers,signal:AbortSignal.timeout(6000)});}catch{if(!attempt)continue;throw Error('검색 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.');}
   if(res.ok){try{return await res.json();}catch{if(!attempt)continue;throw Error('검색 응답 형식을 확인하지 못했습니다.');}}
   if(res.status>=500&&!attempt)continue;
   throw Error(res.status===401||res.status===403?'검색 API 인증·사용 권한을 확인해주세요.':res.status===429?'검색 API 호출 한도를 확인하거나 잠시 후 다시 시도해주세요.':'검색 서비스가 응답하지 않습니다. 잠시 후 다시 시도해주세요.');
  }
 }

 async weatherJSON(url,period){
  const reserve=new URL(url);
  reserve.hostname='historical-forecast-api.open-meteo.com';
  const providers=[{id:'direct',url,timeout:4000},{id:'archive',url:reserve,timeout:7000}];
  if(this.weatherProxyURL&&this.weatherProxyKey){
   const timestamp=Date.now(),body=JSON.stringify({period}),signature=createHmac('sha256',this.weatherProxyKey).update(timestamp+'\n'+body).digest('hex');
   providers.unshift({id:'proxy',url:this.weatherProxyURL,timeout:5000,options:{method:'POST',headers:{'Content-Type':'application/json','x-radiomate-time':String(timestamp),'x-radiomate-signature':signature},body}});
  }
  for(const provider of providers){
   if(provider.id!=='archive'&&this.weatherRetryAt.get(provider.id)>this.now())continue;
   let failure='날씨 서버에 연결하지 못했습니다. 잠시 후 다시 조회해주세요.';
   try{
    const response=await this.fetcher(provider.url,{...provider.options,signal:AbortSignal.timeout(provider.timeout)});
    if(!response.ok)throw Error('Unavailable forecast');
    failure='날씨 서버의 응답 형식을 확인하지 못했습니다. 잠시 후 다시 조회해주세요.';
    const data=await response.json();
    if(!Array.isArray(data)||data.length!==regions.length||data.some(item=>!(period==='current'?item?.current:Array.isArray(item?.daily?.time))))throw Error('Invalid forecast');
    this.weatherRetryAt.delete(provider.id);
    return data;
   }catch(error){
    if(provider.id==='archive')throw Error(failure,{cause:error});
    this.weatherRetryAt.set(provider.id,this.now()+300000);
   }
  }
 }

 async weather(options={}){
  if(options.period&&options.period!=='current')return this.forecast(options.period,options.region);
  if(this.weatherSource==='kma'){const only=this.onlyRegion(options.region);return this.cached('weather:kma:'+koreaDate(this.now())+':'+(only||''),600000,()=>this.kmaCurrent(only));}
  return this.openMeteoCurrent();
 }
 async kmaCurrent(only){
  const locations=only?[this.weatherDb.get(only)]:this.weatherDb.national(),{items,failed}=await this.kma.current(locations);
  let model=new Map();
  if(failed.length)try{model=new Map((await this.openMeteoCurrent()).items.map(item=>[item.region,item]));}catch{}
  const live=new Map(items.map(item=>[item.region,{...item,source:KMA_LABEL}])),merged=locations.map(loc=>live.get(loc.id)||(model.has(loc.id)?{...model.get(loc.id),source:'Open-Meteo'}:null));
  if(merged.some(item=>!item))throw Error('날씨 응답에 누락된 값이 있습니다.');
  const sources=orderSources(merged.map(item=>item.source)),kmaItems=merged.filter(item=>item.source===KMA_LABEL),seen=kmaItems.filter(item=>item.observed).length,observed=kmaItems.length>0&&seen===kmaItems.length;
  // 서비스키가 있으면 현재 기온은 기상청 초단기실황(관측값)입니다. 실황을 못 받은 지역은 현재 시각의 동네예보값을 씁니다.
  const basis=observed?'기상청 초단기실황(관측값)의 현재 기온이며 날씨 상태는 현재 시각의 동네예보를 함께 씁니다.':seen?'일부 지역은 기상청 초단기실황(관측값), 나머지는 현재 시각의 동네예보값입니다.':'기상청 동네예보(1시간 단위)의 현재 시각 예보값이며 실제 관측값이 아닙니다.';
  return {source:sources.join('+'),sources,observed,updatedAt:this.now(),note:basis+(sources.includes('Open-Meteo')?' 기상청 응답이 없는 지역은 Open-Meteo 모델로 보충했습니다.':''),items:merged};
 }
 async openMeteoCurrent(){return this.cached('weather:'+koreaDate(this.now()),600000,async()=>{
  const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:regions.map(r=>r[1]).join(','),longitude:regions.map(r=>r[2]).join(','),current:'temperature_2m,weather_code',timezone:'Asia/Seoul',forecast_days:'1'});
  const result=await this.weatherJSON(url,'current');if(!Array.isArray(result)||result.length!==regions.length)throw Error('날씨 응답을 확인하지 못했습니다.');
  return {source:'Open-Meteo',updatedAt:this.now(),note:'17개 시·도 대표 지점의 모델 기반 현재 날씨입니다.',items:result.map((r,i)=>{if(!Number.isFinite(r.current?.temperature_2m)||!Number.isInteger(r.current?.weather_code))throw Error('날씨 응답에 누락된 값이 있습니다.');return {region:regions[i][0],temperature:r.current.temperature_2m,condition:weatherName(r.current.weather_code),time:r.current.time};})};
 });}
 async forecast(period,region=null){
  const range=weatherRange(period,this.now());if(period==='current')return this.weather({region});
  if(this.weatherSource==='kma'){const only=this.onlyRegion(region);return this.cached('forecast:kma:'+range.today+':'+range.start+':'+range.end+':'+(only||''),600000,()=>this.kmaForecast(range,only));}
  return this.openMeteoForecast(range);
 }
 // 기상청(동네예보 → 중기예보 → 저장해 둔 지난 예보값)을 우선 쓰고, 비어 있는 날짜만 Open-Meteo로 보충하며 날짜마다 출처를 남깁니다.
 async kmaForecast(range,only){
  const locations=only?[this.weatherDb.get(only)]:this.weatherDb.national(),kma=await this.kma.days(range,locations);
  let model=new Map();
  if(locations.some(loc=>range.dates.some(date=>!kma.get(loc.id)?.has(date))))try{model=new Map((await this.openMeteoForecast(range)).items.map(item=>[item.region,new Map(item.days.filter(day=>day.available).map(day=>[day.date,day]))]));}catch{}
  const items=locations.map(loc=>({region:loc.id,days:range.dates.map(date=>{
   const past=date<range.today,day=kma.get(loc.id)?.get(date);
   if(day&&Number.isFinite(day.min)&&Number.isFinite(day.max)&&day.min<=day.max)return {date,past,available:true,min:day.min,max:day.max,condition:day.condition,rainChance:Number.isFinite(day.rain)?day.rain:null,source:KMA_LABEL,...(day.partial?{partial:true}:{}),...(past?{stored:true}:{})};
   const alt=model.get(loc.id)?.get(date);
   return alt?{...alt,source:'Open-Meteo'}:{date,past,available:false,min:null,max:null,condition:'예보 미제공',rainChance:null,source:null};
  })}));
  const sources=orderSources(items.flatMap(item=>item.days).filter(day=>day.available).map(day=>day.source));
  return {...range,source:sources.join('+')||KMA_LABEL,sources,updatedAt:this.now(),note:'기상청 동네예보(오늘~글피)'+(this.kma.key?'·중기예보':'')+' 기준입니다.'+(sources.includes('Open-Meteo')?' 제공 범위 밖이거나 저장값이 없는 날짜는 Open-Meteo 모델로 보충했고 날짜마다 출처를 표시합니다.':'')+' 주간 기준은 월요일~일요일이며 지난 날짜는 저장해 둔 예보값으로 관측값이 아닙니다.'+(items.some(item=>item.days.some(day=>day.partial))?' 오늘 최저·최고는 이미 지난 시간이 빠진 값일 수 있어 "남은 시간 기준"으로 표시합니다.':''),items};
 }
 async openMeteoForecast(range){
  return this.cached('forecast:'+range.today+':'+range.start+':'+range.end,600000,async()=>{
   const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:regions.map(r=>r[1]).join(','),longitude:regions.map(r=>r[2]).join(','),daily:'weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max',timezone:'Asia/Seoul',temperature_unit:'celsius',start_date:range.start,end_date:range.end});
   const result=await this.weatherJSON(url,range.period);if(!Array.isArray(result)||result.length!==regions.length)throw Error('전국 예보 응답을 확인하지 못했습니다.');
   return {...range,source:'Open-Meteo',updatedAt:this.now(),note:'17개 시·도 대표 지점의 모델 예보입니다. 주간 기준은 월요일~일요일이며, 지난 날짜는 모델 기반 과거 자료입니다.',items:result.map((response,i)=>{
    const daily=response.daily;if(!Array.isArray(daily?.time)||daily.time.some(day=>typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))||new Set(daily.time).size!==daily.time.length)throw Error('일별 예보 날짜를 확인하지 못했습니다.');
    for(const key of ['weather_code','temperature_2m_min','temperature_2m_max','precipitation_probability_max'])if(!Array.isArray(daily[key])||daily[key].length!==daily.time.length)throw Error('일별 예보 응답에 누락된 항목이 있습니다.');
    return {region:regions[i][0],days:range.dates.map(date=>{const at=daily.time.indexOf(date),min=daily.temperature_2m_min[at],max=daily.temperature_2m_max[at],code=daily.weather_code[at],chance=daily.precipitation_probability_max[at];const available=at>=0&&Number.isFinite(min)&&Number.isFinite(max)&&min<=max&&Number.isInteger(code);return {date,past:date<range.today,available,min:available?min:null,max:available?max:null,condition:available?weatherName(code):'예보 미제공',rainChance:available&&Number.isFinite(chance)&&chance>=0&&chance<=100?chance:null};})};
   })};
  });
 }
 async places({region='',kind='맛집',meal='',foodType='',extended=false}={}){
  region=String(region).trim();if(!region||region.length>60||/[\r\n]/.test(region))throw Error('지역을 입력해주세요. 예: 광주 동명동');
  if(!['맛집','카페'].includes(kind)||!['','아침','점심','저녁'].includes(meal))throw Error('검색 종류와 식사 시간을 확인해주세요.');
  if(typeof extended!=='boolean')throw Error('확장 검색 설정을 확인해주세요.');
  if(typeof foodType!=='string'||foodType&&!(kind==='카페'?cafeTypes:foodTypes).includes(foodType))throw Error('음식·카페 종류를 확인해주세요.');
  if(kind==='맛집'&&!meal){const hour=new Date(this.now()+32400000).getUTCHours();meal=hour<11?'아침':hour<17?'점심':'저녁';}
  const query=`${region} ${kind==='카페'?[foodType,'카페'].filter(Boolean).join(' '):[meal,'식사',foodType,'맛집'].filter(Boolean).join(' ')}`,searchUrl='https://map.naver.com/p/search/'+encodeURIComponent(query);
  if(!this.configured)return {configured:false,query,searchUrl,items:[],message:'운영 PC에서 네이버 검색 API 키를 설정해주세요. 지도 검색은 바로 이용할 수 있습니다.'};
  return this.cached('places:'+JSON.stringify([this.provider,query,extended]),300000,async()=>{
   const search=async matchedQuery=>{const {url,headers}=naverSearchRequest({provider:this.provider,clientId:this.clientId,clientSecret:this.clientSecret,query:matchedQuery});const data=await this.json(url,headers);if(!Array.isArray(data.items))throw Error('장소 검색 응답을 확인하지 못했습니다.');return data.items.slice(0,5).filter(item=>item&&typeof item.title==='string').map(item=>({title:cleanText(item.title),category:cleanText(item.category),address:cleanText(item.roadAddress||item.address),originalUrl:/^https?:\/\//i.test(String(item.link||''))?String(item.link):'',url:'https://map.naver.com/p/search/'+encodeURIComponent(cleanText(item.title)+' '+cleanText(item.address)),matchedQuery}));};
   // Authenticate the primary search first; a denied key must not look like an empty result.
   const alternatives=kind==='카페'?[`${region} ${foodType||'디저트'} 카페`,`${region} ${foodType||'베이커리'} 카페 추천`]:foodType?[`${region} ${foodType} 전문점`,`${region} ${foodType} 음식점`]:[`${region} 한식 맛집`,`${region} 식당`];
   const queries=[...new Set([query,...(extended?alternatives:[])])];
   const primary=await search(query),extra=await Promise.allSettled(queries.slice(1).map(search));
   const items=[],seen=new Set();for(const item of [...primary,...extra.flatMap(result=>result.status==='fulfilled'?result.value:[])]){const key=(item.title+'|'+item.address).normalize('NFKC').replace(/\s/gu,'').toLocaleLowerCase('ko');if(item.title.trim()&&!seen.has(key)){seen.add(key);items.push(item);}}
   return {configured:true,source:'네이버 지역 검색',query,searchUrl,queries,expanded:extended,fetchedAt:new Date(this.now()).toISOString(),items,partial:extra.some(result=>result.status==='rejected'),note:extended?'최대 3개 검색어의 결과를 합쳐 중복을 제외했습니다. 최대 15곳이며 통합 인기 순위가 아닙니다. 영업시간·가격은 방문 전 확인하세요.':'네이버 검색 관련도 순입니다. 영업시간·가격은 방문 전 확인하세요.'};
  });
 }
 // 현재 날씨를 여러 지역에 대해 한 줄로 비교합니다.
 async compareRegions(ids){
  const pages=await Promise.all(ids.map(id=>this.weather({region:id}))),items=ids.map((id,i)=>pages[i].items.find(item=>item.region===id)).filter(Boolean);
  if(!items.length)throw Error('날씨 정보를 가져오지 못했어요.');
  const sources=orderSources(pages.map(page=>page.source).flatMap(source=>String(source).split('+')));
  return `${ids.join('·')} 날씨 · ${items[0].time.replace('T',' ')} KST\n${items.map(item=>currentLine(item,false)).join(' · ')}\n출처 ${sources.join('+')}${pages.every(page=>page.observed)?' 실황':''} · 대표 지점`;
 }
 // 브리핑용 한 줄 기상특보: 발효 중인 특보가 있을 때만 문구, 없거나 키·승인이 없거나 실패하면 null.
 async alertLine(name){const province=sidoOf(name);if(!this.warn||!province)return null;try{return alertShort(name,await this.warn.status(),name===province?null:name);}catch{return null;}}
 // 브리핑용 한 줄 미세먼지(키·승인이 없거나 실패하면 null).
 async dustLine(name){const sido=sidoOf(name);if(!this.air||!sido)return null;try{return dustShort(await this.air.realtime(sido));}catch{return null;}}
 // 어제의 최저·최고: 서버가 저장해 둔 기록을 먼저 쓰고, 없으면 전국 17곳은 Open-Meteo 과거 모델 자료를 씁니다.
 async yesterdayDay(loc,today,allowModel=true){
  const date=shiftDate(today,-1),stored=this.weatherDb.storedDays(loc.id,[date])[0];
  if(stored)return {min:stored.min,max:stored.max,source:'저장된 예보값'};
  if(!allowModel||!loc.national)return null; // 브리핑은 같은 기상청 자료끼리만 비교합니다
  try{const model=await this.openMeteoForecast({period:'yesterday',label:'어제',today,start:date,end:date,dates:[date]}),day=model.items.find(item=>item.region===loc.id)?.days[0];return day?.available?{min:day.min,max:day.max,source:'모델 자료'}:null;}catch{return null;}
 }
 // 날씨 부가 기능(일출·시간별·우산·옷차림·브리핑·어제). 지역을 쓰지 않으면 기본 지역(WEATHER_DEFAULT_REGION, 없으면 서울)이며, 일출·일몰은 계산식이라 어느 날씨 출처에서나 됩니다.
 async weatherExtra(selection,regionName){
  const name=regionName||this.resolveRegion(this.defaultRegion)||'서울',now=this.now(),today=koreaDate(now);
  if(selection.mode==='sun'){
   const base=this.weatherDb?.get(name)||(()=>{const row=regions.find(r=>r[0]===name);return row&&{id:row[0],lat:row[1],lon:row[2]};})();
   if(!base||!Number.isFinite(base.lat)||!Number.isFinite(base.lon))throw Error('이 지역은 일출·일몰 위치 정보가 없어요.');
   const day=selection.date||selection.start;return sunReply(base.id,base.lat,base.lon,day,day===today?'오늘':day===shiftDate(today,1)?'내일':day.slice(5));
  }
  if(selection.mode==='dust'){
   const sido=sidoOf(name);if(!sido)throw Error('미세먼지는 시·도 기준으로 안내해요. 이 지역의 시·도를 찾지 못했어요.');
   if(!this.air)throw Error('미세먼지 안내에는 서비스키(KMA_SERVICE_KEY)와 에어코리아 활용신청이 필요해요.');
   try{return selection.period==='tomorrow'?dustForecastReply(name,'내일',await this.air.forecast(name,selection.start,today)):dustReply(name===sido?name:`${name}(${sido})`,await this.air.realtime(sido));}
   catch(error){throw Error(/HTTP 40[13]|NOT_REGISTERED|ACCESS_DENIED|거절/.test(error.message)?'에어코리아 사용 승인이 아직 안 된 것 같아요(공공데이터포털 활용신청이 필요해요).':error.message);}
  }
  if(selection.mode==='alert'){
   const province=sidoOf(name);if(!province)throw Error('이 지역의 특보 구역을 찾지 못했어요.');
   if(!this.warn)throw Error('기상특보 안내에는 서비스키(KMA_SERVICE_KEY)와 기상특보 활용신청이 필요해요.');
   try{return warningReply(name,name,await this.warn.status(),name===province?null:name);}
   catch(error){throw Error(/HTTP 40[13]|NOT_REGISTERED|ACCESS_DENIED|거절/.test(error.message)?'기상특보 사용 승인이 아직 안 된 것 같아요(공공데이터포털 활용신청이 필요해요).':error.message);}
  }
  if(this.weatherSource!=='kma')throw Error('시간별·우산·옷차림 안내는 기상청 자료로 날씨를 받을 때만 제공해요.');
  const loc=this.weatherDb.get(name);if(!loc)throw Error('지원하지 않는 지역이에요.');
  if(selection.mode==='hourly')return hourlyReply(loc.id,(await this.kma.hourly(loc)).rows,now)||'시간별 예보 자료가 아직 없어요. 잠시 뒤 다시 시도해주세요.';
  if(selection.mode==='umbrella'){
   const rows=(await this.kma.hourly(loc)).rows;let wet=[];
   try{for(const period of ['thisWeek','nextWeek']){const range=weatherRange(period,now),data=await this.cached('forecast:kma:'+range.today+':'+range.start+':'+range.end+':'+loc.id,600000,()=>this.kmaForecast(range,loc.id));for(const day of data.items.find(item=>item.region===loc.id)?.days||[])if(day.available&&day.date>=today&&(/비|눈|소나기/.test(day.condition)||day.rainChance>=60))wet.push(day);}}catch{wet=null;}
   return umbrellaReply(loc.id,rows,now,wet);
  }
  if(selection.mode==='briefing'){
   const range=weatherRange('current',now),[current,days,hourly,past,dust,alert]=await Promise.allSettled([this.kma.current([loc]),this.kma.days(range,[loc]),this.kma.hourly(loc),this.yesterdayDay(loc,today,false),this.dustLine(loc.id),this.alertLine(loc.id)]);
   const item=current.status==='fulfilled'?current.value.items[0]:null,day=days.status==='fulfilled'?days.value.get(loc.id)?.get(range.today):null,rows=hourly.status==='fulfilled'?hourly.value.rows:[];
   if(!item&&!day&&!rows.length)throw Error('날씨 자료를 받지 못했어요. 잠시 뒤 다시 시도해주세요.');
   return briefingReply(loc.id,{now,item,day,rows,lat:loc.lat,lon:loc.lon,yesterday:past.status==='fulfilled'?past.value:null,dust:dust.status==='fulfilled'?dust.value:null,alert:alert.status==='fulfilled'?alert.value:null});
  }
  if(selection.mode==='yesterday'){const range=weatherRange('current',now);return yesterdayReply(loc.id,{yesterday:await this.yesterdayDay(loc,today),today:(await this.kma.days(range,[loc])).get(loc.id)?.get(range.today)||null});}
  const {items}=await this.kma.current([loc]),item=items[0];if(!item)throw Error('현재 기온 자료를 받지 못했어요. 잠시 뒤 다시 시도해주세요.');
  const range=weatherRange('current',now),day=(await this.kma.days(range,[loc])).get(loc.id)?.get(range.today);
  return outfitReply(loc.id,{temp:item.temperature,feels:item.feels,min:day?.min,max:day?.max});
 }
 async answer(request,context){try{
  const {kind,arg}=request;if(kind==='greeting'&&this.ai&&context){if(arg==='초기화'){this.ai.reset(context);return 'AI 대화 기록을 초기화했어요 ♡';}return await this.ai.answer(arg,context);}if(kind==='greeting')return /안녕|반가/.test(arg)?'반가워요 ♡ 오늘도 함께해요! !날씨 서울 · !전국날씨 · !맛집 광주 점심 · !카페 동명동으로 물어보세요.':'방송 대화 도우미예요 ♡ 인사, 날씨, 맛집·카페를 안내해요. 예: !채팅 서울 날씨 / !맛집 부산 저녁. 자유로운 AI 대화는 아직 연결되지 않았어요.';
  if(kind==='전국날씨'||kind==='날씨'){
   const selection=parseWeatherQuery(arg,this.now());let region=selection.region;
   if(selection.mode==='help')return weatherHelp;
   // 현재 날씨는 지역을 여러 개(최대 6) 적어 한 번에 비교할 수 있습니다: !날씨 서울 부산 제주
   const names=region?region.split(' ').filter(Boolean):[];
   if(!selection.mode&&selection.period==='current'&&names.length>1&&names.length<=6){const resolved=names.map(name=>this.resolveRegion(name));if(resolved.every(Boolean))return await this.compareRegions([...new Set(resolved)]);}
   if(region){region=this.resolveRegion(region);if(!region)return '지원 지역: '+this.regionListText()+' (시·도 대표 지점)';}
   if(selection.mode)return await this.weatherExtra(selection,region);
   if(selection.period!=='current'){
    const forecast=await this.forecast(selection.period,region),data=region?{...forecast,items:forecast.items.filter(x=>x.region===region)}:forecast;
    return forecastReply(data,{...selection,region});
   }
   const data=await this.weather({region});let items=region?data.items.filter(x=>x.region===region):data.items,heading=region?selection.region+' 날씨':'전국 날씨';
   if(!region){if(selection.page>3)return '전국 날씨: !전국날씨 1 / 2 / 3';items=items.slice((selection.page-1)*6,selection.page*6);heading+=` ${selection.page}/3`;}
   return `${heading} · ${items[0].time.replace('T',' ')} KST\n${items.map(x=>currentLine(x,!!region)).join(' · ')}\n출처 ${data.source}${data.observed?' 실황':''} · 대표 지점`;
  }

  const guide=diningGuide(arg,kind);if(guide)return guide;
  const query=diningQuery(arg,kind);if(!query.region)return diningPrompt(kind);
  let result;try{result=await this.places({...query,kind});}catch(error){if(context?.strict)throw error;return '장소 검색을 완료하지 못했어요. '+error.message+'\n!'+kind+' '+query.region+' 으로 다시 시도해주세요.';}
  if(!result.configured)return result.searchUrl.length<=160?'네이버 검색 키 설정이 필요해요. 지도에서 직접 찾아보세요.\n'+result.searchUrl:'네이버 검색 키 설정이 필요해요. 앱의 날씨·맛집 메뉴에서 지도 검색을 열어주세요. 검색어: '+result.query;
  if(!result.items.length)return '검색 결과가 없어요. 지역명을 조금 더 자세히 입력해주세요.';
  const names=result.items.slice(0,2).map((x,i)=>`${i+1}. ${x.title.slice(0,35)} · ${x.address.slice(0,35)}`).join(' / '),prefix='네이버 지역 검색 · '+result.query+'\n',tail='\n'+(result.searchUrl.length<=100?result.searchUrl:'지도·더 많은 결과: 앱의 날씨·맛집 메뉴');
  return prefix+names.slice(0,Math.max(0,200-prefix.length-tail.length))+tail;

 }catch(e){if(context?.strict)throw e;return e.message;}}
}
