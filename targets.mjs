import {createHmac} from 'node:crypto';
const fail=message=>{throw Error(message);};
export function emailAlias(email,key,room){
 const value=String(email||'').trim().toLocaleLowerCase('en-US');
 if(!key||value.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/u.test(value))fail('이메일 형식 또는 비공개 연결 설정을 확인하세요.');
 return createHmac('sha256',key).update(room+'\0'+value).digest('hex');
}
export const nicknameKey=value=>String(value||'').normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff\ufe0e\ufe0f]/gu,'').trim().replace(/\s+/gu,' ').toLocaleLowerCase('ko-KR');
const unquote=value=>/^(["']).*\1$/su.test(value)?value.slice(1,-1):value;
export function parseTicketGrant(arg){
 const usage='사용법: !복권지급 @닉네임 수량 (닉네임 일부 가능 · 수량 생략 시 1장)';
 const input=String(arg||'').trim();if(!input)fail(usage);
 const quoted=/^(["'])(.*?)\1(?:\s+([+-]?\d+))?$/su.exec(input);
 if(quoted){if(!quoted[2].trim())fail(usage);return {target:quoted[2],countText:quoted[3]||'1'};}
 const bits=input.split(/\s+/u);if(bits.length===1)return {target:input,countText:'1'};
 const countText=bits.pop();if(!/^[+-]?\d+$/.test(countText))fail(bits.length>1?usage:'복권 수량은 정수로 입력해주세요.');
 return {target:bits.join(' '),countText};
}
export function resolveTarget(users,target,{identityKey='',room=''}={}){
 const value=unquote(String(target||'').trim()).replace(/^@/u,'');
 if(Object.hasOwn(users,value))return value;
 if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)){
  const hash=emailAlias(value,identityKey,room),hits=Object.values(users).filter(user=>user.emailAlias===hash);
  if(hits.length===1)return hits[0].id;fail('연결된 이메일이 없습니다. DJ 관리 화면에서 청취자와 이메일을 먼저 비공개 연결하세요.');
 }
 const aliases=Object.values(users).filter(user=>user.accountAlias&&nicknameKey(user.accountAlias)===nicknameKey(value));if(aliases.length===1)return aliases[0].id;if(aliases.length>1)fail('연결한 계정 ID가 중복됩니다. DJ 관리 화면에서 연결을 확인하세요.');
 const query=nicknameKey(value),exact=Object.values(users).filter(user=>query&&nicknameKey(user.name)===query);
 const hits=exact.length?exact:Object.values(users).filter(user=>query&&nicknameKey(user.name).includes(query));
 if(hits.length===1)return hits[0].id;
 const describe=user=>`${[...user.name].slice(0,14).join('')} → @${user.id}`;
 if(hits.length>1)fail(exact.length>1?`닉네임이 중복됩니다. 같은 닉네임은 대상을 고유 ID로 지정해주세요. ${hits.slice(0,2).map(describe).join(' / ')}`:`여러 명과 일치합니다. @닉네임을 더 길게 입력하세요. 후보: ${hits.slice(0,3).map(user=>'@'+[...user.name].slice(0,24).join('')).join(' / ')}`);
 fail('일치하는 청취자가 없습니다. 등록된 @닉네임 또는 일부를 입력하세요. 청취자가 !내정보를 입력하면 최신 닉네임이 등록됩니다.');
}
