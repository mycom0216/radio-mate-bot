// 기상청 기상특보(WthrWrnInfoService) 현황: 전국 "현재 발효 중 특보"(t6)와 예비특보(t7) 텍스트를 읽어 지역별로 알려 줍니다.
// 공공데이터포털 서비스키(기상청과 같은 키)와 "기상청_기상특보 조회서비스" 활용신청 승인이 필요합니다. 서비스키는 메시지·로그에 남기지 않습니다.
// 응답 형식(2026-11-19 실제 응답): "o 강풍주의보 : 서해5도, 충청남도(태안, 서천, 보령(도서제외)), 전라남도(여수, 목포), 인천(옹진)" 줄들.
import {sidoOf} from './air-korea.mjs';
import {normalizeKey} from './weather-kma.mjs';
const BASE='https://apis.data.go.kr/1360000/WthrWrnInfoService';
// 특보 텍스트에서 시·도를 가리키는 이름(광역시는 짧은 이름, 도는 정식 이름)
const NAMES={서울:['서울','서울특별시'],부산:['부산','부산광역시'],대구:['대구','대구광역시'],인천:['인천','인천광역시'],광주:['광주','광주광역시','전남광주통합특별시'],대전:['대전','대전광역시'],울산:['울산','울산광역시'],세종:['세종','세종특별자치시'],경기:['경기도'],강원:['강원도','강원특별자치도'],충북:['충청북도'],충남:['충청남도'],전북:['전북자치도','전북특별자치도','전라북도'],전남:['전라남도','전남광주통합특별시'],경북:['경상북도'],경남:['경상남도'],제주:['제주도','제주특별자치도']};
// 괄호 밖의 쉼표로만 나눕니다. "충청남도(태안, 보령(도서제외))"는 한 덩어리입니다.
export function splitTop(text){
 const out=[];let depth=0,current='';
 for(const ch of String(text)){if(ch==='(')depth++;if(ch===')')depth--;if(ch===','&&depth===0){out.push(current.trim());current='';}else current+=ch;}
 if(current.trim())out.push(current.trim());return out.filter(Boolean);
}
const parseArea=text=>{const open=text.indexOf('(');return open<0?{name:text.trim(),subs:[]}:{name:text.slice(0,open).trim(),subs:splitTop(text.slice(open+1,text.lastIndexOf(')')))};};
// 전국 현황 → {time:'11-19 10:00', current:[{type,areas}], preliminary:[{type,when,areas}]}
export function parseStatus(item){
 const time=String(item?.tmFc??'').replace(/^\d{4}(\d\d)(\d\d)(\d\d)(\d\d)$/,'$1-$2 $3:$4');
 const current=String(item?.t6??'').split(/\r?\n/).map(line=>/^o\s+(.+?)\s:\s(.+)$/.exec(line.trim())).filter(Boolean).map(m=>({type:m[1],areas:splitTop(m[2]).map(parseArea)}));
 const preliminary=[];let header='';
 for(const raw of String(item?.t7??'').split(/\r?\n/)){const line=raw.trim(),head=/^\(\d+\)\s*(.+)$/.exec(line),entry=/^o\s+(.+?)\s:\s(.+)$/.exec(line);if(head)header=head[1];else if(entry&&header)preliminary.push({type:header,when:entry[1],areas:splitTop(entry[2]).map(parseArea)});}
 return {time,current,preliminary};
}
const clean=sub=>sub.replace(/\(.*\)/g,'').replace(/\s*제외$/,'').trim(); // "보령(도서제외)" → "보령"
// 한 줄(areas)이 지역(regionId, 시·군이면 cityId)에 해당하는지: {hit,subs,whole}. "…제외"로 빠진 곳은 해당하지 않습니다.
export function affects(areas,regionId,cityId=null){
 const province=sidoOf(regionId),names=NAMES[province]||[];
 for(const area of areas){
  if(!names.includes(area.name))continue;
  const unified=area.name==='전남광주통합특별시',subs=area.subs.filter(sub=>!unified||(province==='광주')===sub.startsWith('광주'));
  if(unified&&!subs.length)continue;
  if(!subs.length)return {hit:true,subs:[],whole:true};
  if(cityId){const live=subs.filter(sub=>!/제외/.test(sub)).some(sub=>sub.startsWith(cityId));return {hit:live,subs:live?[cityId]:[],whole:false};}
  const listed=subs.filter(sub=>!/제외$/.test(sub)).map(clean).filter(Boolean);return {hit:true,subs:listed,whole:!listed.length};
 }
 return {hit:false,subs:[],whole:false};
}
const compact=(subs,limit)=>{let text='',count=0;for(const sub of subs){const next=text?text+'·'+sub:sub;if(next.length>limit)break;text=next;count++;}return text+(count<subs.length?` 외 ${subs.length-count}곳`:'');};
// 한 줄 요약(브리핑용): 발효 중인 특보 종류만. 없으면 null.
export function alertShort(regionId,status,cityId=null){
 const types=[...new Set(status.current.filter(line=>affects(line.areas,regionId,cityId).hit).map(line=>line.type))];
 return types.length?'⚠ '+types.slice(0,3).join('·')+' 발효 중':null;
}
export function warningReply(name,regionId,status,cityId=null){
 const province=sidoOf(regionId),label=cityId?`${name}(${province})`:name,lines=[];
 for(const line of status.current){const found=affects(line.areas,regionId,cityId);if(found.hit)lines.push(`${line.type}${cityId?` (${cityId} 포함)`:found.subs.length?': '+compact(found.subs,38):''}`);}
 const ahead=status.preliminary.filter(entry=>affects(entry.areas,regionId,cityId).hit).map(entry=>`${entry.type.replace(/\s*예비특보/,'')} ${entry.when.replace(/\(.*\)/,'').trim()}`);
 const head=`${label} 기상특보 · ${status.time} 발표`;
 if(!lines.length&&!ahead.length)return `${label}에 발효 중인 기상특보가 없어요 (${status.time} 발표 기준)\n기상청 · KST`;
 return [head,...(lines.length?lines.slice(0,4):[`발효 중인 특보 없음`]),...(ahead.length?['예비특보: '+ahead.slice(0,2).join(' · ')]:[]),'기상청 · KST'].join('\n');
}
export class KmaWarnings{
 constructor({fetcher=fetch,now=Date.now,key='',base=BASE,keyParam='serviceKey'}){Object.assign(this,{fetcher,now,key:normalizeKey(key),base:String(base).replace(/\/$/,''),keyParam});this.cache=null;}
 // 5분 캐시. 실패는 캐시하지 않습니다.
 async status(){
  if(this.cache&&this.cache.until>this.now())return this.cache.value;
  const url=new URL(this.base+'/getPwnStatus');url.search=new URLSearchParams({[this.keyParam]:this.key,pageNo:'1',numOfRows:'10',dataType:'JSON',stnId:'108'});
  const response=await this.fetcher(url,{signal:AbortSignal.timeout(8000)});
  if(!response.ok){let reason='';try{reason=String((await response.json())?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg||'').slice(0,60);}catch{}throw Error(`기상특보 서버가 응답하지 않습니다(HTTP ${response.status}${reason?' '+reason:''}).`);}
  let json;try{json=await response.json();}catch{throw Error('기상특보 응답 형식을 확인하지 못했습니다.');}
  const header=json?.response?.header||{};if(header.resultCode!=='00')throw Error('기상특보 요청이 거절되었습니다('+(header.resultCode||'?')+' '+String(header.resultMsg||'').slice(0,60)+').');
  const item=json.response.body?.items?.item,entry=Array.isArray(item)?item[0]:item;if(!entry)throw Error('기상특보 응답이 비어 있습니다.');
  const value=parseStatus(entry);this.cache={value,until:this.now()+5*60000};return value;
 }
}
