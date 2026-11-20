import {naverSearchRequest} from './naver-search-config.mjs';
import {selectDistricts,districtLabel} from './weather-districts.mjs';
import {parseWeatherQuery,weatherRange} from './weather-periods.mjs';
import {outfitFor} from './weather-extras.mjs';
import airports from './travel-airports.json' with {type:'json'};
const aliases={여행:'여행',여행정보:'여행',여행추천:'여행',관광:'관광',관광지:'관광',관광정보:'관광',관광지추천:'관광',숙박:'숙박',숙소:'숙박',숙박정보:'숙박',숙소추천:'숙박',교통:'교통',교통편:'교통',교통정보:'교통',기차:'기차',기차역:'기차',버스:'버스',버스터미널:'버스',항공:'항공',공항:'항공',지하철:'지하철',지하철역:'지하철',계절옷차림:'계절옷차림',여행옷차림:'계절옷차림'};
export const travelKinds=new Set(Object.values(aliases));
export function travelRequest(message){const text=String(message||'').normalize('NFKC').trim(),match=/^!\s*(\S+)(?:\s+(.*))?$/u.exec(text);return match&&aliases[match[1]]?{kind:aliases[match[1]],arg:match[2]||''}:null;}
export const travelPrompt=kind=>`${kind} 정보를 볼 지역을 입력해주세요. 예: 서울 강남구 / 부산 해운대구\n여행 시기는 이번주·다음주, 옷차림은 봄·여름·가을·겨울을 함께 입력하세요.\n2분 안에 답해주세요. !취소로 취소`;
export function travelQuery(arg,now=Date.now()){
 const selection=parseWeatherQuery(arg,now),season=/(?:^|\s)(봄|여름|가을|겨울)(?=\s|$)/u.exec(selection.region)?.[1]||'';
 return {...selection,region:selection.region.replace(/(?:^|\s)(봄|여름|가을|겨울)(?=\s|$)/gu,' ').trim(),season};
}
export const transportLinks=[{name:'기차 · 코레일',url:'https://www.korail.com/'},{name:'시외버스 · 버스타고',url:'https://www.bustago.or.kr/'},{name:'고속버스 · 코버스',url:'https://www.kobus.co.kr/'},{name:'항공 · 한국공항공사',url:'https://www.airport.co.kr/'},{name:'항공 · 인천국제공항',url:'https://www.airport.kr/'},{name:'지하철·버스 길찾기 · 네이버지도',url:'https://map.naver.com/p/'}];
const terms={관광:'관광명소',숙박:'숙박',기차:'기차역',버스:'버스터미널 버스정류장',항공:'공항',지하철:'지하철역'};
export function straightDistance(a,b){const rad=x=>x*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),term=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return Math.round(6371*2*Math.asin(Math.sqrt(Math.min(1,term)))*10)/10;}
export function nearestAirports(region){
 const locations=selectDistricts(region);if(locations.length!==1)return null;const center=locations[0];
 return {kind:'항공',query:region+' 인근 공항',configured:true,source:'공식 공항 목록·네이버 검증 좌표',searchUrl:'https://map.naver.com/p/search/'+encodeURIComponent(region+' 공항'),items:airports.items.map(item=>({...item,distanceKm:straightDistance(center,item)})).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,3),note:`시·군·구 대표 좌표에서 공항 대표 지점까지의 직선거리입니다. 도로거리·소요시간·취항노선·현재 운항 여부는 별도 확인하세요. 위치 확인일: ${airports.retrievedAt.slice(0,10)}`};
}
const seasonTips={봄:'얇은 니트·긴팔과 가벼운 재킷을 겹쳐 입고 아침저녁에는 바람막이를 준비하세요.',여름:'통풍이 잘 되는 얇은 옷·모자와 자외선 차단용품, 장마철에는 우산·방수 신발을 준비하세요.',가을:'긴팔·니트와 재킷을 겹쳐 입고 큰 일교차에 대비할 겉옷을 챙기세요.',겨울:'보온 내의·니트·두꺼운 외투와 장갑·목도리를 준비하고 눈·빙판에 맞는 신발을 신으세요.'};
export function travelCategoryMatches(item,kind){
 const category=String(item.category||'');
 if(/충전소|음식점|카페|광고|공중전화|여행사/u.test(category))return false;
 return ({기차:/(?:^|>|,)기차(?:역|,|>|$)|철도|KTX|SRT/iu,버스:/버스.*(?:터미널|정류)|터미널.*버스/u,항공:/(?:^|>)공항(?:$|,)|항공.*공항/u,지하철:/지하철|전철/u,숙박:/숙박|호텔|펜션|민박|게스트하우스|캠핑/u,관광:/여행,명소|문화|공원|박물관|미술관|유적|자연|전망|휴양|관광/u}[kind]||/$^/u).test(category);
}
export async function travelPlaces(service,region,kind){
 if(kind==='항공'){const nearby=nearestAirports(region);if(nearby)return nearby;}
 const query=region+' '+terms[kind],searchUrl='https://map.naver.com/p/search/'+encodeURIComponent(query);
 if(!service.configured)return {kind,query,searchUrl,configured:false,items:[],message:'네이버 지역검색 키가 없어 업체 목록을 조회하지 못했습니다. 지도 검색을 이용해주세요.'};
 return service.cached('travel:'+JSON.stringify([service.provider,query]),300000,async()=>{
  const {url,headers}=naverSearchRequest({provider:service.provider,clientId:service.clientId,clientSecret:service.clientSecret,query});
  const data=await service.json(url,headers);if(!Array.isArray(data.items))throw Error('여행 검색 응답 형식을 확인하지 못했어요.');
  const clean=value=>String(value||'').replace(/<[^>]*>/gu,'').replace(/&amp;/g,'&').replace(/[\r\n]/gu,' ').slice(0,300);
  const items=data.items.filter(item=>item&&typeof item.title==='string'&&travelCategoryMatches(item,kind)).slice(0,5).map(item=>({title:clean(item.title),category:clean(item.category),address:clean(item.roadAddress||item.address),telephone:clean(item.telephone),url:'https://map.naver.com/p/search/'+encodeURIComponent(clean(item.title)+' '+clean(item.address)),originalUrl:/^https?:\/\//iu.test(item.link||'')?item.link:''}));
  return {kind,query,searchUrl,configured:true,items,source:'네이버 지역 검색',note:'지역명 검색 관련도 순입니다. 거리·연결노선·운행시간·요금·영업시간·객실 재고는 확인된 정보가 아닙니다.'};
 });
}
export async function travelInfo(service,{region='',kind='여행',period='thisWeek',season=''}={}){
 region=String(region).trim();if(!region||region.length>60||/[\r\n]/u.test(region))throw Error('지역을 입력해주세요. 예: 서울 강남구');
 if(!travelKinds.has(kind)||!['current','tomorrow','thisWeek','nextWeek'].includes(period)||season&&!Object.hasOwn(seasonTips,season))throw Error('여행 종류·기간·계절을 확인해주세요.');
 const modes=kind==='여행'?['관광','숙박','기차','버스','항공','지하철']:kind==='교통'?['기차','버스','항공','지하철']:terms[kind]?[kind]:[];
 const settled=await Promise.allSettled(modes.map(mode=>travelPlaces(service,region,mode))),sections=settled.map((result,i)=>result.status==='fulfilled'?result.value:{kind:modes[i],items:[],message:'검색에 실패했습니다. 잠시 뒤 다시 시도해주세요.',searchUrl:'https://map.naver.com/p/search/'+encodeURIComponent(region+' '+terms[modes[i]])});
 const candidates=selectDistricts(region),location=candidates.length===1?candidates[0]:null;
 let weather=null,weatherMessage='시·도와 시·군·구를 함께 입력하면 해당 지역 날씨도 연결됩니다. 예: 서울 강남구';
 if(kind==='여행'||kind==='계절옷차림')try{
  if(location)weather=await service.districtForecast(period,{region:location.id,pageSize:1});
  else {const legacy=service.resolveRegion(region);if(legacy){const data=await service.forecast(period==='current'?'thisWeek':period,legacy),items=data.items.filter(item=>item.region===legacy);if(items.length)weather={...data,items};}}
  if(weather)weatherMessage='';
 }catch{weatherMessage='날씨 조회에 실패했습니다. 잠시 뒤 다시 조회해주세요.';}
 const days=weather?.items[0]?.days.filter(day=>day.available&&!day.past)||[],temperatures=days.flatMap(day=>[day.min,day.max]),low=temperatures.length?Math.min(...temperatures):null,high=temperatures.length?Math.max(...temperatures):null;
 const month=new Date(service.now()+9*3600000).getUTCMonth()+1,currentSeason=season||(month>=3&&month<=5?'봄':month>=6&&month<=8?'여름':month>=9&&month<=11?'가을':'겨울');
 const clothing={season:currentSeason,seasonTip:seasonTips[currentSeason],seasons:seasonTips,forecastTip:low===null?'해당 지역의 기온 자료가 없어 날씨에 맞춘 옷차림은 제공하지 않습니다.':`예보 ${low}~${high}℃ · 낮: ${outfitFor(high)} / 아침저녁: ${outfitFor(low)}${high-low>=10?' · 일교차가 커 겉옷을 챙기세요.':''}${days.some(day=>(day.rainChance||0)>=60||/비|눈/u.test(day.condition))?' · 비·눈 예보에 맞춰 우산·방수 신발을 준비하세요.':''}`};
 return {region,resolvedRegion:location?districtLabel(location):null,kind,period,updatedAt:service.now(),sections,partial:settled.some(result=>result.status==='rejected'),weather,weatherMessage,clothing,transportLinks,tourismLink:{name:'한국관광공사 대한민국 구석구석',url:'https://korean.visitkorea.or.kr/'},note:'관광지·숙소·교통시설은 실제 검색 결과입니다. 출발지·여행일에 맞춘 운행 시간표·요금·좌석과 객실 재고·체크인·입장료는 각 업체·공식 운영처에서 확인하세요. 근처 시설 검색이며 최단거리나 이용 가능한 환승 노선을 보장하지 않습니다.'};
}
export async function travelAnswer(service,request){
 const query=travelQuery(request.arg,service.now());if(!query.region)return travelPrompt(request.kind);
 if(query.region==='도움말')return '!여행 서울 강남구 다음주 · !관광 부산 해운대구 · !숙박 제주 서귀포시\n!교통 서울 강남구 · !기차 / !버스 / !항공 / !지하철 지역\n!계절옷차림 서울 강남구 겨울\n세부 정보·공식 링크는 앱의 여행 정보에서 확인';
 const result=await travelInfo(service,{region:query.region,kind:request.kind,period:query.period==='current'?'thisWeek':query.period,season:query.season});
 const rows=request.kind==='계절옷차림'?[result.clothing.season+' · '+result.clothing.seasonTip,result.clothing.forecastTip]:result.sections.map(section=>section.kind+': '+(section.items.length?section.items.slice(0,2).map(item=>item.title+(Number.isFinite(item.distanceKm)?`(직선 ${item.distanceKm}km)`:'' )).join(' · '):section.message||'검색 결과 없음'));
 if(request.kind==='여행')rows.push('날씨·옷차림: '+result.clothing.forecastTip,result.clothing.season+' 준비: '+result.clothing.seasonTip);
 const pages=[];let batch=[];for(const row of rows){if(batch.join('\n').length+row.length>100&&batch.length){pages.push(batch);batch=[];}batch.push(row.slice(0,110));}if(batch.length)pages.push(batch);
 const page=query.page;if(page>pages.length)return `여행 정보는 1~${pages.length}쪽입니다. !${request.kind} ${query.region} 1`;
 const prefix=`${query.region} ${request.kind} ${page}/${pages.length}\n`,suffix=`\n세부·주소·날씨·공식 조회: 앱 여행정보\n!${request.kind} ${query.region}${query.period!=='current'?' '+query.label:''}${query.season?' '+query.season:''} ${page<pages.length?page+1:1}`;
 return prefix+pages[page-1].join('\n').slice(0,Math.max(0,200-prefix.length-suffix.length))+suffix;
}
