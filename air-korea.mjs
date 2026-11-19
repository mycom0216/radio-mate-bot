// 에어코리아(한국환경공단) 대기오염정보: 시도별 실시간 측정값(미세먼지 PM10·초미세먼지 PM2.5)과 예보통보(내일·모레).
// 공공데이터포털 서비스키(기상청과 같은 키)로 호출하며, "한국환경공단_에어코리아_대기오염정보" 활용신청이 승인돼야 응답합니다.
// 서비스키는 메시지·로그에 남기지 않고, 측정값은 시도 안 대표 측정소의 원본값입니다(시·군은 소속 시도 기준).
import {normalizeKey} from './weather-kma.mjs';
const BASE='https://apis.data.go.kr/B552584/ArpltnInforInqireSvc';
const SIDO=new Set(['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주']);
const CITY_SIDO={성남:'경기',고양:'경기',용인:'경기',부천:'경기',안산:'경기',안양:'경기',남양주:'경기',평택:'경기',시흥:'경기',파주:'경기',김포:'경기',원주:'강원',강릉:'강원',속초:'강원',충주:'충북',천안:'충남',아산:'충남',군산:'전북',익산:'전북',포항:'경북',구미:'경북',경주:'경북',김해:'경남',진주:'경남',거제:'경남',양산:'경남',서귀포:'제주',목포:'전남',여수:'전남',순천:'전남'};
// 예보통보의 권역 이름(경기남부·경기북부, 강원영서·강원영동)에 맞춰 찾을 후보를 우선순위대로 돌려줍니다.
const FORECAST_KEYS={경기:['경기남부','경기'],강원:['영서','강원영서','강원']};
const NORTH_GYEONGGI=new Set(['고양','파주','남양주','김포']),EAST_GANGWON=new Set(['강릉','속초']);
export const sidoOf=id=>SIDO.has(id)?id:CITY_SIDO[id]||null;
export function forecastKeys(id){const sido=sidoOf(id);if(sido==='경기')return NORTH_GYEONGGI.has(id)?['경기북부','경기']:FORECAST_KEYS.경기;if(sido==='강원')return EAST_GANGWON.has(id)?['영동','강원영동','강원']:FORECAST_KEYS.강원;return sido?[sido]:[];}
export const GRADES=['좋음','보통','나쁨','매우나쁨'];
// 환경부 4단계 기준(㎍/㎥): 미세먼지(PM10) 30·80·150, 초미세먼지(PM2.5) 15·35·75
export function dustGrade(kind,value){const limits=kind==='pm25'?[15,35,75]:[30,80,150];return Number.isFinite(value)?limits.findIndex(limit=>value<=limit)<0?3:limits.findIndex(limit=>value<=limit):null;}
const reading=text=>{const value=Number(String(text??'').trim());return String(text??'').trim()===''||!Number.isFinite(value)||value<0?null:value;}; // 점검·미측정은 "-"로 옵니다
export class AirKorea{
 constructor({fetcher=fetch,now=Date.now,key='',base=BASE,keyParam='serviceKey'}){Object.assign(this,{fetcher,now,key:normalizeKey(key),base:String(base).replace(/\/$/,''),keyParam});this.memo=new Map();}
 once(name,ttl,task){const hit=this.memo.get(name);if(hit&&hit.until>this.now())return hit.value;const value=task().catch(error=>{this.memo.delete(name);throw error;});if(this.memo.size>=100)this.memo.delete(this.memo.keys().next().value);this.memo.set(name,{value,until:this.now()+ttl});return value;}
 async call(operation,params){
  const url=new URL(`${this.base}/${operation}`);url.search=new URLSearchParams({[this.keyParam]:this.key,returnType:'json',pageNo:'1',numOfRows:'300',...params});
  const response=await this.fetcher(url,{signal:AbortSignal.timeout(8000)});
  if(!response.ok){let reason='';try{reason=String((await response.json())?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg||'').slice(0,60);}catch{}throw Error(`에어코리아 서버가 응답하지 않습니다(HTTP ${response.status}${reason?' '+reason:''}).`);}
  let json;try{json=await response.json();}catch{throw Error('에어코리아 응답 형식을 확인하지 못했습니다.');}
  const header=json?.response?.header||{};if(header.resultCode!=='00')throw Error('에어코리아 요청이 거절되었습니다('+(header.resultCode||'?')+' '+String(header.resultMsg||'').slice(0,60)+').');
  const body=json.response.body||{};return Array.isArray(body.items)?body.items:Array.isArray(body.items?.item)?body.items.item:[];
 }
 // 시도 안 대표 측정소 원본값. {sido,time,pm10,pm25,station}. 값이 하나도 없으면 예외.
 realtime(sido){
  return this.once('now:'+sido,20*60000,async()=>{ // 측정값은 매시 갱신되고 개발계정 한도가 기능당 하루 500건이라 20분 캐시
   const items=await this.call('getCtprvnRltmMesureDnsty',{sidoName:sido,ver:'1.3'});
   // 원본값을 바꾸지 않도록 평균 대신 대표 측정소 한 곳의 값을 그대로 씁니다(두 값이 모두 있는 첫 측정소, 없으면 값이 있는 첫 측정소).
   const rows=items.map(item=>({station:String(item.stationName||'').trim(),time:String(item.dataTime||''),pm10:reading(item.pm10Value),pm25:reading(item.pm25Value)})).filter(row=>row.pm10!==null||row.pm25!==null);
   const pick=rows.find(row=>row.pm10!==null&&row.pm25!==null)||rows[0];
   if(!pick)throw Error(`${sido} 미세먼지 측정값이 아직 없어요. 잠시 뒤 다시 시도해주세요.`);
   return {sido,time:pick.time,pm10:pick.pm10,pm25:pick.pm25,station:pick.station};
  });
 }
 // 예보통보(PM10·PM2.5)의 date(YYYY-MM-DD) 등급. {pm10,pm25}는 등급 이름 또는 null. 발표 전이면 둘 다 null.
 forecast(id,date,searchDate){
  return this.once(`forecast:${id}:${date}:${searchDate}`,30*60000,async()=>{
   const keys=forecastKeys(id),grade={};
   for(const [kind,code] of [['pm10','PM10'],['pm25','PM25']]){
    const items=await this.call('getMinuDustFrcstDspth',{searchDate:searchDate,informCode:code,numOfRows:'20'});
    const entry=items.filter(item=>String(item.informData||'')===date).sort((a,b)=>String(b.dataTime||'').localeCompare(String(a.dataTime||'')))[0];
    const table=new Map(String(entry?.informGrade||'').split(',').map(part=>part.split(':').map(piece=>piece.trim())).filter(pair=>pair.length===2&&pair[0]));
    grade[kind]=keys.map(key=>table.get(key)).find(Boolean)||null;
   }
   return grade;
  });
 }
}
const unit='㎍/㎥';
const label=(kind,value)=>{const level=dustGrade(kind,value);return level===null?'측정값 없음':`${GRADES[level]}(${kind==='pm25'?'PM2.5':'PM10'} ${value}${unit})`;};
// 마스크 안내: 나쁨 이상이면 KF94 권장
export const maskAdvice=data=>Math.max(dustGrade('pm10',data.pm10)??0,dustGrade('pm25',data.pm25)??0)>=2?'외출 시 마스크(KF94)를 권장해요':'야외 활동에 큰 문제 없어요';
export function dustReply(name,data){
 const at=data.time?` · ${data.time.slice(11,16)||data.time} 기준`:'';
 return `${name} 미세먼지${at}${data.station?` (${data.station} 측정소)`:''}\n미세먼지 ${label('pm10',data.pm10)} · 초미세먼지 ${label('pm25',data.pm25)}\n${maskAdvice(data)}\n에어코리아 · 한국환경공단`;
}
export const dustShort=data=>`미세먼지 ${GRADES[dustGrade('pm10',data.pm10)]??'-'} · 초미세먼지 ${GRADES[dustGrade('pm25',data.pm25)]??'-'}`;
export function dustForecastReply(name,when,grade){
 if(!grade.pm10&&!grade.pm25)return `${name} ${when} 미세먼지 예보는 아직 발표되지 않았어요(보통 17시·23시 발표).`;
 return `${name} ${when} 미세먼지 예보\n미세먼지 ${grade.pm10||'-'} · 초미세먼지 ${grade.pm25||'-'}\n에어코리아 예보통보`;
}
