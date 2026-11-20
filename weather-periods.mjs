const DAY=86400000;
export const periodLabels={current:'현재',tomorrow:'내일',thisWeek:'이번주',nextWeek:'다음주'};
export const koreaDate=now=>new Date(now+9*3600000).toISOString().slice(0,10);
export const shiftDate=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
export function weatherRange(period,now=Date.now()){
 if(!Object.hasOwn(periodLabels,period))throw Error('날씨 기간은 현재·내일·이번주·다음주 중 선택해주세요.');
 const today=koreaDate(now),weekday=(new Date(today+'T00:00:00Z').getUTCDay()+6)%7;
 const start=period==='tomorrow'?shiftDate(today,1):period==='thisWeek'?shiftDate(today,-weekday):period==='nextWeek'?shiftDate(today,7-weekday):today;
 const end=['thisWeek','nextWeek'].includes(period)?shiftDate(start,6):start;
 return {period,label:periodLabels[period],today,start,end,dates:Array.from({length:start===end?1:7},(_,i)=>shiftDate(start,i))};
}
// "대한민국 각 지역별", "전체 지역", "시도별"처럼 지역 이름이 아니라 "전부 보여 달라"는 낱말입니다. 지역명으로 오해하지 않도록 먼저 지웁니다.
const NATIONAL_WORDS=/대한민국|우리나라|한국|(?:모든|전체|전)\s*지역|각\s*지역별?|각\s*지방|지역별|지방별|시\s*·?\s*도별|도별|전체|전부|모두/gu;
const SUMMARY_WORD=/(?:^|\s)(?:요약|한눈에|간단히)(?=\s|$)/gu;
export function parseWeatherQuery(arg='',now=Date.now()){
 let text=String(arg).trim().replace(/이번\s*주/g,'이번주').replace(/다음\s*주/g,'다음주');
 // 부가 기능 낱말(시간별·우산·옷차림·일출·도움말)은 지역명이 아니라 동작 선택입니다. 먼저 떼어 내 mode로 돌려줍니다.
 const modeMatch=/(?:^|\s)(시간별|시간대별|우산|옷차림|일출|일몰|브리핑|어제|초미세먼지|미세먼지|먼지|기상특보|특보|도움말|도움)(?=\s|$)/.exec(text),mode=modeMatch?{시간별:'hourly',시간대별:'hourly',우산:'umbrella',옷차림:'outfit',일출:'sun',일몰:'sun',브리핑:'briefing',어제:'yesterday',초미세먼지:'dust',미세먼지:'dust',먼지:'dust',기상특보:'alert',특보:'alert',도움말:'help',도움:'help'}[modeMatch[1]]:null;
 if(modeMatch)text=(text.slice(0,modeMatch.index)+' '+text.slice(modeMatch.index+modeMatch[0].length)).trim();
 // '요약'은 지역별 목록 대신 하루 단위 전국 요약을 보고 싶다는 뜻입니다.
 const summary=new RegExp(SUMMARY_WORD.source,'u').test(text);if(summary)text=text.replace(SUMMARY_WORD,' ').trim();
 // Explicit tomorrow wins even in phrases such as '이번주 전국 내일 날씨'.
 let period=text.includes('내일')?'tomorrow':text.includes('다음주')?'nextWeek':text.includes('이번주')?'thisWeek':'current';
 const weekday=/([월화수목금토일])요일/.exec(text)?.[1],dateToken=/\b\d{4}-\d{2}-\d{2}\b/.exec(text)?.[0];
 if((weekday||dateToken)&&period==='current')period='thisWeek';
 const match=/(?:^|\s)(\d+)$/.exec(text),page=match?Number(match[1]):1;if(match)text=text.slice(0,match.index);
 if(!Number.isSafeInteger(page)||page<1)throw Error('날씨 페이지는 1 이상의 정수로 입력해주세요.');
 const range=weatherRange(period,now);let date=period==='tomorrow'?range.start:dateToken||(weekday?shiftDate(range.start,'월화수목금토일'.indexOf(weekday)):null);
 if(date&&!range.dates.includes(date))throw Error(`선택한 날짜는 ${range.start}~${range.end} 범위에 있어야 합니다.`);
 const region=text.replace(NATIONAL_WORDS,' ').replace(/이번주|다음주|내일|오늘|현재|전국\s*날씨|전국|날씨|[월화수목금토일]요일|\b\d{4}-\d{2}-\d{2}\b/g,' ').trim().replace(/\s+/g,' ');
 return {...range,page,pageGiven:!!match,date,region,mode,summary};
}
// 지역을 따로 정하지 않은 이번주·다음주 질문은 17개 시·도를 지역별로 모두 보여 줍니다.
export const isRegionWeek=(selection,region=selection.region)=>!region&&!selection.date&&!selection.summary&&!selection.mode&&['thisWeek','nextWeek'].includes(selection.period);
const RAINY=/비|소나기|빗방울|우박|뇌우/u,SNOWY=/눈/u;
const whole=n=>{const value=Math.sign(n)*Math.round(Math.abs(n));return value===0?0:value;}; // 영상·영하 모두 .5는 0에서 먼 쪽으로, -0은 "0"으로
function weekLine(item,mixed){
 const days=item.days.filter(d=>d?.available);
 if(!days.length)return `${item.region} 예보 미제공`;
 const wet=days.filter(d=>RAINY.test(d.condition)||SNOWY.test(d.condition));let label;
 if(wet.length){const rain=wet.some(d=>RAINY.test(d.condition)),snow=wet.some(d=>SNOWY.test(d.condition));label=(rain&&snow?'비·눈':snow?'눈':'비')+' '+wet.length+'일';}
 else{const count=new Map();for(const d of days)count.set(d.condition,(count.get(d.condition)||0)+1);label=[...count].sort((a,b)=>b[1]-a[1])[0][0];}
 const chances=days.map(d=>d.rainChance).filter(Number.isFinite);
 return `${item.region} ${whole(Math.min(...days.map(d=>d.min)))}~${whole(Math.max(...days.map(d=>d.max)))}℃ ${label}${chances.length?` 강수${Math.max(...chances)}%`:''}${days.length<item.days.length?` (${days.length}일)`:''}${mixed&&days.some(d=>d.source==='Open-Meteo')?'*':''}`;
}
// 이번주·다음주 "지역별" 날씨: 시·도 한 곳이 한 줄(주간 최저~최고, 비·눈 오는 날 수 또는 가장 많은 날씨, 최대 강수확률)이고 200자 한도에 맞춰 쪽을 나눕니다.
// hint=false는 모든 쪽을 연달아 보낼 때(쪽 안내 불필요), true는 한 쪽씩 보여 줄 때 다음 쪽 입력법을 덧붙입니다.
export function regionWeekPages(data,selection,{hint=true}={}){
 const items=data.items,all=items.flatMap(item=>item.days);
 const used=[...new Set(all.filter(d=>d?.available).map(d=>d.source||'Open-Meteo'))].sort((a,b)=>(a==='기상청'?0:1)-(b==='기상청'?0:1)),mixed=used.length>1;
 const label=(used.length?used:[data.source||'Open-Meteo']).join('+')+(mixed?'(*)':''),past=all.filter(d=>d?.available&&d.past);
 const pastNote=data.dates.some(d=>d<data.today)?(!past.length||past.some(d=>(d.source||'Open-Meteo')==='Open-Meteo')?' · 과거=모델자료':' · 과거=저장예보'):'';
 const partialNote=all.some(d=>d?.available&&d.partial)?' · 오늘은 남은 시간 기준':'';
 const lines=items.map(item=>weekLine(item,mixed)),command=`!전국날씨 ${data.label}`;
 const build=(chunk,page,total)=>`${data.label} ${data.start.slice(5)}~${data.end.slice(5)} 지역별 (${page}/${total})\n${chunk.join('\n')}\n${label} · KST${partialNote}${pastNote}`+(hint?`\n${command} ${page<total?page+1:1}`:'');
 // 쪽마다 비슷한 줄 수가 되도록 쪽 수를 1부터 늘려 가며 모두 200자 안에 들어가는 첫 분할을 고릅니다.
 for(let total=1;total<=lines.length;total++){
  const base=Math.floor(lines.length/total),extra=lines.length%total,chunks=[];let at=0;
  for(let i=0;i<total;i++){const size=base+(i<extra?1:0);chunks.push(lines.slice(at,at+size));at+=size;} // 17곳을 4쪽이면 5·4·4·4곳처럼 고르게
  if(chunks.every((chunk,i)=>build(chunk,i+1,total).length<=200))return chunks.map((chunk,i)=>build(chunk,i+1,total));
 }
 return lines.map((line,i)=>build([line],i+1,lines.length));
}
const temperature=n=>Number(n.toFixed(1));
export function forecastReply(data,selection){
 const {page,region,date,period}=selection,items=data.items;
 const rain=n=>Number.isFinite(n)?n+'%':'강수 미제공';
 const describe=d=>d?.available?`${temperature(d.min)}~${temperature(d.max)}℃ ${d.condition} ${rain(d.rainChance)}`:'예보 미제공';
 const weekly=['thisWeek','nextWeek'].includes(period);
 // 날짜별 출처(day.source)가 섞이면 모델 보충일에 *를 붙입니다. 출처가 없는 기존(Open-Meteo 전용) 자료는 예전 출력과 같습니다.
 const all=items.flatMap(item=>item.days),used=[...new Set(all.filter(d=>d?.available).map(d=>d.source||'Open-Meteo'))].sort((a,b)=>(a==='기상청'?0:1)-(b==='기상청'?0:1)),mixed=used.length>1,mark=d=>mixed&&d?.available&&d.source==='Open-Meteo'?'*':'';
 let lines,scope;
 if(region){lines=items[0].days.filter(d=>!date||d.date===date).map(d=>`${d.date.slice(5)} ${describe(d)}${mark(d)}`);scope=items[0].region+' 대표지점 · 최저~최고';}
 else if(!weekly||date){lines=items.map(item=>`${item.region} ${describe(item.days.find(d=>d.date===(date||data.start)))}${mark(item.days.find(d=>d.date===(date||data.start)))}`);scope=(date||data.start)+' · 지역별 최저~최고';}
 else {scope='17지역 전체 기온범위·최대강수확률';lines=data.dates.map(day=>{const days=items.map(item=>item.days.find(d=>d.date===day)).filter(d=>d?.available);if(!days.length)return day.slice(5)+' 예보 미제공';const chances=days.map(d=>d.rainChance).filter(Number.isFinite);return `${day.slice(5)} ${temperature(Math.min(...days.map(d=>d.min)))}~${temperature(Math.max(...days.map(d=>d.max)))}℃ ${rain(chances.length?Math.max(...chances):null)}${days.length<items.length?' ('+days.length+'/17지역)':''}`;});}
 const title=`${data.label} ${data.start}~${data.end}`,command=`!${region?'날씨 '+region:'전국날씨'} ${data.label}${date&&weekly?' '+date:''}`;
 const label=(used.length?used:[data.source||'Open-Meteo']).join('+')+(mixed?'(*)':''),past=all.filter(d=>d?.available&&d.past),pastNote=data.dates.some(d=>d<data.today)?(!past.length||past.some(d=>(d.source||'Open-Meteo')==='Open-Meteo')?' · 과거=모델자료':' · 과거=저장예보'):'';
 const partialNote=all.some(d=>d?.available&&d.partial)?' · 오늘은 남은 시간 기준':'',prefix=title+'\n'+scope+'\n',suffix='\n'+label+' · KST'+partialNote+pastNote+'\n';
 const budget=200-prefix.length-suffix.length-command.length-12,pages=[];let batch=[];
 for(const line of lines){if(batch.length&&[...batch,line].join('\n').length>budget){pages.push(batch);batch=[];}batch.push(line);}if(batch.length)pages.push(batch);
 if(page>pages.length)return `날씨는 1~${pages.length}페이지입니다. ${command} 1`;
 return prefix+`${page}/${pages.length}\n`+pages[page-1].join('\n')+suffix+command+' '+(page<pages.length?page+1:1);
}
