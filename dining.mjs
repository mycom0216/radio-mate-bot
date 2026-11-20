import {foodTypes,cafeTypes,diningGuideReply} from './public/dining-guide.mjs';

export const normalizeCommand=value=>String(value??'').normalize('NFKC').trim();
const aliases={맛집:'맛집',맛집추천:'맛집',추천맛집:'맛집',카페:'카페',카페추천:'카페',추천카페:'카페'};
export function diningRequest(message){
 const match=/^!\s*(맛집추천|추천맛집|카페추천|추천카페|맛집|카페)(?:\s+(.*))?$/u.exec(normalizeCommand(message));
 return match?{kind:aliases[match[1]],arg:(match[2]||'').replace(/^추천(?:\s|$)/u,'').trim()}:null;
}
export function diningQuery(arg,kind){
 const words=String(arg||'').trim().split(/\s+/u).filter(Boolean),types=kind==='카페'?cafeTypes:foodTypes;
 const meal=words.find(word=>['아침','점심','저녁'].includes(word))||'';
 const foodType=words.find(word=>types.includes(word))||'';
 return {meal,foodType,region:words.filter(word=>!['아침','점심','저녁','추천','추천해줘','알려줘',foodType].includes(word)).join(' ')};
}
export const diningPrompt=kind=>`${kind}를 찾을 지역을 입력해주세요. 예: 광주 동명동\n음식·종류도 함께 입력할 수 있어요. 예: ${kind==='카페'?'광주 동명동 디저트':'부산 국밥'}\n2분 안에 답해주세요. !취소로 취소\n전국 ${kind} 탐색: !${kind} 전국`;
export function diningGuide(arg,kind){
 if(/^(도움말|사용법)$/u.test(arg))return `!${kind} 지역 [종류]${kind==='맛집'?' [아침/점심/저녁]':''}\n예: !${kind} ${kind==='맛집'?'부산 국밥':'광주 동명동 디저트'}\n지역 없이 입력하면 지역을 물어봐요. !${kind} 전국으로 지역 목록 확인 · !취소`;
 const nationwide=/^(?:전국|목록)(?:\s+(\d+))?$/u.exec(arg);
 return nationwide?diningGuideReply(Number(nationwide[1]||1)).replaceAll('맛집',kind):null;
}
