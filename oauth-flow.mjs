export function oauthCookieName(state){if(!/^[a-f0-9]{64}$/.test(state))return null;return 'oauth_'+state;}
export function oauthCookieMatches(header,state){
 const name=oauthCookieName(state);if(!name)return false;
 const cookies=String(header||'').split(';').map(value=>value.trim());
 return cookies.includes(name+'='+state);
}
export function oauthProviderError(error){
 if(error==='invalid_scope')return Object.assign(Error('스푼 개발자 앱의 승인된 권한과 서버 요청 권한이 일치하지 않습니다. 운영자가 앱 권한 설정을 확인해야 합니다.'),{oauthReason:'invalid-scope'});
 if(error==='access_denied')return Object.assign(Error('스푼 연결 동의가 허용되지 않았습니다. 방송하는 DJ 본인 계정으로 연결을 다시 시작해주세요.'),{oauthReason:'access-denied'});
 return Object.assign(Error('스푼에서 연결 요청을 완료하지 못했습니다. 연결을 처음부터 다시 시작해주세요.'),{oauthReason:'provider-error'});
}
const escape=text=>String(text).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function oauthFailurePage(message){return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>DJ 연결 확인 필요 · 라디오메이트</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/petal.css"><link rel="stylesheet" href="/invite.css"></head><body class="invite-page"><main class="invite-main"><section class="card"><h1>DJ 연결을 완료하지 못했습니다</h1><p role="alert">${escape(message)}</p><p>이 화면은 봇 연결 완료 화면이 아닙니다. 방송하는 DJ 본인 계정으로 같은 브라우저에서 로그인과 동의를 이어서 진행해주세요.</p><div class="actions"><a href="/oauth/start?return_to=invite">DJ 연결 다시 시작</a><a href="/invite">연결 안내로 돌아가기</a></div></section></main></body></html>`;}
