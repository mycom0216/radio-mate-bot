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
export function parseWeatherQuery(arg='',now=Date.now()){
 let text=String(arg).trim().replace(/이번\s*주/g,'이번주').replace(/다음\s*주/g,'다음주');
 // 부가 기능 낱말(시간별·우산·옷차림·일출·도움말)은 지역명이 아니라 동작 선택입니다. 먼저 떼어 내 mode로 돌려줍니다.
 const modeMatch=/(?:^|\s)(시간별|시간대별|우산|옷차림|일출|일몰|브리핑|어제|초미세먼지|미세먼지|먼지|기상특보|특보|도움말|도움)(?=\s|$)/.exec(text),mode=modeMatch?{시간별:'hourly',시간대별:'hourly',우산:'umbrella',옷차림:'outfit',일출:'sun',일몰:'sun',브리핑:'briefing',어제:'yesterday',초미세먼지:'dust',미세먼지:'dust',먼지:'dust',기상특보:'alert',특보:'alert',도움말:'help',도움:'help'}[modeMatch[1]]:null;
 if(modeMatch)text=(text.slice(0,modeMatch.index)+' '+text.slice(modeMatch.index+modeMatch[0].length)).trim();
 // Explicit tomorrow wins even in phrases such as '이번주 전국 내일 날씨'.
 let period=text.includes('내일')?'tomorrow':text.includes('다음주')?'nextWeek':text.includes('이번주')?'thisWeek':'current';
 const weekday=/([월화수목금토일])요일/.exec(text)?.[1],dateToken=/\b\d{4}-\d{2}-\d{2}\b/.exec(text)?.[0];
 if((weekday||dateToken)&&period==='current')period='thisWeek';
 const match=/(?:^|\s)(\d+)$/.exec(text),page=match?Number(match[1]):1;if(match)text=text.slice(0,match.index);
 if(!Number.isSafeInteger(page)||page<1)throw Error('날씨 페이지는 1 이상의 정수로 입력해주세요.');
 const range=weatherRange(period,now);let date=period==='tomorrow'?range.start:dateToken||(weekday?shiftDate(range.start,'월화수목금토일'.indexOf(weekday)):null);
 if(date&&!range.dates.includes(date))throw Error(`선택한 날짜는 ${range.start}~${range.end} 범위에 있어야 합니다.`);
 const region=text.replace(/대한민국|우리나라|한국|각\s*지역별|지역별|전체\s*지역|모든\s*지역|시\s*[·/ㆍ]?\s*군\s*[·/ㆍ]?\s*구|이번주|다음주|내일|오늘|현재|전국\s*날씨|전국|날씨|[월화수목금토일]요일|\b\d{4}-\d{2}-\d{2}\b|알려주세요|알려줘|보여줘|예보|전체/g,' ').trim().replace(/\s+/g,' ');
 return {...range,page,date,region,mode};
}
export function weatherRequest(message){
 const text=String(message||'').normalize('NFKC').trim(),command=text.startsWith('!'),body=text.replace(/^!\s*/u,'');
 if(!/날씨/u.test(body)||/^(채팅|대화)(?:\s|$)/u.test(body))return null;
 // Ordinary conversation is untouched; bare text is accepted only for an explicit nationwide weekly request.
 if(!command&&!/^(이번\s*주|다음\s*주)/u.test(body))return null;
 if(!command&&!/전국/u.test(body))return null;
 if(!command&&!/날씨(?:\s*(?:알려줘|알려주세요|보여줘|\d+))?$/u.test(body))return null;
 if(command&&!/^(날씨|전국|대한민국|이번\s*주|다음\s*주|내일|오늘|현재|각\s*지역별|전체\s*지역)/u.test(body))return null;
 return {kind:/전국|대한민국|각\s*지역별|전체\s*지역/u.test(body)?'전국날씨':'날씨',arg:body};
}

// Stable district-major pagination: a single request never fetches all 257 forecasts.
export function districtChatPage(selection,locations){
 const dates=selection.date?[selection.date]:selection.dates,groups=[];
 for(let offset=0;offset<dates.length;offset+=2)groups.push(dates.slice(offset,offset+2));
 const pages=locations.length*groups.length;if(selection.page>pages)throw Error(`전국 지역별 예보는 1~${pages}페이지입니다. !전국날씨 ${selection.label} 1`);
 const index=selection.page-1;return {location:locations[Math.floor(index/groups.length)],dates:groups[index%groups.length],pages,total:locations.length};
}
export function districtForecastReply(data,selection,plan){
 const item=data.items[0],label=item.displayName||item.region,header=`${selection.label} ${data.start}~${data.end.slice(5)} ${selection.page}/${plan.pages}\n${label} · ${plan.total}지역\n`;
 const rows=plan.dates.map(date=>{const day=item.days.find(day=>day.date===date);return date.slice(5)+' '+(!day?.available?'예보 미제공':`${day.condition.slice(0,7)} ${temperature(day.min)}~${temperature(day.max)}℃ ${Number.isFinite(day.rainChance)?day.rainChance+'%':'강수?'}${day.source==='기상청'?'K':'M'}${day.past?'과거':''}${day.partial?'부분':''}`);});
 const command=`!전국날씨 ${selection.label}${selection.date?' '+selection.date:''}${selection.region?' '+selection.region:''} ${selection.page<plan.pages?selection.page+1:1}`;
 const suffix='\nK기상청 M=Open-Meteo · 과거자료\n'+command;
 return header+rows.join('\n')+suffix;
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
