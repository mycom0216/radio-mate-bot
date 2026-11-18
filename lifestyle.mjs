import {createHmac} from 'node:crypto';
import {parseWeatherQuery,weatherRange,koreaDate,forecastReply} from './weather-periods.mjs';
import {naverSearchRequest} from './naver-search-config.mjs';
// External requests run outside SQLite transactions. Keys never leave the server.
export const regions=[['서울',37.5665,126.978],['부산',35.1796,129.0756],['대구',35.8714,128.6014],['인천',37.4563,126.7052],['광주',35.1595,126.8526],['대전',36.3504,127.3845],['울산',35.5384,129.3114],['세종',36.48,127.289],['경기',37.2636,127.0286],['강원',37.8813,127.73],['충북',36.6424,127.489],['충남',36.6588,126.6728],['전북',35.8242,127.148],['전남',34.8161,126.4629],['경북',36.5684,128.7294],['경남',35.2285,128.6811],['제주',33.4996,126.5312]];
const aliases={수원:'경기',춘천:'강원',청주:'충북',홍성:'충남',전주:'전북',무안:'전남',안동:'경북',창원:'경남',경기도:'경기',강원도:'강원',충청북도:'충북',충청남도:'충남',전라북도:'전북',전라남도:'전남',경상북도:'경북',경상남도:'경남',제주도:'제주'};
export function weatherName(code){return code===0?'맑음':[1,2].includes(code)?'구름 조금':code===3?'흐림':[45,48].includes(code)?'안개':[51,53,55,56,57].includes(code)?'이슬비':[61,63,65,66,67,80,81,82].includes(code)?'비':[71,73,75,77,85,86].includes(code)?'눈':[95,96,99].includes(code)?'뇌우':'확인 중';}
export function cleanText(value){return String(value??'').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|#39);/g,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[e])).slice(0,300);}
export function assistantRequest(message){
 const body=String(message).trim().replace(/^!\s*/,'');
 if(String(message).trim().startsWith('!')&&/^(?:(?:이번\s*주|다음\s*주|내일|오늘|현재)\s*)*(?:전국\s*)?(?:(?:이번\s*주|다음\s*주|내일|오늘|현재)\s*)*날씨(?:\s|$)/u.test(body))return {kind:body.includes('전국')?'전국날씨':'날씨',arg:body.replace(/날씨/u,'').trim()};
 const m=/^!\s*(전국날씨|날씨|맛집|카페|채팅|대화)(?:\s+(.*))?$/u.exec(String(message).trim());if(!m)return null;
 let [,kind,arg='']=m;
 if(['채팅','대화'].includes(kind)){
   const question=arg.trim();const intent=/(전국\s*날씨|날씨|맛집|카페)/u.exec(question);
   if(intent){kind=intent[1].replace(/\s/g,'');arg=question.replace(intent[0],'').replace(/(알려줘|추천해줘|추천|어때|좀|\?)/g,'').trim();}
   else return {kind:'greeting',arg:question};
 }
 return {kind,arg};
}
export class Lifestyle {
 constructor({clientId='',clientSecret='',provider='hub',weatherProxyURL='',weatherProxyKey='',fetcher=fetch,now=Date.now}={}){Object.assign(this,{clientId,clientSecret,provider,weatherProxyURL,weatherProxyKey,fetcher,now});this.cache=new Map();this.pending=new Map();this.weatherRetryAt=new Map();}
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

 async weather(options={}){if(options.period&&options.period!=='current')return this.forecast(options.period);return this.cached('weather:'+koreaDate(this.now()),600000,async()=>{
  const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:regions.map(r=>r[1]).join(','),longitude:regions.map(r=>r[2]).join(','),current:'temperature_2m,weather_code',timezone:'Asia/Seoul',forecast_days:'1'});
  const result=await this.weatherJSON(url,'current');if(!Array.isArray(result)||result.length!==regions.length)throw Error('날씨 응답을 확인하지 못했습니다.');
  return {source:'Open-Meteo',updatedAt:this.now(),note:'17개 시·도 대표 지점의 모델 기반 현재 날씨입니다.',items:result.map((r,i)=>{if(!Number.isFinite(r.current?.temperature_2m)||!Number.isInteger(r.current?.weather_code))throw Error('날씨 응답에 누락된 값이 있습니다.');return {region:regions[i][0],temperature:r.current.temperature_2m,condition:weatherName(r.current.weather_code),time:r.current.time};})};
 });}
 async forecast(period){
  const range=weatherRange(period,this.now());if(period==='current')return this.weather();
  return this.cached('forecast:'+range.today+':'+range.start+':'+range.end,600000,async()=>{
   const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:regions.map(r=>r[1]).join(','),longitude:regions.map(r=>r[2]).join(','),daily:'weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max',timezone:'Asia/Seoul',temperature_unit:'celsius',start_date:range.start,end_date:range.end});
   const result=await this.weatherJSON(url,period);if(!Array.isArray(result)||result.length!==regions.length)throw Error('전국 예보 응답을 확인하지 못했습니다.');
   return {...range,source:'Open-Meteo',updatedAt:this.now(),note:'17개 시·도 대표 지점의 모델 예보입니다. 주간 기준은 월요일~일요일이며, 지난 날짜는 모델 기반 과거 자료입니다.',items:result.map((response,i)=>{
    const daily=response.daily;if(!Array.isArray(daily?.time)||daily.time.some(day=>typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))||new Set(daily.time).size!==daily.time.length)throw Error('일별 예보 날짜를 확인하지 못했습니다.');
    for(const key of ['weather_code','temperature_2m_min','temperature_2m_max','precipitation_probability_max'])if(!Array.isArray(daily[key])||daily[key].length!==daily.time.length)throw Error('일별 예보 응답에 누락된 항목이 있습니다.');
    return {region:regions[i][0],days:range.dates.map(date=>{const at=daily.time.indexOf(date),min=daily.temperature_2m_min[at],max=daily.temperature_2m_max[at],code=daily.weather_code[at],chance=daily.precipitation_probability_max[at];const available=at>=0&&Number.isFinite(min)&&Number.isFinite(max)&&min<=max&&Number.isInteger(code);return {date,past:date<range.today,available,min:available?min:null,max:available?max:null,condition:available?weatherName(code):'예보 미제공',rainChance:available&&Number.isFinite(chance)&&chance>=0&&chance<=100?chance:null};})};
   })};
  });
 }
 async places({region='',kind='맛집',meal=''}={}){
  region=String(region).trim();if(!region||region.length>60||/[\r\n]/.test(region))throw Error('지역을 입력해주세요. 예: 광주 동명동');
  if(!['맛집','카페'].includes(kind)||!['','아침','점심','저녁'].includes(meal))throw Error('검색 종류와 식사 시간을 확인해주세요.');
  if(kind==='맛집'&&!meal){const hour=new Date(this.now()+32400000).getUTCHours();meal=hour<11?'아침':hour<17?'점심':'저녁';}
  const query=`${region} ${kind==='카페'?'카페':meal+' 식사 맛집'}`,searchUrl='https://map.naver.com/p/search/'+encodeURIComponent(query);
  if(!this.configured)return {configured:false,query,searchUrl,items:[],message:'운영 PC에서 네이버 검색 API 키를 설정해주세요. 지도 검색은 바로 이용할 수 있습니다.'};
  return (async()=>{const {url,headers}=naverSearchRequest({provider:this.provider,clientId:this.clientId,clientSecret:this.clientSecret,query});const data=await this.json(url,headers);if(!Array.isArray(data.items))throw Error('장소 검색 응답을 확인하지 못했습니다.');return {configured:true,source:'네이버 지역 검색',query,searchUrl,items:data.items.slice(0,5).map(item=>({title:cleanText(item.title),category:cleanText(item.category),address:cleanText(item.roadAddress||item.address),originalUrl:/^https?:\/\//i.test(String(item.link||''))?String(item.link):'',url:'https://map.naver.com/p/search/'+encodeURIComponent(cleanText(item.title)+' '+cleanText(item.address))})),note:'네이버 검색 관련도 순입니다. 영업시간·가격은 방문 전 확인하세요.'};})();
 }
 async answer(request,context){try{
  const {kind,arg}=request;if(kind==='greeting'&&this.ai&&context){if(arg==='초기화'){this.ai.reset(context);return 'AI 대화 기록을 초기화했어요 ♡';}return await this.ai.answer(arg,context);}if(kind==='greeting')return /안녕|반가/.test(arg)?'반가워요 ♡ 오늘도 함께해요! !날씨 서울 · !전국날씨 · !맛집 광주 점심 · !카페 동명동으로 물어보세요.':'방송 대화 도우미예요 ♡ 인사, 날씨, 맛집·카페를 안내해요. 예: !채팅 서울 날씨 / !맛집 부산 저녁. 자유로운 AI 대화는 아직 연결되지 않았어요.';
  if(kind==='전국날씨'||kind==='날씨'){
   const selection=parseWeatherQuery(arg,this.now());let region=selection.region;
   if(region){region=aliases[region]||region.replace(/(특별자치시|특별자치도|특별시|광역시)$/,'');if(!regions.some(r=>r[0]===region))return '지원 지역: '+regions.map(x=>x[0]).join(' · ')+' (시·도 대표 지점)';}
   if(selection.period!=='current'){
    const forecast=await this.forecast(selection.period),data=region?{...forecast,items:forecast.items.filter(x=>x.region===region)}:forecast;
    return forecastReply(data,{...selection,region});
   }
   const data=await this.weather();let items=region?data.items.filter(x=>x.region===region):data.items,heading=region?selection.region+' 날씨':'전국 날씨';
   if(!region){if(selection.page>3)return '전국 날씨: !전국날씨 1 / 2 / 3';items=items.slice((selection.page-1)*6,selection.page*6);heading+=` ${selection.page}/3`;}
   return `${heading} · ${items[0].time.replace('T',' ')} KST\n${items.map(x=>`${x.region} ${x.temperature}℃ ${x.condition}`).join(' · ')}\n출처 Open-Meteo · 대표 지점`;
  }

  const meal=/(아침|점심|저녁)/.exec(arg)?.[0]||'',region=arg.replace(/(아침|점심|저녁)/g,'').trim();const result=await this.places({region,kind,meal});if(!result.configured)return '네이버 검색 키 설정이 필요해요. '+result.searchUrl;
  if(!result.items.length)return '검색 결과가 없어요. 지역명을 조금 더 자세히 입력해주세요.';
  if(result.searchUrl.length>130)return '지역명을 조금 짧게 입력해주세요. 예: !카페 동명동 (자세한 검색은 앱의 날씨·추천 메뉴를 이용해주세요.)';
  const names=result.items.slice(0,2).map((x,i)=>`${i+1}. ${x.title} · ${x.address}`).join(' / '),prefix='네이버 지역 검색 · '+result.query+'\n',tail='\n'+result.searchUrl;
  return prefix+names.slice(0,Math.max(0,200-prefix.length-tail.length))+tail;

 }catch(e){return e.message;}}
}
