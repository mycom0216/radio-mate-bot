// Mermaid → PNG/SVG. 사용: node diagrams.mjs <OUT>
import {Browser,sleep} from './cdp.mjs';import {writeFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const OUT=resolve(process.argv[2]);
const page=code=>`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:'Malgun Gothic',sans-serif}#w{display:inline-block;padding:20px}</style><div id="w"><pre class="mermaid" id="m">${code.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre></div><script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'base',fontFamily:"'Malgun Gothic',sans-serif",themeVariables:{fontSize:'15px',primaryColor:'#FBE7F1',primaryBorderColor:'#C2417C',primaryTextColor:'#1F2937',lineColor:'#6B7280',secondaryColor:'#EAE4F8',tertiaryColor:'#FFF8FC'},flowchart:{htmlLabels:false,curve:'basis',nodeSpacing:30,rankSpacing:40,useMaxWidth:false},er:{useMaxWidth:false}});try{await mermaid.run({querySelector:'#m'});window.__d='ok'}catch(e){window.__d='err '+e.message}</script>`;
const b=await Browser.launch({port:9345,width:1400,height:900});
async function render(name,code,dir){const html=join(tmpdir(),'mm-'+name+'.html');writeFileSync(html,page(code));await b.viewport(1400,900,{scale:2});await b.go(pathToFileURL(html).href,300);let s;for(let i=0;i<100;i++){s=await b.eval('window.__d||""');if(s)break;await sleep(200);}
 if(s!=='ok'){console.log('FAIL',name,s);return;}const box=await b.eval(`(()=>{const r=document.querySelector('#w').getBoundingClientRect();return {w:Math.ceil(r.width),h:Math.ceil(r.height)}})()`);await b.viewport(Math.max(box.w,400),Math.max(box.h,300),{scale:2});await sleep(250);
 const {data}=await b.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:box.w,height:box.h,scale:1},captureBeyondViewport:true});mkdirSync(join(OUT,dir,'mmd'),{recursive:true});writeFileSync(join(OUT,dir,name+'.png'),Buffer.from(data,'base64'));
 const svg=await b.eval(`document.querySelector('#w svg').outerHTML`);writeFileSync(join(OUT,dir,name+'.svg'),'<?xml version="1.0" encoding="UTF-8"?>\n'+svg.replace(/<svg /,'<svg xmlns="http://www.w3.org/2000/svg" '));writeFileSync(join(OUT,dir,'mmd',name+'.mmd'),code);console.log('ok',name,box.w+'x'+box.h);}
const G={
'요구분석_그림|브레인스토밍_마인드맵':`mindmap
  root((라디오메이트<br/>요구 발산))
    방송 운영
      신청곡 대기열
      게임·보상
      청취자 관리
    소통
      음성메시지
      AI 대화
      앱 채팅방
    생활 정보
      기상청 날씨
      미세먼지·특보
      맛집·카페
    운영 안정
      자동 복구
      백업·진단
      외부 API 한도
    확장
      Android 앱
      자동 날씨 안내
      자동 운영 프로필`,
'요구분석_그림|시스템_구성도':`flowchart LR
 DJ([DJ 웹앱·Android 앱]) --> S[라디오메이트 서버 Node.js + SQLite]
 L([청취자 스푼 채팅]) --> SP[Spoon 방송 API]
 SP <--> S
 S --> YT[YouTube 검색]
 S --> OA[OpenAI]
 S --> NV[네이버 지역 검색]
 S --> KMA[기상청 RSS·단기·중기·특보]
 S --> AK[에어코리아]
 S --> OM[Open-Meteo]
 S --> T[Cloudflare 터널] --> G[고정 공용 주소 중계] --> DJ
 M[작업 스케줄러 관리자] -.감시·복구.-> S`,
'포트폴리오_그림|시스템_구조도':`flowchart TB
 subgraph 클라이언트
 W[DJ 웹앱 PWA]
 A[Android WebView 앱]
 V[청취자 음성·채팅 페이지]
 end
 subgraph 서버[서버 PC Windows]
 H[HTTP·SSE 서버] --> E[게임·신청곡·보상 엔진]
 H --> LF[날씨·AI·검색 서비스]
 E --> DB[(SQLite WAL 13테이블)]
 LF --> DB
 O[outbox 송신 대기열] --> DB
 end
 W --> H
 A --> H
 V --> H
 H <--> SP[Spoon API]
 LF --> EXT[기상청·에어코리아·OpenAI·네이버·YouTube]
 O --> SP
 MG[관리자 --daemon] -.감시.-> H`};
try{for(const [k,c] of Object.entries(G)){const [d,n]=k.split('|');await render(n,c,d);}}finally{await b.close();}
