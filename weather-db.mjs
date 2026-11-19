// 날씨 지역 마스터 · 상류 응답 스냅샷 · 일별 기록. 방송 데이터와 같은 SQLite(studio.sqlite)에 저장합니다.
// 외부 요청은 SQLite 트랜잭션 밖에서 실행하고, 이 파일은 DB 읽기·쓰기만 담당합니다.
const SCHEMA=`
CREATE TABLE IF NOT EXISTS weather_location(
 id TEXT PRIMARY KEY,
 zone TEXT NOT NULL,
 kma_name TEXT NOT NULL,
 nx INTEGER,ny INTEGER,lat REAL,lon REAL,
 mid_land TEXT,mid_temp TEXT,
 sort INTEGER NOT NULL DEFAULT 100,
 national INTEGER NOT NULL DEFAULT 0 CHECK(national IN(0,1)),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 managed INTEGER NOT NULL DEFAULT 1 CHECK(managed IN(0,1))
);
CREATE TABLE IF NOT EXISTS weather_alias(alias TEXT PRIMARY KEY,location TEXT NOT NULL REFERENCES weather_location(id));
CREATE TABLE IF NOT EXISTS weather_snapshot(product TEXT NOT NULL,key TEXT NOT NULL,issued TEXT NOT NULL,fetched INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(product,key));
CREATE TABLE IF NOT EXISTS weather_daily(location TEXT NOT NULL REFERENCES weather_location(id),date TEXT NOT NULL,min REAL,max REAL,rain INTEGER,condition TEXT,hours INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(location,date));
CREATE INDEX IF NOT EXISTS weather_daily_date ON weather_daily(date);`;
// [표시 이름, 기상청 행정구역 코드(10자리), 기상청 응답의 지역 표기, 격자 X, 격자 Y, 위도, 경도, 중기육상 구역, 중기기온 지점]
// zone·표기는 www.weather.go.kr 1시간 단위 동네예보 RSS에서 직접 확인한 값입니다. 광주·전남은 2026-07 통합으로 코드가 12로 바뀌었습니다.
// 기상청은 알 수 없는 코드를 오류 대신 "서울특별시 동작구 신대방제2동"으로 응답하므로 표기(kma_name)까지 대조해 검증합니다.
const NATIONAL=[
 ['서울','1114000000','서울특별시 중구',60,127,37.5665,126.978,'11B00000','11B10101'],
 ['부산','2647000000','부산광역시 연제구',98,76,35.1796,129.0756,'11H20000','11H20201'],
 ['대구','2711000000','대구광역시 중구',89,90,35.8714,128.6014,'11H10000','11H10701'],
 ['인천','2820000000','인천광역시 남동구',55,124,37.4563,126.7052,'11B00000','11B20201'],
 ['광주','1224000000','전남광주통합특별시 서구',59,74,35.1595,126.8526,'11F20000','11F20501'],
 ['대전','3017000000','대전광역시 서구',67,99,36.3504,127.3845,'11C20000','11C20401'],
 ['울산','3114000000','울산광역시 남구',102,84,35.5384,129.3114,'11H20000','11H20101'],
 ['세종','3600000000','세종특별자치시',65,104,36.48,127.289,'11C20000','11C20404'],
 ['경기','4111500000','경기도 수원시팔달구',60,120,37.2636,127.0286,'11B00000','11B20601'],
 ['강원','5111000000','강원특별자치도 춘천시',72,133,37.8813,127.73,'11D10000','11D10301'],
 ['충북','4311100000','충청북도 청주시상당구',70,105,36.6424,127.489,'11C10000','11C10301'],
 ['충남','4480000000','충청남도 홍성군',53,106,36.6588,126.6728,'11C20000','11C20104'],
 ['전북','5211100000','전북특별자치도 전주시완산구',63,89,35.8242,127.148,'11F10000','11F10201'],
 ['전남','1281000000','전남광주통합특별시 무안군',50,71,34.8161,126.4629,'11F20000','21F20801'],
 ['경북','4717000000','경상북도 안동시',91,105,36.5684,128.7294,'11H10000','11H10501'],
 ['경남','4812300000','경상남도 창원시 성산구',91,76,35.2285,128.6811,'11H20000','11H20301'],
 ['제주','5011000000','제주특별자치도 제주시',53,38,33.4996,126.5312,'11G00000','11G00201']
];
// 전국 목록(17개)에는 넣지 않고 이름으로만 조회하는 추가 지역입니다. 중기예보 지점 코드는 2026-11-19에 실제 응답으로 확인했습니다.
const EXTRA=[
 ['서귀포','5013000000','제주특별자치도 서귀포시',56,33,33.2541,126.5601,'11G00000','11G00401'],
 ['목포','1211000000','전남광주통합특별시 목포시',50,66,34.8118,126.3922,'11F20000','21F20801'],
 ['여수','1213000000','전남광주통합특별시 여수시',74,66,34.7604,127.6622,'11F20000','11F20401'],
 ['순천','1215000000','전남광주통합특별시 순천시',67,69,34.9507,127.4872,'11F20000','11F20402'],
 // 주요 시·군(2026-11-19에 RSS 응답으로 코드·표기·격자를 확인). 시 아래에 구가 있으면 구 하나를 대표로 씁니다.
 // 중기예보는 원주·강릉·속초만 해당 지점 코드를 쓰고, 나머지는 도 대표 지점(시드 17곳과 같은 코드)을 빌려 씁니다.
 ['성남','4113500000','경기도 성남시분당구',62,122,37.42,127.1267,'11B00000','11B20601'],
 ['고양','4128500000','경기도 고양시일산동구',57,130,37.6584,126.832,'11B00000','11B20601'],
 ['용인','4146300000','경기도 용인시기흥구',63,120,37.2411,127.1776,'11B00000','11B20601'],
 ['부천','4119200000','경기도 부천시원미구',57,126,37.5034,126.766,'11B00000','11B20601'],
 ['안산','4127300000','경기도 안산시단원구',57,122,37.3219,126.8309,'11B00000','11B20601'],
 ['안양','4117300000','경기도 안양시동안구',60,123,37.3943,126.9568,'11B00000','11B20601'],
 ['남양주','4136000000','경기도 남양주시',64,128,37.636,127.2165,'11B00000','11B20601'],
 ['평택','4122000000','경기도 평택시',61,115,36.9921,127.1129,'11B00000','11B20601'],
 ['시흥','4139000000','경기도 시흥시',55,121,37.38,126.803,'11B00000','11B20601'],
 ['파주','4148000000','경기도 파주시',58,131,37.7599,126.78,'11B00000','11B20601'],
 ['김포','4157000000','경기도 김포시',56,127,37.6153,126.7156,'11B00000','11B20601'],
 ['원주','5113000000','강원특별자치도 원주시',77,122,37.3422,127.9202,'11D10000','11D10401'],
 ['강릉','5115000000','강원특별자치도 강릉시',93,131,37.7519,128.8761,'11D20000','11D20501'],
 ['속초','5121000000','강원특별자치도 속초시',87,141,38.207,128.5918,'11D20000','11D20401'],
 ['충주','4313000000','충청북도 충주시',77,114,36.991,127.9259,'11C10000','11C10301'],
 ['천안','4413100000','충청남도 천안시동남구',62,108,36.8151,127.1139,'11C20000','11C20104'],
 ['아산','4420000000','충청남도 아산시',58,109,36.7898,127.0019,'11C20000','11C20104'],
 ['군산','5213000000','전북특별자치도 군산시',56,92,35.9676,126.7369,'11F10000','11F10201'],
 ['익산','5214000000','전북특별자치도 익산시',62,92,35.9483,126.9577,'11F10000','11F10201'],
 ['포항','4711100000','경상북도 포항시남구',105,94,36.019,129.3435,'11H10000','11H10501'],
 ['구미','4719000000','경상북도 구미시',84,97,36.1195,128.3446,'11H10000','11H10501'],
 ['경주','4713000000','경상북도 경주시',105,90,35.8562,129.2247,'11H10000','11H10501'],
 ['김해','4825000000','경상남도 김해시',94,77,35.2285,128.8894,'11H20000','11H20301'],
 ['진주','4817000000','경상남도 진주시',81,75,35.18,128.1076,'11H20000','11H20301'],
 ['거제','4831000000','경상남도 거제시',89,68,34.8806,128.6211,'11H20000','11H20301'],
 ['양산','4833000000','경상남도 양산시',97,79,35.335,129.0378,'11H20000','11H20301']
];
const ALIASES={수원:'경기',춘천:'강원',청주:'충북',홍성:'충남',전주:'전북',무안:'전남',안동:'경북',창원:'경남',경기도:'경기',강원도:'강원',충청북도:'충북',충청남도:'충남',전라북도:'전북',전라남도:'전남',경상북도:'경북',경상남도:'경남',제주도:'제주',제주시:'제주',전남광주:'광주',전남광주통합특별시:'광주'};
const SUFFIX=/(특별자치시|특별자치도|특별시|광역시)$/;
const KEEP_DAYS=400;
const toLocation=row=>!row?null:{id:row.id,zone:row.zone,kmaName:row.kma_name,nx:row.nx,ny:row.ny,lat:row.lat,lon:row.lon,midLand:row.mid_land,midTemp:row.mid_temp,sort:row.sort,national:!!row.national,enabled:!!row.enabled,managed:!!row.managed};
export class WeatherDb{
 constructor(db){this.db=db;this.prunedAt=0;db.exec(SCHEMA);this.seed();}
 // managed=1 행은 시작할 때마다 코드의 기준값으로 갱신(행정구역 개편 대응), managed=0 행은 직접 수정한 값이라 건드리지 않습니다.
 seed(){
  const upsert=this.db.prepare(`INSERT INTO weather_location(id,zone,kma_name,nx,ny,lat,lon,mid_land,mid_temp,sort,national) VALUES(?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET zone=excluded.zone,kma_name=excluded.kma_name,nx=excluded.nx,ny=excluded.ny,lat=excluded.lat,lon=excluded.lon,mid_land=excluded.mid_land,mid_temp=excluded.mid_temp,sort=excluded.sort,national=excluded.national
   WHERE weather_location.managed=1`);
  [...NATIONAL.map(row=>[...row,1]),...EXTRA.map(row=>[...row,0])].forEach((row,index)=>upsert.run(row[0],row[1],row[2],row[3],row[4],row[5],row[6],row[7],row[8],index,row[9]));
  const alias=this.db.prepare('INSERT OR IGNORE INTO weather_alias(alias,location) VALUES(?,?)');
  for(const [name,id] of Object.entries(ALIASES))alias.run(name,id);
 }
 national(){return this.db.prepare('SELECT * FROM weather_location WHERE enabled=1 AND national=1 ORDER BY sort,id').all().map(toLocation);}
 names(){return this.db.prepare('SELECT id FROM weather_location WHERE enabled=1 ORDER BY national DESC,sort,id').all().map(row=>row.id);}
 get(id){return toLocation(this.db.prepare('SELECT * FROM weather_location WHERE id=? AND enabled=1').get(String(id)));}
 resolve(text){
  const raw=String(text??'').trim();if(!raw)return null;
  for(const key of new Set([raw,raw.replace(SUFFIX,''),raw.length>=3?raw.replace(/시$/,''):raw])){ // 성남시 → 성남, 서울시 → 서울
   const direct=this.get(key);if(direct)return direct;
   const alias=this.db.prepare('SELECT location FROM weather_alias WHERE alias=?').get(key),found=alias&&this.get(alias.location);if(found)return found;
  }
  return null;
 }
 snapshot(product,key){const row=this.db.prepare('SELECT issued,fetched,payload FROM weather_snapshot WHERE product=? AND key=?').get(product,key);return row?{issued:row.issued,fetched:row.fetched,payload:row.payload}:null;}
 saveSnapshot(product,key,issued,payload,now){this.db.prepare('INSERT INTO weather_snapshot(product,key,issued,fetched,payload) VALUES(?,?,?,?,?) ON CONFLICT(product,key) DO UPDATE SET issued=excluded.issued,fetched=excluded.fetched,payload=excluded.payload').run(product,key,issued,now,payload);}
 // 일별 기록: 기온은 확정값(exact)일 때만 덮어쓰고, 하루 중 늦게 받은 부분 예보(hours<18)는 더 온전한 기록을 망가뜨리지 못하게 합니다.
 saveDaily(id,days,now,source='기상청'){
  const stmt=this.db.prepare(`INSERT INTO weather_daily(location,date,min,max,rain,condition,hours,source,updated) VALUES(?,?,?,?,?,?,?,?,?)
   ON CONFLICT(location,date) DO UPDATE SET
    min=CASE WHEN ? THEN excluded.min ELSE weather_daily.min END,
    max=CASE WHEN ? THEN excluded.max ELSE weather_daily.max END,
    rain=CASE WHEN excluded.hours>=weather_daily.hours OR excluded.hours>=18 THEN excluded.rain ELSE weather_daily.rain END,
    condition=CASE WHEN excluded.hours>=weather_daily.hours OR excluded.hours>=18 THEN excluded.condition ELSE weather_daily.condition END,
    hours=MAX(excluded.hours,weather_daily.hours),source=excluded.source,updated=excluded.updated`);
  const own=!this.db.isTransaction;if(own)this.db.exec('BEGIN');
  try{for(const day of days.values())stmt.run(id,day.date,day.min,day.max,day.rain??null,day.condition,day.hours,source,now,day.exactMin?1:0,day.exactMax?1:0);if(own)this.db.exec('COMMIT');}
  catch(error){if(own)this.db.exec('ROLLBACK');throw error;}
  this.prune(now);
 }
 storedDays(id,dates){
  if(!dates.length)return [];
  return this.db.prepare(`SELECT date,min,max,rain,condition,hours,source FROM weather_daily WHERE location=? AND date IN (${dates.map(()=>'?').join(',')}) AND min IS NOT NULL AND max IS NOT NULL ORDER BY date`)
   .all(id,...dates).map(row=>({date:row.date,min:row.min,max:row.max,rain:row.rain,condition:row.condition||'확인 중',hours:row.hours,source:row.source}));
 }
 prune(now=Date.now()){
  if(now-this.prunedAt<86400000)return;this.prunedAt=now;
  this.db.prepare('DELETE FROM weather_daily WHERE date<?').run(new Date(now+9*3600000-KEEP_DAYS*86400000).toISOString().slice(0,10));
 }
}
