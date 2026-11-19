// Mermaid → PNG/SVG. 사용: node diagrams.mjs <OUT>
import {Browser,sleep} from './cdp.mjs';import {writeFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const OUT=resolve(process.argv[2]);
const page=code=>`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:'Malgun Gothic',sans-serif}#w{display:inline-block;padding:20px}</style><div id="w"><pre class="mermaid" id="m">${code.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre></div><script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'base',fontFamily:"'Malgun Gothic',sans-serif",themeVariables:{fontSize:'15px',primaryColor:'#FBE7F1',primaryBorderColor:'#C2417C',primaryTextColor:'#1F2937',lineColor:'#6B7280',secondaryColor:'#EAE4F8',tertiaryColor:'#FFF8FC'},flowchart:{htmlLabels:false,curve:'basis',nodeSpacing:30,rankSpacing:40,useMaxWidth:false},er:{useMaxWidth:false}});try{await mermaid.run({querySelector:'#m'});window.__d='ok'}catch(e){window.__d='err '+e.message}</script>`;
const b=await Browser.launch({port:9344,width:1400,height:900});
async function render(name,code,dir){const html=join(tmpdir(),'mm-'+name+'.html');writeFileSync(html,page(code));await b.viewport(1400,900,{scale:2});await b.go(pathToFileURL(html).href,300);let s;for(let i=0;i<100;i++){s=await b.eval('window.__d||""');if(s)break;await sleep(200);}
 if(s!=='ok'){console.log('FAIL',name,s);return;}const box=await b.eval(`(()=>{const r=document.querySelector('#w').getBoundingClientRect();return {w:Math.ceil(r.width),h:Math.ceil(r.height)}})()`);await b.viewport(Math.max(box.w,400),Math.max(box.h,300),{scale:2});await sleep(250);
 const {data}=await b.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:box.w,height:box.h,scale:1},captureBeyondViewport:true});mkdirSync(join(OUT,dir,'mmd'),{recursive:true});writeFileSync(join(OUT,dir,name+'.png'),Buffer.from(data,'base64'));
 const svg=await b.eval(`document.querySelector('#w svg').outerHTML`);writeFileSync(join(OUT,dir,name+'.svg'),'<?xml version="1.0" encoding="UTF-8"?>\n'+svg.replace(/<svg /,'<svg xmlns="http://www.w3.org/2000/svg" '));writeFileSync(join(OUT,dir,'mmd',name+'.mmd'),code);console.log('ok',name,box.w+'x'+box.h);}
const E={
'ERD_물리구조_13테이블':`erDiagram
 rooms{TEXT id PK
 TEXT data "JSON 방송 상태"}
 events{TEXT room PK
 TEXT id PK
 TEXT result}
 audit{INTEGER seq PK
 TEXT room
 INTEGER time
 TEXT user
 TEXT type
 TEXT data}
 tokens{TEXT room PK
 TEXT data "암호문"}
 backups{TEXT id PK
 TEXT room
 INTEGER time
 TEXT data}
 outbox{TEXT id PK
 TEXT room UK
 TEXT event_key UK
 TEXT text
 INTEGER created
 INTEGER due
 INTEGER attempts
 TEXT status}
 studio_sessions{TEXT key PK
 TEXT room
 INTEGER expires
 TEXT data "암호문"}
 voice_links{TEXT room PK
 TEXT token UK
 INTEGER enabled}
 voice_cards{TEXT id PK
 TEXT room UK
 TEXT request_id UK
 TEXT nickname
 TEXT title
 TEXT mime
 INTEGER bytes
 INTEGER created
 INTEGER is_read}
 weather_location{TEXT id PK
 TEXT zone
 TEXT kma_name
 INTEGER nx
 INTEGER ny
 REAL lat
 REAL lon
 TEXT mid_land
 TEXT mid_temp
 INTEGER sort
 INTEGER national
 INTEGER enabled
 INTEGER managed}
 weather_alias{TEXT alias PK
 TEXT location FK}
 weather_daily{TEXT location PK,FK
 TEXT date PK
 REAL min
 REAL max
 INTEGER rain
 TEXT condition
 INTEGER hours
 TEXT source
 INTEGER updated}
 weather_snapshot{TEXT product PK
 TEXT key PK
 TEXT issued
 INTEGER fetched
 TEXT payload}
 rooms ||--o{ events : "room(앱 참조)"
 rooms ||--o{ audit : "room(앱 참조)"
 rooms ||--o| tokens : "room(앱 참조)"
 rooms ||--o{ backups : "room(앱 참조)"
 rooms ||--o{ outbox : "room(앱 참조)"
 rooms ||--o{ studio_sessions : "room(앱 참조)"
 rooms ||--o| voice_links : "room(앱 참조)"
 rooms ||--o{ voice_cards : "room(앱 참조)"
 weather_location ||--o{ weather_alias : "FK 별칭"
 weather_location ||--o{ weather_daily : "FK 일별 기록"`,
'ERD_날씨4테이블':`erDiagram
 weather_location{TEXT id PK
 TEXT zone "행정구역 코드"
 TEXT kma_name
 INTEGER nx
 INTEGER ny
 REAL lat
 REAL lon
 TEXT mid_land
 TEXT mid_temp
 INTEGER national
 INTEGER enabled
 INTEGER managed}
 weather_alias{TEXT alias PK
 TEXT location FK}
 weather_daily{TEXT location PK,FK
 TEXT date PK
 REAL min
 REAL max
 INTEGER rain
 TEXT condition
 INTEGER hours
 TEXT source
 INTEGER updated}
 weather_snapshot{TEXT product PK
 TEXT key PK
 TEXT issued
 INTEGER fetched
 TEXT payload "응답 원문"}
 weather_location ||--o{ weather_alias : "별칭"
 weather_location ||--o{ weather_daily : "일별 기록(400일)"`};
const F={
'10_날씨_명령_처리':`flowchart TD
 A([채팅 '!날씨 서울 내일' 등]) --> B{명령 종류}
 B -- 날씨·전국날씨 --> C[지역·기간 파싱]
 B -- 브리핑·시간별·우산·옷차림 --> C
 B -- 일출·일몰·어제 --> C
 B -- 미세먼지·특보 --> X[[12 미세먼지·특보 흐름]]
 C --> D{지역 인식}
 D -- 실패 --> E[지원 지역 안내 140자 + 외 N곳]
 D -- 성공 --> F[날씨 DB·기상청 자료 조회]
 F --> G{자료 있음}
 G -- 없음 --> H[대체 경로 11 흐름]
 H --> G
 G -- 있음 --> I[명령별 문구 작성 체감온도 습도 바람]
 I --> J{200자 초과}
 J -- 예 --> K[줄여서 200자 이내]
 J -- 아니오 --> L([채팅 전송])
 K --> L
 E --> L`,
'11_날씨_자료_수집과_대체_경로':`flowchart TD
 A([날씨 조회 요청]) --> B{캐시 30분 이내}
 B -- 예 --> Z([저장된 값 사용])
 B -- 아니오 --> C[기상청 동네예보 RSS]
 C --> D{성공}
 D -- 예 --> G[DB 스냅샷 저장]
 D -- 아니오 --> E{서비스키 있음}
 E -- 예 --> F[단기예보 API getVilageFcst]
 E -- 아니오 --> H{12시간 이내 스냅샷}
 F --> I{성공}
 I -- 예 --> G
 I -- 아니오 --> H
 H -- 예 --> J[스냅샷 사용]
 H -- 아니오 --> K[Open-Meteo 보충]
 G --> L[중기예보 +4~10일]
 L --> M[초단기실황 현재 기온]
 M --> N[오늘 최저·최고 02시·15시 발표분으로 보충]
 N --> O[일별 기록 weather_daily 저장]
 O --> Z
 J --> Z
 K --> Z
 D -- 아니오 --> P[실패 로그 첫 1회 · 6시간마다 · 회복 시]`,
'12_미세먼지와_기상특보_조회':`flowchart TD
 A([!미세먼지 / !특보]) --> B{명령}
 B -- 미세먼지 --> C{내일 여부}
 C -- 오늘 --> D[에어코리아 시도별 실시간 측정소]
 D --> E[측정소 값 평균 · 20분 캐시]
 E --> F[등급 판정 + 마스크 안내]
 C -- 내일 --> G[예보통보 권역 문구]
 B -- 특보 --> H[기상특보 getPwnStatus 전국 1건 · 5분 캐시]
 H --> I[시·도 이름으로 거르기]
 I --> J{발효 중 특보}
 J -- 있음 --> K[현재 발효 · 예비특보 안내]
 J -- 없음 --> L[발효 중인 특보 없음]
 D -- 키 없음·실패 --> M[승인 안 됨·조회 실패 안내]
 F --> N([200자 이내 전송])
 G --> N
 K --> N
 L --> N
 M --> N`,
'13_방송_자동_날씨_안내':`flowchart TD
 A([자동 채팅 · 방송 시작 안내 · 공지 시각]) --> B{문구에 {브리핑 서울} 등 자리표시자}
 B -- 없음 --> C([원문 그대로 전송])
 B -- 있음 --> D[자리표시자마다 실시간 조회]
 D --> E{조회 성공}
 E -- 성공 --> F[답으로 치환]
 E -- 실패 --> G[해당 자리는 비움]
 F --> H{남은 문구가 있음}
 G --> H
 H -- 전부 비어 있음 --> I([이번 안내 건너뜀])
 H -- 있음 --> J[outbox에 넣고 중복 방지 키 확인]
 J --> K([스푼 채팅 전송])`,
'14_상시_운영_자동_복구':`flowchart TD
 A([로그온 · 5분마다]) --> B[작업 스케줄러: conhost --headless 실행기]
 B --> C{관리자 pid 살아 있음}
 C -- 예 --> Z([바로 종료])
 C -- 아니오 --> D[관리자를 --daemon 으로 분리 실행 후 종료]
 D --> E[관리자 시작]
 E --> F{서버·터널 pid 파일}
 F -- 살아 있고 같은 프로그램 --> G[이어받기]
 F -- 없음·다른 프로그램 --> H[서버·터널 분리 실행]
 G --> I[15초마다 헬스체크]
 H --> I
 I --> J{정상}
 J -- 예 --> I
 J -- 아니오 --> K[방송 중인지 확인 후 재시작]
 K --> L[터널 주소를 로그에서 읽어 고정 공용 주소 중계에 갱신]
 L --> I`,
'15_AI_대화와_채팅방':`flowchart TD
 A([!채팅 질문]) --> B{키 설정 · 공개 테스트 아님}
 B -- 아니오 --> C[안내 문구]
 B -- 예 --> D{한도 검사}
 D -- 초과 --> E[방송당 하루 100회 · 사용자 10초 · 서버 동시 4건 안내]
 D -- 통과 --> F[최근 6쌍 문맥 + 질문 OpenAI Responses 호출]
 F --> G[답변 200자 이내 전송 · 문맥 30분 보관]
 H([DJ 채팅방 링크 열기]) --> I[방송별 토큰 링크]
 I --> J[청취자 손님 이름으로 입장]
 J --> K{2초 간격 · 400자 이내}
 K -- 통과 --> L[최근 100개 · 7일 보관]
 K -- 위반 --> M[거부 안내]
 L --> N[DJ 메시지 삭제 가능]`};
const prev=resolve(OUT,'../20261118');
try{for(const [n,c] of Object.entries(E))await render(n,c,'ERD');for(const [n,c] of Object.entries(F))await render(n,c,'순서도');}finally{await b.close();}
mkdirSync(join(OUT,'ERD'),{recursive:true});copyFileSync(join(prev,'ERD_JSON논리구조.png'),join(OUT,'ERD','ERD_JSON논리구조.png'));copyFileSync(join(prev,'ERD_JSON논리구조.svg'),join(OUT,'ERD','ERD_JSON논리구조.svg'));
for(const f of readdirSync(join(prev,'순서도')))if(/\.(png|svg)$/.test(f))copyFileSync(join(prev,'순서도',f),join(OUT,'순서도',f));
console.log(readdirSync(join(OUT,'순서도')).join(' '));
