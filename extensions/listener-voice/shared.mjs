export function listenerRoom(url){
 try{const u=new URL(url);return u.protocol==='https:'&&['www.spooncast.net','spooncast.net'].includes(u.hostname)&&!u.port&&/^\/kr\/live\/[^/]+\/?$/.test(u.pathname)&&!u.username&&!u.password;}catch{return false;}
}
export function appendTranscript(current,spoken,max=200){
 const text=String(spoken||'').trim();if(!text)throw Error('인식된 문장이 없습니다. 다시 말씀해 주세요.');
 const value=current?`${current}${/\s$/.test(current)?'':' '}${text}`:text;
 if(value.length>max)throw Error(`입력 가능한 ${max}자를 초과했습니다. 채팅창의 글을 줄인 뒤 다시 입력해 주세요.`);
 return value;
}
export const speechError=code=>({'not-allowed':'마이크 사용이 허용되지 않았습니다. 브라우저의 마이크 권한을 확인해 주세요.','service-not-allowed':'이 브라우저에서는 음성 인식 서비스를 사용할 수 없습니다. 지원 브라우저에서 다시 시도하세요.','audio-capture':'마이크를 찾지 못했습니다. 장치 연결을 확인해 주세요.','no-speech':'목소리를 듣지 못했습니다. 말하기를 다시 눌러 주세요.','network':'음성 인식 서비스에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.','language-not-supported':'한국어 음성 인식이 지원되지 않는 환경입니다.'})[code]||'음성 인식을 마쳤습니다. 인식 결과를 확인해 주세요.';
