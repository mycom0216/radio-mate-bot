import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source='https://www.weather.go.kr/w/rest/zone/dong.do';
async function list(params){const url=new URL(source);url.search=new URLSearchParams(params);const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('기상청 지역 목록 HTTP '+response.status);const data=await response.json();if(!Array.isArray(data)||!data.length)throw Error('기상청 지역 목록 형식 오류');return data;}
const provinces=await list({type:'WIDE'}),locations=[];
for(const province of provinces){
 let cities=await list({type:'CITY',wideCode:province.code});
 // 세종처럼 시·군·구 단계 없이 읍면동으로 바로 이어지는 지역은 광역 지점 하나를 씁니다.
 if(cities.every(row=>row.level==='3'))cities=[province];
 for(const city of cities){const name=city.code===province.code||city.name===province.name?province.name:province.name+' '+city.name;
  const row={id:name,province:province.name,name:city.name,zone:city.code,kmaName:name,nx:Number(city.x),ny:Number(city.y),lat:Number(city.lat),lon:Number(city.lon)};
  if(!/^\d{10}$/.test(row.zone)||![row.nx,row.ny,row.lat,row.lon].every(Number.isFinite)||row.lat<32||row.lat>40||row.lon<124||row.lon>132)throw Error('잘못된 기상청 좌표: '+name);
  locations.push(row);
 }
}
if(locations.length<200||new Set(locations.map(row=>row.zone)).size!==locations.length)throw Error('전체 지역 수·중복 코드 검증 실패');
locations.sort((a,b)=>a.zone.localeCompare(b.zone));
const output={source,sourcePage:'https://www.weather.go.kr/w/index.do',retrievedAt:new Date().toISOString(),provinceCount:provinces.length,locations};
writeFileSync(fileURLToPath(new URL('../weather-districts.json',import.meta.url)),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({provinces:provinces.length,districts:locations.length,first:locations[0].id,last:locations.at(-1).id}));
