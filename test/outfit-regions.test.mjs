// !옷차림(그리고 !우산·!시간별·!일출·!날씨)이 서울뿐 아니라 전국 시·군·구에서 동작하는지 검사하는 테스트입니다.
// 기상청 응답은 가짜로 만들어 지역마다 다른 기온을 주고, 실제로 그 지역의 코드를 요청했는지도 확인합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {WeatherDb} from '../weather-db.mjs';
import {Lifestyle,assistantRequest} from '../lifestyle.mjs';
import {outfitFor} from '../weather-extras.mjs';
import {districtCatalog,selectDistricts,districtLabel} from '../weather-districts.mjs';

const NOW=Date.parse('2026-11-19T01:30:00Z'); // 2026-11-19(목) 10:30 KST
// 지역 이름에 따라 기온을 다르게 줍니다: 낮 시간(7~15시) 기온 = offset + 3
const OFFSETS=[['강남구',-2],['해운대구',17],['서귀포시',14],['통영시',9],['울릉군',6],['가평군',-6]];
const offsetOf=name=>OFFSETS.find(([word])=>name.includes(word))?.[1]??5;
function hourlyRows(offset){
 const rows=[];
 for(let day=0;day<4;day++)for(let hour=day===0?10:1;hour<=24;hour++)rows.push({day,hour,temp:offset+(hour<7?-3:hour<16?3:0),tmx:offset+3,tmn:offset-3,pop:day===1&&hour>=10&&hour<=15?60:0,pty:day===1&&hour>=10&&hour<=15?1:0,wf:day===1&&hour>=10&&hour<=15?'비':'맑음'});
 return rows;
}
const field=value=>value===null||value===undefined?'-999.0':Number(value).toFixed(1);
function xml(rows,name){
 return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>기상청 - ${name}</title><item><author>기상청</author><category>${name}</category><description><header><tm>202611190800</tm><ts>2</ts><x>60</x><y>127</y></header><body>${rows.map((r,i)=>`<data seq="${i}"><hour>${r.hour}</hour><day>${r.day}</day><temp>${field(r.temp)}</temp><tmx>${field(r.tmx)}</tmx><tmn>${field(r.tmn)}</tmn><sky>1</sky><pty>${r.pty}</pty><wfKor>${r.wf}</wfKor><wfEn>x</wfEn><pcp>0.0</pcp><sno>0.0</sno><pop>${r.pop}</pop><ws>4.0</ws><wd>7</wd><wdKor>북서</wdKor><wdEn>NW</wdEn><reh>50</reh></data>`).join('')}</body></description></item></channel></rss>`;
}
// 시·도 대표 지점(기존)과 전국 시·군·구(신규)를 모두 코드로 찾을 수 있게 합니다.
const probe=new WeatherDb(new DatabaseSync(':memory:'));
const ZONES=new Map([...probe.national(),...['서귀포','목포','여수','순천'].map(name=>probe.get(name)),...districtCatalog.locations].map(loc=>[loc.zone,loc]));
function world(){
 const calls=[];
 const fetcher=async input=>{
  const url=new URL(input);calls.push(url);
  if(url.hostname!=='www.weather.go.kr')throw Error('unexpected host '+url.hostname);
  const loc=ZONES.get(url.searchParams.get('zone'));
  if(!loc)return {ok:false,status:404};
  const name=loc.kmaName;
  return {ok:true,status:200,text:async()=>xml(hourlyRows(offsetOf(name)),name)};
 };
 return {fetcher,zones:()=>calls.map(url=>url.searchParams.get('zone'))};
}
const service=(w=world(),extra={})=>new Lifestyle({weatherSource:'kma',now:()=>NOW,fetcher:w.fetcher,...extra});
const ask=(svc,message)=>svc.answer(assistantRequest(message));
const zoneOf=label=>selectDistricts(label)[0].zone;

test('전국 시·군·구 이름이 한 곳으로 찾아집니다 (끝 글자 생략·구 이름만도 가능)', () => {
 const one=(query,label)=>{const rows=selectDistricts(query);assert.equal(rows.length,1,query);assert.equal(districtLabel(rows[0]),label,query);};
 one('서울 강남구','서울 강남구');one('강남구','서울 강남구');one('부산 해운대구','부산 해운대구');one('제주 서귀포시','제주 서귀포시');
 one('통영','경남 통영시');one('통영시','경남 통영시');one('울릉','경북 울릉군');one('양평','경기 양평군');one('경기 가평','경기 가평군');
 one('분당구','경기 성남시 분당구');one('성남 분당구','경기 성남시 분당구');one('서울 강남','서울 강남구');
 // 기존 동작은 그대로: 시·도는 소속 시·군·구 전체, 모르는 이름은 빈 목록
 assert.equal(selectDistricts('서울').length,25);assert.equal(selectDistricts('독도').length,0);assert.equal(selectDistricts('없는곳').length,0);
 // 이름이 여러 곳이면 모두 돌려줍니다.
 assert.ok(selectDistricts('중구').length>=5);assert.equal(selectDistricts('고성').length,2);assert.equal(selectDistricts('경기 수원시').length,4);
});

test('!옷차림이 시·군·구마다 그 지역의 기온으로 안내합니다', async () => {
 const w=world(),svc=service(w);
 // 낮 기온 = offset + 3: 강남구 1℃, 해운대구 20℃, 서귀포시 17℃, 통영시 12℃, 울릉군 9℃, 가평군 -3℃
 const cases=[['!옷차림 서울 강남구','서울 강남구',1],['!옷차림 부산 해운대구','부산 해운대구',20],['!옷차림 해운대구','부산 해운대구',20],['!옷차림 제주 서귀포시','제주 서귀포시',17],['!옷차림 통영','경남 통영시',12],['!옷차림 울릉','경북 울릉군',9],['!옷차림 경기 가평','경기 가평군',-3]];
 for(const [message,label,temp] of cases){
  const text=await ask(svc,message);
  assert.ok(text.startsWith(`${label} 옷차림 · `),`${message} → ${text}`);
  assert.ok(text.includes(outfitFor(temp)),`${message}: ${outfitFor(temp)} 가 없음 → ${text}`);
  assert.ok([...text].length<=200,`200자 초과: ${message}`);
 }
 // 실제로 그 지역의 기상청 코드를 요청했는지
 assert.ok(w.zones().includes(zoneOf('서울 강남구')));assert.ok(w.zones().includes(zoneOf('부산 해운대구')));assert.ok(w.zones().includes(zoneOf('경남 통영시')));
 // 지역마다 서로 다른 옷차림이 나옵니다.
 const cold=await ask(svc,'!옷차림 서울 강남구'),warm=await ask(svc,'!옷차림 부산 해운대구');
 assert.notEqual(cold.split('\n')[1],warm.split('\n')[1]);
});

test('이름이 여러 곳에 해당하면 후보를 보여 주고 시·도·구를 함께 입력하게 합니다', async () => {
 const svc=service();
 const jung=await ask(svc,'!옷차림 중구');
 assert.match(jung,/^중구 지역이 \d+곳이에요: 서울 중구 · .+ 외 \d+곳\n시·도·구를 함께 입력해주세요\. 예: !옷차림 서울 중구/);
 assert.match(await ask(svc,'!옷차림 고성'),/^고성 지역이 2곳이에요: .*강원 고성군.*경남 고성군|^고성 지역이 2곳이에요: .*경남 고성군.*강원 고성군/);
 const suwon=await ask(svc,'!옷차림 경기 수원시');
 assert.match(suwon,/^경기 수원시 지역이 4곳이에요: 경기 수원시 /);
 assert.ok([...jung].length<=200&&[...suwon].length<=200);
 // 후보를 안내할 때는 날씨 서버를 부르지 않습니다.
 const w=world(),quiet=service(w);await ask(quiet,'!옷차림 중구');assert.equal(w.zones().length,0);
});

test('찾을 수 없는 이름은 기존 안내를 그대로 보여 줍니다', async () => {
 const svc=service();
 for(const message of ['!옷차림 독도','!옷차림 없는곳','!우산 없는곳','!날씨 서울 없는곳'])assert.match(await ask(svc,message),/^지원 지역: 서울 .*\(시·도 대표 지점\)$/,message);
});

test('기존 시·도·주요 시 조회와 기본 지역은 그대로 동작합니다', async () => {
 const svc=service();
 assert.match(await ask(svc,'!옷차림 부산'),/^부산 옷차림 · /);
 assert.match(await ask(svc,'!옷차림 서울'),/^서울 옷차림 · /);
 assert.match(await ask(svc,'!옷차림 성남'),/^성남 옷차림 · /);
 assert.match(await ask(svc,'!옷차림'),/^서울 옷차림 · /);
});

test('우산·시간별·일출·현재 날씨도 시·군·구에서 동작합니다', async () => {
 const svc=service();
 const umbrella=await ask(svc,'!우산 부산 해운대구');
 assert.ok(umbrella.startsWith('부산 해운대구 우산'),umbrella);
 const hourly=await ask(svc,'!시간별 서울 강남구');
 assert.ok(hourly.startsWith('서울 강남구 시간별'),hourly);
 const sun=await ask(svc,'!일출 제주 서귀포시');
 assert.match(sun,/^제주 서귀포시 오늘 일출 \d\d:\d\d · 일몰 \d\d:\d\d/);
 const now=await ask(svc,'!날씨 서울 강남구');
 assert.match(now,/^서울 강남구 날씨 · 2026-11-19 10:00 KST\n서울 강남구 1\.?\d*℃/);
 assert.match(now,/출처 기상청 · 시·군·구 대표 좌표$/);
 for(const text of [umbrella,hourly,sun,now])assert.ok([...text].length<=200);
});

test('기상청 모드가 아니면 시·군·구 옷차림은 안내만 하고 일출은 계산식으로 됩니다', async () => {
 const plain=new Lifestyle({now:()=>NOW});
 assert.match(await ask(plain,'!옷차림 서울 강남구'),/^지원 지역: /);
 assert.match(await ask(plain,'!일출 제주 서귀포시'),/^제주 서귀포시 오늘 일출 /);
});

test('시·군·구 주간 날씨와 지도는 기존처럼 동작합니다', async () => {
 const svc=service();
 const week=await ask(svc,'!날씨 서울 강남구 다음주');
 assert.match(week,/강남구/);
});
