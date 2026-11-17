const fail=message=>{throw Error(message);};
export const nicknameKey=value=>String(value||'').normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff\ufe0e\ufe0f]/gu,'').trim().replace(/\s+/gu,' ').toLocaleLowerCase('ko-KR');
const unquote=value=>/^(["']).*\1$/su.test(value)?value.slice(1,-1):value;
export function parseTicketGrant(arg){
 const usage='사용법: !복권지급 닉네임 수량 또는 !복권지급 @고유ID 수량 (생략 시 1장)';
 const input=String(arg||'').trim();if(!input)fail(usage);
 const quoted=/^(["'])(.*?)\1(?:\s+([+-]?\d+))?$/su.exec(input);
 if(quoted){if(!quoted[2].trim())fail(usage);return {target:quoted[2],countText:quoted[3]||'1'};}
 const bits=input.split(/\s+/u);if(bits.length===1)return {target:input,countText:'1'};
 const countText=bits.pop();if(!/^[+-]?\d+$/.test(countText))fail(bits.length>1?usage:'복권 수량은 정수로 입력해주세요.');
 return {target:bits.join(' '),countText};
}
export function resolveTarget(users,target){
 const value=unquote(String(target||'').trim()).replace(/^@/u,'');
 if(Object.hasOwn(users,value))return value;
 const query=nicknameKey(value),hits=Object.values(users).filter(user=>nicknameKey(user.name)===query);
 if(hits.length===1)return hits[0].id;
 const describe=user=>`${[...user.name].slice(0,14).join('')} → @${user.id}`;
 if(hits.length>1)fail(`닉네임이 중복됩니다. 대상을 고유 ID로 지정해주세요. ${hits.slice(0,3).map(describe).join(' / ')}`);
 const candidates=Object.values(users).filter(user=>query&&nicknameKey(user.name).includes(query)).slice(0,2);
 fail(`대상을 고유 ID 또는 등록된 닉네임으로 지정해주세요. 일치하는 청취자가 없습니다.${candidates.length?' 후보: '+candidates.map(describe).join(' / '):' 청취자가 !내정보를 입력한 뒤 닉네임을 그대로 사용하세요.'}`);
}
