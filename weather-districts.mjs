import catalog from './weather-districts.json' with {type:'json'};
export const districtCatalog=catalog;
const shortNames={'서울특별시':'서울','부산광역시':'부산','대구광역시':'대구','인천광역시':'인천','대전광역시':'대전','울산광역시':'울산','세종특별자치시':'세종','경기도':'경기','강원특별자치도':'강원','충청북도':'충북','충청남도':'충남','전북특별자치도':'전북','전남광주통합특별시':'전남광주','경상북도':'경북','경상남도':'경남','제주특별자치도':'제주'};
export const districtLabel=loc=>loc.id.replace(loc.province,shortNames[loc.province]||loc.province).replace(/시(?=\S)/gu,'시 ');
const key=value=>{let text=String(value||'').normalize('NFKC').replace(/광주광역시/g,'전남광주').replace(/전라남도/g,'전남광주');for(const [long,short] of Object.entries(shortNames))text=text.replaceAll(long,short);return text.replace(/강원도/g,'강원').replace(/전라북도/g,'전북').replace(/\s/gu,'').replace(/시(?=.)/gu,'');};
const gwangjuDistricts=new Set(['동구','서구','남구','북구','광산구']);
export function selectDistricts(region=''){
 const raw=String(region||'').trim(),query=key(raw);if(!query||/^(전국|전체|대한민국)$/u.test(query))return catalog.locations;
 const aliases=raw.replace(/^광주(?=\s|[동서남북광])/u,'전남광주').replace(/^전남(?=\s)/u,'전남광주'),target=key(aliases);
 let rows=catalog.locations.filter(loc=>key(loc.id)===target||key(districtLabel(loc))===target);
 if(!rows.length)rows=catalog.locations.filter(loc=>key(loc.province)===target||key(loc.id).startsWith(target)||key(loc.name)===target);
 if(raw==='광주')rows=catalog.locations.filter(loc=>loc.province==='전남광주통합특별시'&&gwangjuDistricts.has(loc.name));
 if(raw==='전남')rows=catalog.locations.filter(loc=>loc.province==='전남광주통합특별시'&&!gwangjuDistricts.has(loc.name));
 // '통영'·'울릉'·'경기 수원시'처럼 끝의 시·군·구를 빼거나 덧붙여 쓴 입력, '분당구'처럼 구 이름만 쓴 입력도 찾습니다.
 // 위에서 이미 찾은 경우에는 건드리지 않아서 기존 결과가 달라지지 않습니다.
 if(!rows.length&&target.length>=2){
  const bare=target.replace(/[시군구]$/u,'');
  if(bare.length>=2){
   rows=catalog.locations.filter(loc=>key(loc.name).replace(/[시군구]$/u,'')===bare);
   if(!rows.length)rows=catalog.locations.filter(loc=>key(loc.id).startsWith(bare));
  }
  if(!rows.length&&target.length>=3)rows=catalog.locations.filter(loc=>key(loc.name).endsWith(target));
 }
 return rows;
}
export function districtPage(region='',page=1,pageSize=12){
 if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>24)throw Error('지역 페이지·조회 개수를 확인해주세요.');
 const all=selectDistricts(region);if(!all.length)throw Error('지역을 찾지 못했어요. 시·도와 시·군·구를 함께 입력해주세요. 예: 서울 강남구');
 const pages=Math.ceil(all.length/pageSize);if(page>pages)throw Error(`지역 목록은 1~${pages}페이지입니다.`);
 return {locations:all.slice((page-1)*pageSize,page*pageSize),total:all.length,page,pages,pageSize};
}
export function installDistricts(db){
 const insert=db.prepare('INSERT OR IGNORE INTO weather_location(id,zone,kma_name,nx,ny,lat,lon,sort,national) VALUES(?,?,?,?,?,?,?,?,0)');
 for(const [index,loc] of catalog.locations.entries())insert.run(loc.id,loc.zone,loc.kmaName,loc.nx,loc.ny,loc.lat,loc.lon,1000+index);
}
