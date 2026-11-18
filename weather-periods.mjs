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
 // Explicit tomorrow wins even in phrases such as '이번주 전국 내일 날씨'.
 let period=text.includes('내일')?'tomorrow':text.includes('다음주')?'nextWeek':text.includes('이번주')?'thisWeek':'current';
 const weekday=/([월화수목금토일])요일/.exec(text)?.[1],dateToken=/\b\d{4}-\d{2}-\d{2}\b/.exec(text)?.[0];
 if((weekday||dateToken)&&period==='current')period='thisWeek';
 const match=/(?:^|\s)(\d+)$/.exec(text),page=match?Number(match[1]):1;if(match)text=text.slice(0,match.index);
 if(!Number.isSafeInteger(page)||page<1)throw Error('날씨 페이지는 1 이상의 정수로 입력해주세요.');
 const range=weatherRange(period,now);let date=period==='tomorrow'?range.start:dateToken||(weekday?shiftDate(range.start,'월화수목금토일'.indexOf(weekday)):null);
 if(date&&!range.dates.includes(date))throw Error(`선택한 날짜는 ${range.start}~${range.end} 범위에 있어야 합니다.`);
 const region=text.replace(/이번주|다음주|내일|오늘|현재|전국\s*날씨|전국|날씨|[월화수목금토일]요일|\b\d{4}-\d{2}-\d{2}\b/g,' ').trim().replace(/\s+/g,' ');
 return {...range,page,date,region};
}
const temperature=n=>Number(n.toFixed(1));
export function forecastReply(data,selection){
 const {page,region,date,period}=selection,items=data.items;
 const rain=n=>Number.isFinite(n)?n+'%':'강수 미제공';
 const describe=d=>d?.available?`${temperature(d.min)}~${temperature(d.max)}℃ ${d.condition} ${rain(d.rainChance)}`:'예보 미제공';
 const weekly=['thisWeek','nextWeek'].includes(period);
 let lines,scope;
 if(region){lines=items[0].days.filter(d=>!date||d.date===date).map(d=>`${d.date.slice(5)} ${describe(d)}`);scope=items[0].region+' 대표지점 · 최저~최고';}
 else if(!weekly||date){lines=items.map(item=>`${item.region} ${describe(item.days.find(d=>d.date===(date||data.start)))}`);scope=(date||data.start)+' · 지역별 최저~최고';}
 else {scope='17지역 전체 기온범위·최대강수확률';lines=data.dates.map(day=>{const days=items.map(item=>item.days.find(d=>d.date===day)).filter(d=>d?.available);if(!days.length)return day.slice(5)+' 예보 미제공';const chances=days.map(d=>d.rainChance).filter(Number.isFinite);return `${day.slice(5)} ${temperature(Math.min(...days.map(d=>d.min)))}~${temperature(Math.max(...days.map(d=>d.max)))}℃ ${rain(chances.length?Math.max(...chances):null)}${days.length<items.length?' ('+days.length+'/17지역)':''}`;});}
 const title=`${data.label} ${data.start}~${data.end}`,command=`!${region?'날씨 '+region:'전국날씨'} ${data.label}${date&&weekly?' '+date:''}`;
 const prefix=title+'\n'+scope+'\n',suffix='\nOpen-Meteo · KST'+(data.dates.some(d=>d<data.today)?' · 과거=모델자료':'')+'\n';
 const budget=200-prefix.length-suffix.length-command.length-12,pages=[];let batch=[];
 for(const line of lines){if(batch.length&&[...batch,line].join('\n').length>budget){pages.push(batch);batch=[];}batch.push(line);}if(batch.length)pages.push(batch);
 if(page>pages.length)return `날씨는 1~${pages.length}페이지입니다. ${command} 1`;
 return prefix+`${page}/${pages.length}\n`+pages[page-1].join('\n')+suffix+command+' '+(page<pages.length?page+1:1);
}
