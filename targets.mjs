import {createHmac} from 'node:crypto';
const fail=message=>{throw Error(message);};
export function emailAlias(email,key,room){
 const value=String(email||'').trim().toLocaleLowerCase('en-US');
 if(!key||value.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/u.test(value))fail('이메일 형식 또는 비공개 연결 설정을 확인하세요.');
 return createHmac('sha256',key).update(room+'\0'+value).digest('hex');
}
export const nicknameKey=value=>String(value||'').normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff\ufe0e\ufe0f]/gu,'').trim().replace(/\s+/gu,' ').toLocaleLowerCase('ko-KR');
// 이모지·기호·공백을 뺀 글자·숫자만 남긴 키입니다. '코나 N9'로 '🔒코나N9ღ ★'를 찾는 것처럼 꾸밈이 달라도 닉네임 일부로 찾기 위해 씁니다.
export const coreKey=value=>nicknameKey(value).replace(/[^\p{L}\p{N}]/gu,'');
const unquote=value=>/^(["']).*\1$/su.test(value)?value.slice(1,-1):value;
export function parseTicketGrant(arg){
 const usage='사용법: !복권지급 닉네임 수량 (@·고유 ID 없이 닉네임 일부만 써도 돼요 · 수량 생략 시 1장)';
 const input=String(arg||'').trim();if(!input)fail(usage);
 const quoted=/^(["'])(.*?)\1(?:\s+([+-]?\d+))?$/su.exec(input);
 if(quoted){if(!quoted[2].trim())fail(usage);return {target:quoted[2],countText:quoted[3]||'1'};}
 const bits=input.split(/\s+/u);if(bits.length===1)return {target:input,countText:'1'};
 const countText=bits.pop();if(!/^[+-]?\d+$/.test(countText))fail(bits.length>1?usage:'복권 수량은 정수로 입력해주세요.');
 return {target:bits.join(' '),countText};
}
// DJ가 연결하려는 스푼 프로필의 @아이디를 검사해 저장용 글자(앞의 @ 제거)로 돌려줍니다.
// 웹 관리 화면의 '계정 ID 연결'과 채팅의 !계정연결 명령이 같은 규칙을 쓰도록 한곳에 모았습니다.
// 글자·숫자·_ . - 만 1~100자까지 허용하고, 다른 청취자의 고유 ID·닉네임·연결한 아이디와 겹치면 거부합니다.
export function cleanAccountAlias(users,user,raw){
 const alias=String(raw||'').trim().replace(/^@/u,'');
 const taken=Object.values(users).some(other=>other.id!==user.id&&(other.id===alias||nicknameKey(other.name)===nicknameKey(alias)||other.accountAlias&&nicknameKey(other.accountAlias)===nicknameKey(alias)));
 if(!/^[\p{L}\p{N}_.-]{1,100}$/u.test(alias)||taken)fail('계정 ID가 중복되었거나 형식이 올바르지 않습니다.');
 return alias;
}
export function resolveTarget(users,target,{identityKey='',room=''}={}){
 const value=unquote(String(target||'').trim()).replace(/^@/u,'');
 if(Object.hasOwn(users,value))return value;
 if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)){
  const hash=emailAlias(value,identityKey,room),hits=Object.values(users).filter(user=>user.emailAlias===hash);
  if(hits.length===1)return hits[0].id;fail('연결된 이메일이 없습니다. DJ 관리 화면에서 청취자와 이메일을 먼저 비공개 연결하세요.');
 }
 const aliases=Object.values(users).filter(user=>user.accountAlias&&nicknameKey(user.accountAlias)===nicknameKey(value));if(aliases.length===1)return aliases[0].id;if(aliases.length>1)fail('연결한 계정 ID가 중복됩니다. DJ 관리 화면에서 연결을 확인하세요.');
 const query=nicknameKey(value);let exact=Object.values(users).filter(user=>query&&nicknameKey(user.name)===query);
 let hits=exact.length?exact:Object.values(users).filter(user=>query&&nicknameKey(user.name).includes(query));
 // 못 찾으면 이모지·기호·공백을 뺀 글자만으로 다시 비교합니다. (2글자 이상)
 if(!hits.length){const core=coreKey(value);if(core.length>=2){exact=Object.values(users).filter(user=>coreKey(user.name)===core);hits=exact.length?exact:Object.values(users).filter(user=>coreKey(user.name).includes(core));}}
 if(hits.length===1)return hits[0].id;
 const describe=user=>`${[...user.name].slice(0,14).join('')} → @${user.id}`;
 if(hits.length>1)fail(exact.length>1?`닉네임이 중복됩니다. 같은 닉네임은 대상을 고유 ID로 지정해주세요. ${hits.slice(0,2).map(describe).join(' / ')}`:`여러 명과 일치합니다. @닉네임을 더 길게 입력하세요. 후보: ${hits.slice(0,3).map(user=>'@'+[...user.name].slice(0,24).join('')).join(' / ')}`);
 // @로 시작한 입력이면, 스푼 프로필의 @아이디는 먼저 연결해야 한다는 안내를 덧붙입니다.
 const linkHint=String(target||'').trim().startsWith('@')?' 스푼 프로필의 @아이디는 먼저 !계정연결 닉네임 @아이디로 한 번 연결해야 합니다.':'';
 fail('일치하는 청취자가 없습니다. 닉네임 일부만 입력해도 돼요(@·고유 ID 불필요). 청취자가 채팅이나 후원을 한 번 하면 찾을 수 있어요.'+linkHint);
}
