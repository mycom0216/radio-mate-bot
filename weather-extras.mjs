// 날씨 부가 기능: 체감온도, 시간별 예보, 우산·옷차림 안내, 일출·일몰, 도움말.
// 순수 함수만 두고(자료 조회는 lifestyle.mjs가 맡습니다) 모든 답은 스푼 채팅 200자 안에 들어오게 만듭니다.
import {koreaDate,shiftDate} from './weather-periods.mjs';
const rowTime=row=>Date.parse(row.date+'T00:00:00Z')+row.hour*3600000-9*3600000; // hour 24 = 다음 날 0시
const clock=hour=>String(hour===24?0:hour).padStart(2,'0');
const dayLabel=date=>`${date.slice(5)}(${'일월화수목금토'[new Date(date+'T00:00:00Z').getUTCDay()]})`;
const commonest=values=>{const counts=new Map();for(const value of values)counts.set(value,(counts.get(value)||0)+1);return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]??'';};
export const weatherHelp='날씨 안내 ♡ !날씨 서울 · !날씨 서울 부산 제주(여러 지역) · !날씨 서울 내일 / 이번주 / 다음주 · !브리핑 · !시간별 · !우산 · !옷차림 · !미세먼지 · !특보 · !어제 · !일출 (뒤에 지역을 붙여요) · !전국날씨. 지역을 빼면 기본 지역(서울)이에요.';

// 겨울철 체감온도(기상청 공식): 기온 10℃ 이하, 풍속 1.3m/s 이상일 때 13.12+0.6215T-11.37V^0.16+0.3965V^0.16T (V: km/h). 그 밖에는 null.
export function feelsLike(temp,wind){
 if(!Number.isFinite(temp)||!Number.isFinite(wind)||temp>10||wind<1.3)return null;
 const power=(wind*3.6)**0.16;return Math.round((13.12+0.6215*temp-11.37*power+0.3965*power*temp)*10)/10;
}
// 현재 날씨 한 줄. 지역 하나를 조회할 때(detail)만 체감온도(2℃ 이상 차이 아닌 1℃ 이상)·습도·바람을 덧붙입니다.
export function currentLine(item,detail=false){
 const feels=detail&&Number.isFinite(item.feels)&&Math.abs(item.temperature-item.feels)>=1?`(체감 ${item.feels}℃)`:'';
 const extra=detail&&Number.isFinite(item.humidity)?` · 습도 ${item.humidity}%${Number.isFinite(item.wind)?` · 바람 ${item.wind}m/s`:''}`:'';
 return `${item.region} ${item.temperature}℃${feels} ${item.condition}${extra}`;
}

const OUTFITS=[[28,'민소매·반팔·반바지'],[23,'반팔·얇은 셔츠·반바지·면바지'],[20,'얇은 가디건·긴팔·면바지·청바지'],[17,'얇은 니트·맨투맨·가디건·청바지'],[12,'자켓·가디건·야상·스타킹·청바지'],[9,'자켓·트렌치코트·야상·니트·청바지'],[5,'코트·가죽자켓·히트텍·니트·레깅스'],[-Infinity,'패딩·두꺼운 코트·목도리·기모 제품']];
export const outfitFor=temp=>OUTFITS.find(([min])=>temp>=min)[1];
export function outfitReply(name,{temp,feels,min,max}){
 const reference=Number.isFinite(feels)?feels:temp,now=`${temp}℃${Number.isFinite(feels)&&Math.abs(temp-feels)>=1?`(체감 ${feels}℃)`:''}`;
 const range=Number.isFinite(min)&&Number.isFinite(max)?` · 오늘 ${min}~${max}℃${max-min>=10?' · 일교차가 커요, 겉옷을 챙기세요':''}`:'';
 return `${name} 옷차림 · 지금 ${now}\n${outfitFor(reference)} 추천${range}\n기상청 · KST`;
}

// 앞으로 count개(기본 6개)를 step시간(기본 3시간) 간격으로 보여 줍니다. 자료가 없으면 null.
export function hourlyReply(name,rows,now,{step=3,count=6}={}){
 const future=rows.filter(row=>rowTime(row)>now).sort((a,b)=>rowTime(a)-rowTime(b)),today=koreaDate(now),tomorrow=shiftDate(today,1);
 if(!future.length)return null;
 const picks=[];for(let i=0;i<future.length&&picks.length<count;i+=step)picks.push(future[i]);
 const label=row=>{const date=row.hour===24?shiftDate(row.date,1):row.date;return `${date===today?'':date===tomorrow?'내일 ':date.slice(5)+' '}${clock(row.hour)}시`;};
 return `${name} 시간별 예보 · ${today.slice(5)}\n${picks.map(row=>`${label(row)} ${row.temp}℃ ${row.wf}${Number.isFinite(row.pop)?' '+row.pop+'%':''}`).join('\n')}\n기상청 · KST`;
}

const wetSpan=items=>{const wet=items.filter(row=>row.pty>0);return wet.length?{word:commonest(wet.map(row=>row.wf)),from:wet[0].hour,to:wet.at(-1).hour}:null;};
const maxPop=items=>Math.max(0,...items.map(row=>row.pop).filter(Number.isFinite)),when=s=>`${s.word} ${clock(s.from)}${s.from===s.to?'':'~'+clock(s.to)}시`;
// 오늘 남은 시간의 우산 판단. 남은 예보가 없으면 null.
function todayVerdict(rows,now){
 const today=koreaDate(now),left=rows.filter(row=>row.date===today&&rowTime(row)>now);if(!left.length)return null;
 const span=wetSpan(left),pop=maxPop(left);
 return {span,pop,text:span?(/눈/.test(span.word)&&!/비/.test(span.word)?'눈이 와요, 미끄럼 조심하세요':'우산 챙기세요 ☂'):pop>=40?'접이식 우산 하나 챙기면 좋아요':'우산은 필요 없어요'};
}
// 우산 안내: 오늘 남은 시간·내일은 시간별 예보(rows)로, 그 뒤는 주간 예보에서 고른 비·눈 날짜(wetDays, 못 구했으면 null)로 알려 줍니다.
export function umbrellaReply(name,rows,now,wetDays=null){
 const today=koreaDate(now),tomorrow=shiftDate(today,1),next=rows.filter(row=>row.date===tomorrow),b=wetSpan(next),verdict=todayVerdict(rows,now),lines=[];
 if(!verdict)lines.push(`${name} 우산 · 오늘은 남은 예보가 없어요`);
 else lines.push(`${name} 우산 · 오늘 ${verdict.text} (${verdict.span?when(verdict.span)+' · ':'남은 시간 '}강수확률 최대 ${verdict.pop}%)`);
 if(next.length)lines.push(`내일 ${b?when(b):'비·눈 소식 없음'} (강수확률 최대 ${maxPop(next)}%)`);
 if(wetDays){const later=wetDays.filter(day=>day.date>tomorrow).slice(0,4);lines.push(later.length?'이후 비·눈: '+later.map(day=>dayLabel(day.date)).join(' · '):'이번 주·다음 주 이후 비·눈 소식은 없어요');}
 return lines.join('\n')+'\n기상청 · KST';
}

const gap=(a,b)=>{const d=Math.round((a-b)*10)/10;return d===0?'같아요':`${Math.abs(d)}℃ ${d>0?'높아요':'낮아요'}`;};
const vsYesterday=(a,b)=>{const d=Math.round((a-b)*10)/10;return d===0?'어제와 같음':`어제보다 ${Math.abs(d)}℃ ${d>0?'높음':'낮음'}`;};
// 어제와 오늘 비교. yesterday: {min,max,source}(없으면 null), today: {min,max}.
export function yesterdayReply(name,{yesterday,today}){
 if(!yesterday)return `${name} 어제 기록이 아직 없어요. 서버가 날씨를 저장한 날부터 비교할 수 있어요.`;
 const head=`${name} 어제 ${yesterday.min}~${yesterday.max}℃ (${yesterday.source})`;
 return today?`${head}\n오늘 ${today.min}~${today.max}℃ · 최고는 어제보다 ${gap(today.max,yesterday.max)}, 최저는 ${gap(today.min,yesterday.min)}\n기상청 · KST`:head;
}
// 방송 시작용 한 줄 브리핑: 현재(실황)·오늘 최저/최고(어제와의 차이)·우산 판단·일출/일몰·옷차림. 구하지 못한 항목은 건너뜁니다.
export function briefingReply(name,{now,item,day,rows=[],lat,lon,yesterday=null,dust=null,alert=null}){
 const today=koreaDate(now),clockOf=minutes=>{const m=Math.round(minutes);return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;};
 const feels=item&&Number.isFinite(item.feels)&&Math.abs(item.temperature-item.feels)>=1?`(체감 ${item.feels}℃)`:'';
 const verdict=todayVerdict(rows,now),sun=Number.isFinite(lat)&&Number.isFinite(lon)?sunTimes(lat,lon,today):null;
 const reference=item?(Number.isFinite(item.feels)?item.feels:item.temperature):day?(day.min+day.max)/2:null;
 return [`${name} 오늘 브리핑 · ${dayLabel(today)}`,alert||'',
  [item?`지금 ${item.temperature}℃${feels} ${item.condition}`:'',day?`최저 ${day.min} · 최고 ${day.max}℃${yesterday?` (${vsYesterday(day.max,yesterday.max)})`:''}`:''].filter(Boolean).join(' · '),
  [verdict?verdict.text+(verdict.span?` (${when(verdict.span)})`:''):'',sun?`일출 ${clockOf(sun.sunrise)} · 일몰 ${clockOf(sun.sunset)}`:''].filter(Boolean).join(' · '),
  dust||'',
  reference===null?'':`${outfitFor(reference)} 추천${day&&day.max-day.min>=10?' · 일교차 큼':''}`,
  '기상청 · KST'].filter(Boolean).join('\n');
}

// 일출·일몰(NOAA 태양 위치 계산식, 오차 1~2분). 반환은 자정부터의 분(KST 기준), 백야·극야이면 null.
export function sunTimes(lat,lon,date,zone=9){
 const rad=Math.PI/180,deg=180/Math.PI,[year,month,day]=date.split('-').map(Number);
 const jc=(Date.UTC(year,month-1,day,12-zone)/86400000+2440587.5-2451545)/36525; // 현지 정오 기준 율리우스 세기
 const l0=(280.46646+jc*(36000.76983+jc*0.0003032))%360,mean=357.52911+jc*(35999.05029-0.0001537*jc),ecc=0.016708634-jc*(0.000042037+0.0000001267*jc);
 const center=Math.sin(mean*rad)*(1.914602-jc*(0.004817+0.000014*jc))+Math.sin(2*mean*rad)*(0.019993-0.000101*jc)+Math.sin(3*mean*rad)*0.000289;
 const omega=(125.04-1934.136*jc)*rad,apparent=l0+center-0.00569-0.00478*Math.sin(omega);
 const obliquity=23+(26+(21.448-jc*(46.815+jc*(0.00059-jc*0.001813)))/60)/60+0.00256*Math.cos(omega);
 const declination=Math.asin(Math.sin(obliquity*rad)*Math.sin(apparent*rad))*deg,y=Math.tan(obliquity*rad/2)**2;
 const equation=4*deg*(y*Math.sin(2*l0*rad)-2*ecc*Math.sin(mean*rad)+4*ecc*y*Math.sin(mean*rad)*Math.cos(2*l0*rad)-0.5*y*y*Math.sin(4*l0*rad)-1.25*ecc*ecc*Math.sin(2*mean*rad));
 const cosine=Math.cos(90.833*rad)/(Math.cos(lat*rad)*Math.cos(declination*rad))-Math.tan(lat*rad)*Math.tan(declination*rad);
 if(!(cosine>=-1&&cosine<=1))return null;
 const half=Math.acos(cosine)*deg*4,noon=720-4*lon-equation+zone*60;
 return {sunrise:noon-half,sunset:noon+half};
}
// 자동 안내 문구의 날씨 자리표시자를 보낼 때 실시간 정보로 바꿉니다. 예) "좋은 아침이에요 {브리핑 서울}" · "{미세먼지 부산}" · "{전국날씨}"
// 조회가 실패한 자리는 비우고, 전부 비면 빈 문자열(보내지 않음)을 돌려줍니다. 자리표시자가 없으면 문구를 그대로 돌려줍니다.
const TOKEN=/\{\s*(전국날씨|날씨|브리핑|우산|옷차림|시간별|일출|일몰|미세먼지|특보)([^{}]*)\}/gu;
const TOKEN_TEST=new RegExp(TOKEN.source,'u');
export const hasWeatherTokens=text=>TOKEN_TEST.test(String(text)); // 자리표시자가 없으면 기다리지 않고 바로 보내도록(전송 타이밍을 바꾸지 않음) 먼저 확인합니다.
export async function expandWeatherTokens(text,answer){
 const source=String(text),matches=[...source.matchAll(TOKEN)];if(!matches.length)return source;
 let out='',last=0;
 for(const match of matches){
  out+=source.slice(last,match.index);last=match.index+match[0].length;
  const word=match[1],arg=match[2].trim();
  try{out+=String(await answer({kind:word==='전국날씨'?'전국날씨':'날씨',arg:['날씨','전국날씨'].includes(word)?arg:`${arg} ${word}`.trim()})??'');}catch{/* 조회 실패: 이 자리는 비웁니다 */}
 }
 return (out+source.slice(last)).trim().slice(0,200);
}
export function sunReply(name,lat,lon,date,label){
 const sun=sunTimes(lat,lon,date);if(!sun)return `${name} ${label} 해가 뜨고 지는 시각을 계산할 수 없어요.`;
 const at=minutes=>{const m=Math.round(minutes);return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;},length=Math.round(sun.sunset-sun.sunrise);
 return `${name} ${label} 일출 ${at(sun.sunrise)} · 일몰 ${at(sun.sunset)} · 낮 ${Math.floor(length/60)}시간 ${length%60}분\n${date.slice(5)} · 천문 계산값(오차 1~2분)`;
}
