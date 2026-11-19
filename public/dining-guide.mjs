// Search destinations, not a database of reviewed or verified restaurants.
export const diningRegions = [
 ['서울','강남|홍대|성수|종로|을지로|이태원|망원|잠실'],
 ['부산','해운대|광안리|서면|남포동|기장|송정|동래|영도'],
 ['대구','동성로|수성못|앞산|서문시장|칠성시장|김광석거리|반월당|동대구역'],
 ['인천','송도|차이나타운|부평|구월동|영종도|강화도|청라|동인천'],
 ['광주','동명동|상무지구|충장로|양림동|첨단|수완지구|송정역|봉선동'],
 ['대전','은행동|성심당 주변|유성|둔산동|봉명동|대흥동|관평동|도룡동'],
 ['울산','삼산동|성남동|태화강|장생포|일산해수욕장|정자해변|언양|간절곶'],
 ['세종','나성동|보람동|어진동|조치원|고운동|아름동|도담동|금남면'],
 ['경기','수원|성남|용인|고양|파주|양평|가평|안양'],
 ['강원','춘천|강릉|속초|원주|동해|삼척|평창|양양'],
 ['충북','청주|충주|제천|단양|보은|옥천|진천|괴산'],
 ['충남','천안|아산|공주|부여|서산|태안|홍성|보령'],
 ['전북','전주|군산|익산|남원|정읍|고창|부안|완주'],
 ['전남','목포|여수|순천|담양|광양|나주|해남|완도'],
 ['경북','포항|경주|안동|구미|문경|영주|울진|영덕'],
 ['경남','창원|김해|진주|통영|거제|밀양|양산|남해'],
 ['제주','제주시|서귀포|애월|한림|성산|표선|중문|구좌'],
].map(([name,areas])=>({name,areas:areas.split('|')}));
export const foodTypes=['한식','국밥','백반','고기','해산물','중식','일식','양식','분식','면요리','돈까스','초밥','치킨','피자','샤브샤브','전골','채식','브런치','베이커리','디저트'];
export const cafeTypes=['커피','디저트','베이커리','브런치','전통찻집'];
export const diningAreaCount=diningRegions.reduce((n,x)=>n+x.areas.length,0);
export const foodTourSource='https://www.korea.kr/news/policyNewsView.do?newsId=148931301';
// Region-food examples explicitly named in the Ministry of Culture's 2024-07-10 release.
export const foodTourIdeas=[{region:'부산',food:'돼지국밥'},{region:'경기 수원',food:'왕갈비'},{region:'경남 통영',food:'굴'},{region:'충남 홍성',food:'새조개'}];
export function diningGuideReply(page=1){
 const pages=Math.ceil(diningRegions.length/4);
 if(!Number.isInteger(page)||page<1||page>pages)return `전국 맛집 안내는 1~${pages}쪽이에요. 예: !맛집 전국 2`;
 const rows=diningRegions.slice((page-1)*4,page*4).map(x=>`${x.name}: ${x.areas.slice(0,3).join('·')}`).join('\n');
 return `전국 맛집 탐색 ${page}/${pages}\n${rows}\n!맛집 지역 음식 (예: !맛집 부산 국밥)\n다음: !맛집 전국 ${page%pages+1} · 앱에서 ${diningAreaCount}지역 탐색`;
}
