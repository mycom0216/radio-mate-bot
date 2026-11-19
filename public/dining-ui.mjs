import {diningRegions,diningAreaCount,foodTypes,cafeTypes,foodTourIdeas,foodTourSource} from './dining-guide.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const foodOptions=(kind='맛집')=>'<option value="">종류 전체</option>'+(kind==='카페'?cafeTypes:foodTypes).map(x=>`<option>${esc(x)}</option>`).join('');
export function diningGuideHTML(){
 return `<details class="dining-guide" open><summary>전국 17개 시·도 · ${diningAreaCount}개 지역 바로 찾기</summary><p class="small">여행할 지역을 골라 검색칸에 넣어보세요. 지역 목록은 검색 출발점이며 업체 추천·평가 목록이 아닙니다.</p><label class="field">시·도<select id="dining-province">${diningRegions.map(x=>`<option>${esc(x.name)}</option>`).join('')}</select></label><div id="dining-areas" class="dining-chips" aria-label="세부 지역"></div><p class="small">음식 여행 아이디어 · <a href="${foodTourSource}" target="_blank" rel="noopener noreferrer">문체부·한국관광공사 발표 참고 ↗</a></p><div class="dining-chips">${foodTourIdeas.map(x=>`<button type="button" data-food-tour="${esc(x.region+' '+x.food)}">${esc(x.region+' '+x.food)}</button>`).join('')}</div><p id="dining-selection" class="small" role="status"></p></details>`;
}
export function bindDiningGuide(host){
 const form=host.querySelector('#places-form'),province=host.querySelector('#dining-province'),areas=host.querySelector('#dining-areas');
 const fill=value=>{form.elements.region.value=value;host.querySelector('#dining-selection').textContent=`${value} 선택 · 아래 추천 장소 찾기를 눌러주세요.`;};
 const paint=()=>{const entry=diningRegions.find(x=>x.name===province.value);areas.innerHTML=entry.areas.map(x=>`<button type="button" data-dining-region="${esc(entry.name+' '+x)}">${esc(x)}</button>`).join('');};
 province.addEventListener('change',()=>{paint();fill(province.value);});
 areas.addEventListener('click',e=>{const button=e.target.closest('[data-dining-region]');if(button)fill(button.dataset.diningRegion);});
 host.querySelectorAll('[data-food-tour]').forEach(button=>button.addEventListener('click',()=>{form.elements.placeKind.value='맛집';form.elements.foodType.innerHTML=foodOptions();fill(button.dataset.foodTour);}));
 form.elements.placeKind.addEventListener('change',()=>{form.elements.foodType.innerHTML=foodOptions(form.elements.placeKind.value);});
 paint();
}
