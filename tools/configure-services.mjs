import {validateServices} from './service-validation.mjs';
// Local-only credential entry. No shell policy changes, no credentials in URLs/logs.
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const envFile=fileURLToPath(new URL('../deploy/temporary.env',import.meta.url));
const resultFile=fileURLToPath(new URL('../deploy/ai-setup-result.json',import.meta.url));
const token=randomBytes(32).toString('hex');let origin,busy=false;
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=(status='')=>`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>라디오메이트 API 연결 설정</title><style>body{font:16px/1.8 system-ui;background:#fff4fa;color:#634b61;margin:24px auto;padding:20px;max-width:650px}main{background:white;border:1px solid #efd6e6;border-radius:28px;padding:30px}label{display:block;margin:18px 0}input{display:block;box-sizing:border-box;width:100%;padding:12px;border:1px solid #dca9c5;border-radius:12px}button{padding:14px 22px;background:#a14d7e;color:white;border:0;border-radius:14px}p{font-size:14px}strong{color:#92436e}</style><main><h1>라디오메이트 연결 설정 ♡</h1><p>이 PC에서만 열리는 설정창입니다. 키를 채팅에 보내지 마세요. 빈 항목은 기존 설정을 유지합니다.</p><p><b>신규 등록: 네이버 클라우드 → NAVER API HUB → Application → 지역 검색의 Client ID / Secret을 사용합니다.</b> NAVER Cloud Platform의 Maps·지도 API 키와는 다릅니다.</p><p>OpenAI 연결 확인 시 짧은 테스트 호출 1회가 발생하며 API 요금은 별도입니다. 이 창은 입력한 키를 해당 API 제공자에게 인증용으로 전송합니다.</p><strong role="status">${esc(status)}</strong><form method="post" action="/save" autocomplete="off"><input type="hidden" name="csrf" value="${token}"><label>네이버 연결 방식<select name="naverProvider"><option value="hub">NAVER API HUB (신규 등록)</option><option value="legacy">기존 NAVER Developers 검색 키</option></select></label><label>네이버 검색 API Client ID<input type="password" name="naverId" maxlength="200"></label><label>네이버 검색 API Client Secret<input type="password" name="naverSecret" maxlength="200"></label><label>OpenAI API 키<input type="password" name="aiKey" maxlength="400"></label><button>연결 확인 · 이 PC 서버 설정에 저장</button></form><p>저장 후 서버에 적용하는 작업을 이어갑니다. 키는 GitHub에 올리지 않습니다.</p></main></html>`;
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");res.setHeader('Referrer-Policy','same-origin');
 try{
  if(req.headers.host!==new URL(origin).host)throw Error('설정창 주소를 확인해주세요.');
  if(req.method==='GET'&&req.url==='/'){res.end(html());return;}
  if(req.method!=='POST'||req.url!=='/save'||req.headers.origin!==origin)throw Error('허용되지 않은 요청입니다.');if(busy)throw Error('이미 확인 중입니다. 잠시 기다려주세요.');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16000)throw Error('입력 크기를 초과했습니다.');chunks.push(chunk);}const data=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const a=Buffer.from(data.get('csrf')||''),b=Buffer.from(token);if(a.length!==b.length||!timingSafeEqual(a,b))throw Error('설정창을 새로고침해주세요.');
  busy=true;const naverId=(data.get('naverId')||'').trim(),naverSecret=(data.get('naverSecret')||'').trim(),aiKey=(data.get('aiKey')||'').trim();
  const {values,errors,success}=await validateServices({naverId,naverSecret,aiKey,naverProvider:data.get('naverProvider')||'hub'});
  if(!success.length)throw Error(errors.join(' / '));
  const lines=readFileSync(envFile,'utf8').split(/\r?\n/).filter(line=>!Object.hasOwn(values,line.split('=')[0]));for(const [key,value]of Object.entries(values))lines.push(key+'='+value);
  writeFileSync(envFile+'.services.tmp',lines.join('\n'),{mode:0o600});renameSync(envFile+'.services.tmp',envFile);writeFileSync(resultFile,JSON.stringify({ok:true,naver:!!values.NAVER_CLIENT_ID,ai:!!values.OPENAI_API_KEY,time:Date.now()}));
  res.end(html(success.join(' · ')+' 연결 확인 · 로컬 저장 완료! '+(errors.length?'미저장 항목: '+errors.join(' / '):'서버 적용 후 새로고침해 사용하세요.')));console.log('서비스 키 저장 완료 (값은 출력하지 않음)');
 }catch(error){res.statusCode=400;res.end(html(error.message));}finally{busy=false;}
});
server.listen(Number(process.env.SERVICES_SETUP_PORT||0),'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;console.log(origin);});
setTimeout(()=>server.close(),3600000).unref();
