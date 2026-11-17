import {readFileSync} from 'node:fs';
import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
const root=process.cwd(),runtime=process.env.RUNTIME_NODE_MODULES;if(!runtime)throw Error('RUNTIME_NODE_MODULES is required');
const require=createRequire(path.join(runtime,'package.json'));const sharp=require('sharp');
const {Presentation,PresentationFile}=await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const skill=process.env.PRESENTATIONS_SKILL_DIR;if(!skill)throw Error('PRESENTATIONS_SKILL_DIR is required');
const build=path.join(root,'output/.portfolio-build');await fs.mkdir(build,{recursive:true});await fs.mkdir(path.join(root,'docs'),{recursive:true});
const image=path.join(build,'radio.png');await sharp('public/radio-bloom.webp').png().toFile(image);
const data=[
 {title:'마음이 머무는\n작은 라디오방',subtitle:'Spoon Studio · Radio Mate',type:'cover',body:['스푼 방송의 신청곡·게임·음성 접수를 관리하는 도구','저장소 이력 기준 2026.11.16–11.17 · 최신 갱신 2026.11.17','AI 보조 구현·검증 자료 | 개인 기여 범위는 본인 확인 필요'],source:'Git log 53639cc~68914d3; README.md; public/bloom.css'},
 {title:'방송 운영의 반복 작업을 한곳에',subtitle:'사용자 흐름과 구현 범위',body:['DJ: 설정·신청곡·보상·음성 수신함을 한 화면에서 관리','청취자: 출석·게임·신청곡으로 참여하고 음성 메시지를 접수','문제: 중복 지급과 전송 실패를 같은 문제로 다루면 잔액이 틀어질 수 있음','판단: 보상 정산과 메시지 전달을 분리하되 DB에는 함께 기록'],source:'core.mjs:Engine.handle; server.mjs; voice.mjs'},
 {title:'부드러운 화면, 명확한 조작',subtitle:'새 디자인 · 실제 실행 화면',type:'screens',body:['딸기우유·라벤더·크림·민트 컬러','라디오 미니미, 리본, 체크·레이스 배경','390·1024·1440px 화면 확인 · 가로 넘침 0'],source:'tools/check-bloom.cjs; output/bloom-ui-checks.json; docs/assets/'},
 {title:'공식 API와 방송별 데이터 격리',subtitle:'구성 · 연결 · 저장',type:'architecture',body:['브라우저 관리 화면 → Node.js HTTP API → SQLite','스푼 OAuth 동의 → 암호화 토큰 → SSE 이벤트 수신','방송 ID별 설정·청취자·이벤트·음성을 분리','한국·일본 지역에 맞춰 로그인 주소와 API 서버를 함께 선택'],source:'server.mjs; spoon.mjs:spoonRegion; core.mjs:Store'},
 {title:'보상은 한 번만 정산',subtitle:'핵심 설계 01 · 중복·경합 보호',body:['이벤트 ID를 확인하고 SQLite 트랜잭션 안에서 명령을 처리','보상·잔액·도감·기록과 결과 메시지를 함께 커밋','오버플로와 규칙 위반은 SAVEPOINT로 되돌림','복권 변경 버전으로 비동기 추첨 중 초기화·재지급 경합 차단'],source:'core.mjs:Engine.handle/handleAsync; test/review-regressions.test.mjs; test/lottery-batch.test.mjs'},
 {title:'전송 실패가 보상 재지급으로 이어지지 않도록',subtitle:'핵심 설계 02 · 영속 전송 대기열',body:['결과만 대기열에 보관하고 보상 명령 자체는 재실행하지 않음','429 전송 제한은 최대 5회 재시도 · 10분 지난 메시지는 만료','통신 오류·5xx·전송 중 재시작은 전송 확인 필요로 분리','운영자가 중복 가능성을 확인한 뒤 수동 재전송 또는 취소'],source:'outbox.mjs; spoon.mjs:sendDetailed; public/operations-ui.mjs; test/operations.test.mjs'},
 {title:'DB와 음성을 함께 복구',subtitle:'핵심 설계 03 · 암호화 전체 백업',body:['6시간마다 전체 백업 · 최근 7개 날짜 사본 보관','DB 스냅샷과 등록된 음성을 AES-256-GCM으로 암호화','키·DB 무결성·음성 파일 크기를 검증하고 새 폴더로만 복원','백업 실패 시 이전 사본 보존 · TOKEN_KEY는 별도 보관'],source:'backup.mjs; server.mjs:runMaintenance; test/backup-runtime.test.mjs'},
 {title:'운영자에게 데이터 관리 권한 제공',subtitle:'개인정보 · 보관 · 삭제',body:['내 방송 데이터 내려받기: 프로필·설정·최근 기록·음성','청취자 삭제와 방송 계정 삭제, 스푼 연결·토큰 폐기','음성 보관 기간 설정과 개인정보 안내 페이지 제공','이전 백업의 삭제 유예와 복원 후 삭제 요청 재적용을 안내'],source:'privacy.mjs; public/privacy.html; server.mjs:/api/export /api/account-delete'},
 {title:'작지만 실제 운영에 필요한 편의 기능',subtitle:'참여 기능 · 시간 · 읽기 흐름',body:['도감·팬랭킹·신청곡·킵: 200자 이내 한 페이지씩 조회','아이템 시간 일시정지: 게임 OFF·조용 모드·방송 미연결 대응','한글·이모지 청크 경계 보존, 큰 요청 413, 잘못된 JSON 400','설정 revision 검사로 다른 탭의 오래된 저장을 거부'],source:'pagination.mjs; core.mjs:syncBuffs; http-utils.mjs; test/http-utils.test.mjs'},
 {title:'검증한 범위를 증거로 구분',subtitle:'테스트와 실제 실행 결과',type:'verification',body:['101개 자동 테스트 통과: 보상·격리·전송·백업·권한·HTTP','GitHub Actions: Windows/Linux 테스트와 Docker 빌드·운영 모드 기동','실제 Edge: PC·모바일 화면, 설정 저장, 이미지·가로 넘침 확인','공용 임시 HTTPS: /health 응답 및 자동 암호화 백업 생성 확인'],source:'deploy/additional-tests.log; tools/check-bloom.cjs; GitHub Actions runs 44025884030; /health'},
 {title:'배포 구성과 실제 서비스 검증은 구분',subtitle:'남은 외부 의존성과 제한',body:['Caddy 자동 HTTPS와 Cloudflare 고정 터널 구성을 제공','고정 주소 운영에는 도메인·계정·터널 토큰 설정이 필요','실제 DJ OAuth·토큰 갱신·방송 채팅 송수신·마이크는 미검증','공식 API에 없는 채팅 강퇴·삭제와 월간 DJ 순위는 수동 처리'],source:'deploy/README.md; deploy/compose.https.yaml; deploy/compose.tunnel.yaml; https://developers.spooncast.net/docs/en/api-reference/endpoints'},
 {title:'면접에서 설명할 수 있는 작업으로 정리',subtitle:'기여 범위 · 근거 · 다음 검증',body:['작업 방식: AI 보조 설계·구현·문서화·자동 검증','개인 직접 기여로 제출할 항목은 본인의 코드 검토·수행 기록으로 확정','설명 포인트: 정산 트랜잭션, 불확실한 전달, 안전한 복원','다음 단계: 실제 DJ 동의로 지역별 연동과 실패 복구 검증'],source:'Git history; README.md; test/; contribution boundary based on conversation'}
];
const p=Presentation.create({slideSize:{width:1280,height:720}});p.theme.defaultFont='Malgun Gothic';
const colors={bg:'#FFFAFC',ink:'#633C53',rose:'#A03F6E',muted:'#856A7A',line:'#E9CADB',pink:'#F8DEEA',lav:'#ECE4F7',mint:'#E6F2EA'};
function rect(sl,x,y,w,h,fill,line='none',geo='rect'){return sl.shapes.add({geometry:geo,position:{left:x,top:y,width:w,height:h},fill,line:{fill:line,width:line==='none'?0:1}});}
function text(sl,value,x,y,w,h,size=25,bold=false,color=colors.ink){const sh=rect(sl,x,y,w,h,'none');sh.text=value;sh.text.style={fontSize:size,bold,typeface:'Malgun Gothic',color,wrap:'square',autoFit:'none',insets:0,verticalAlignment:'top'};return sh;}
function img(sl,file,x,y,w,h){sl.images.add({blob:new Uint8Array(readFileSync(file)),contentType:'image/png',position:{left:x,top:y,width:w,height:h},fit:'contain',alt:path.basename(file)});}
for(let i=0;i<data.length;i++){
 const d=data[i],sl=p.slides.add();sl.background.fill=colors.bg;
 rect(sl,0,0,12,720,[colors.pink,colors.lav,colors.mint][i%3]);rect(sl,64,670,1152,1,colors.line);text(sl,'RADIO MATE · 2026.11.17',64,684,850,20,13,false,colors.muted);text(sl,String(i+1).padStart(2,'0')+' / '+data.length,1130,684,100,20,13,false,colors.muted);
 sl.speakerNotes.text='근거: '+d.source+'\n구현·자동 테스트·브라우저 실행·실방송 검증은 서로 다른 증거 수준입니다. 테스트 수는 2026.11.17 로컬 101개 통과 기준입니다.';
 if(d.type==='cover'){
 text(sl,'SPOON STUDIO / PROJECT PORTFOLIO',64,66,720,30,18,true,colors.rose);text(sl,d.title,64,155,680,190,62,true);text(sl,d.subtitle,66,365,650,45,29,true,colors.rose);text(sl,d.body[0],66,426,650,74,24);text(sl,d.body[1],66,550,650,33,18,false,colors.muted);text(sl,d.body[2],66,596,650,35,16,false,colors.muted);img(sl,image,735,112,480,480);continue;
 }
 text(sl,d.subtitle,64,44,1120,28,17,true,colors.rose);text(sl,d.title,64,95,1144,100,39,true);
 if(d.type==='screens'){
 img(sl,'docs/assets/bloom-dashboard-slide.png',64,195,802,450);img(sl,'docs/assets/bloom-mobile-slide.png',900,177,177,470);text(sl,d.body.join(' · '),64,636,1150,24,15,false,colors.muted);continue;
 }
 if(d.type==='architecture'){
 const labels=['브라우저\nDJ 관리 화면','Node.js\n인증·명령 처리','SQLite\n방송별 저장'];for(let j=0;j<3;j++){const x=64+j*390;rect(sl,x,215,340,105,[colors.pink,colors.lav,colors.mint][j]);text(sl,labels[j],x+22,235,300,76,26,true);if(j<2)text(sl,'→',x+350,250,36,45,30,true,colors.rose);}
 d.body.forEach((v,j)=>text(sl,v,80,365+j*62,1120,50,24));continue;
 }
 if(d.type==='verification'){
 text(sl,'101',66,210,360,155,112,true,colors.rose);text(sl,'자동 테스트 통과',72,365,310,48,26,true);text(sl,'실방송 성과·사용자 수를\n측정한 수치는 아닙니다.',72,445,330,88,22,false,colors.muted);d.body.forEach((v,j)=>text(sl,v,455,215+j*102,740,85,25));continue;
 }
 d.body.forEach((v,j)=>{text(sl,String(j+1).padStart(2,'0'),65,221+j*98,50,45,26,true,colors.rose);rect(sl,130,217+j*98,3,55,[colors.pink,colors.lav,colors.mint][j%3]);text(sl,v,155,218+j*98,1040,80,27,false);});
}
const candidate=path.join(build,'candidate.pptx');await (await PresentationFile.exportPptx(p)).save(candidate);
for(let i=0;i<p.slides.items.length;i++){const png=await p.export({slide:p.slides.items[i],format:'png',scale:1});await fs.writeFile(path.join(build,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));}
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
let revision=2;while(await fs.access(path.join(root,`docs/RadioMate-portfolio-2026-11-17-v${revision}.pptx`)).then(()=>true,()=>false))revision++;
const finalName=`RadioMate-portfolio-2026-11-17-v${revision}.pptx`;const final=path.join(root,'docs',finalName);
const result=await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath:final,pythonExecutable:process.env.RUNTIME_PYTHON,integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],explicitTotalSlideCount:data.length,fontPolicy:{basis:'design',families:['Malgun Gothic']},verifyArtifactToolImport:true,receiptPath:path.join(build,`validation-v${revision}.json`)});
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=data.map((d,i)=>`<section class="page"><header><span>SPOON STUDIO ♡ PORTFOLIO</span><span>2026.11.17 업데이트</span></header><p class="doc-kicker">${esc(d.subtitle)}</p><h${i===0?1:2}>${esc(d.title).replaceAll('\n','<br>')}</h${i===0?1:2}>${d.type==='cover'?'<img class="cover-art" src="../public/radio-bloom.webp" alt="리본 라디오 캐릭터">':d.type==='screens'?'<img class="screen-crop" src="assets/bloom-dashboard-slide.png" alt="최신 실행 화면">':''}<div class="portfolio-points">${d.body.map(v=>`<p>${esc(v)}</p>`).join('')}</div><p class="source">근거: ${esc(d.source)}</p><footer><span>RADIO MATE · AI 보조 구현 · 실제 연동 검증 별도</span><span>${String(i+1).padStart(2,'0')} / ${data.length}</span></footer></section>`).join('');
await fs.writeFile('docs/05-포트폴리오.html',`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Radio Mate 최신 포트폴리오</title><link rel="stylesheet" href="document.css"><style>@page{size:A4 landscape;margin:0}.landscape .page{background:#fffafd}.landscape header{margin-bottom:20px}.portfolio-points p{font-size:18px;line-height:1.65;margin:15px 0}.landscape .screen-crop{height:320px;object-fit:contain}.landscape .cover-art{width:310px;height:310px}.landscape .source{font-size:10px;margin-top:16px}.landscape h1{font-size:48px}.landscape h2{font-size:30px}.page>.doc-kicker{margin:8px 0}.landscape .page:has(.screen-crop) .portfolio-points p{font-size:13px;display:inline;margin-right:18px}.landscape .page:has(.screen-crop) .source{margin-top:10px}</style></head><body class="landscape"><div class="toolbar"><a href="index.html">← 문서 모음</a><a href="${finalName}">편집 가능한 PPTX 내려받기</a></div>${html}</body></html>`);
const manifest=JSON.parse(await fs.readFile('docs/manifest.json','utf8'));manifest.find(x=>x.name==='05-포트폴리오').pages=data.length;await fs.writeFile('docs/manifest.json',JSON.stringify(manifest,null,2));await fs.writeFile(path.join(build,'content.json'),JSON.stringify(data,null,2));console.log(JSON.stringify({final,slides:data.length,result}));

