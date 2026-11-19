// 검수: 형식·쪽수·슬라이드·노트·요구사항 번호·유출 검사·해시 → 검수결과.json, README/자료안내 생성. 사용: node verify.mjs <OUT> <repo>
import JSZip from 'jszip';import {readFileSync,readdirSync,statSync,existsSync,writeFileSync,rmSync} from 'node:fs';import {join,resolve,relative,extname} from 'node:path';import {createHash} from 'node:crypto';
const OUT=resolve(process.argv[2]),ROOT=resolve(process.argv[3]);
for(const f of readdirSync(OUT))if(/^_pdf_|^_tmp_/.test(f))rmSync(join(OUT,f),{force:true});
const walk=d=>readdirSync(d).flatMap(n=>{const p=join(d,n);return n==='_build'?[]:statSync(p).isDirectory()?walk(p):[p];});
const files=walk(OUT).filter(p=>!/검수결과\.json$/.test(p)).sort(),rel=p=>relative(OUT,p).replaceAll('\\','/');
const secrets=[];for(const dir of [join(ROOT,'deploy')])for(const f of readdirSync(dir).filter(x=>x.endsWith('.env')))for(const line of readFileSync(join(dir,f),'utf8').split(/\r?\n/)){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);if(!m)continue;const v=m[2].replace(/^["']|["']$/g,'');if(/(KEY|SECRET|TOKEN|PASSWORD|CLIENT_ID|SERVICE)/i.test(m[1])&&v.length>=8&&!/^(true|false|https?:)/i.test(v)){let d=v;try{d=decodeURIComponent(v);}catch{}secrets.push([m[1],[v,d,encodeURIComponent(v)]]);}}
const bad=[],warn=[],info={date:'2026-11-19',codeBaseline:'7d9fe1b',pdfPages:{},docx:{},pptx:{},files:{}};
const xt=x=>x.replace(/<\/a:p>|<\/w:p>/g,'\n').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const forb=[[/chatgpt\.site/i,'공용 주소'],[/@basiclike\.kr/i,'이메일'],[/C:[\\/]+Users[\\/]+LMS/i,'로컬 경로'],[/AppData[\\/]+Local/i,'임시 경로'],[/sk-[A-Za-z0-9_-]{20,}/,'키 형식']];
const scan=(n,t)=>{for(const [k,vs] of secrets)for(const v of vs)if(v&&t.includes(v)){bad.push(`${n}: 비밀값 의심 ${k}`);break;}for(const [re,l] of forb)if(re.test(t))bad.push(`${n}: ${l}`);};
let spec='';
for(const p of files){const n=rel(p),buf=readFileSync(p),e=extname(p).toLowerCase();info.files[n]={bytes:buf.length,sha256:createHash('sha256').update(buf).digest('hex')};
 if(e==='.docx'||e==='.pptx'){const z=await JSZip.loadAsync(buf),parts=Object.keys(z.files);let t='';
  if(e==='.docx'){const x=await z.file('word/document.xml').async('string');t=xt(x);info.docx[n]={paragraphs:(x.match(/<w:p[ >]/g)||[]).length,tables:(x.match(/<w:tbl>/g)||[]).length,images:parts.filter(q=>q.startsWith('word/media/')).length};if(/02_/.test(n))spec=t;}
  else{const sl=parts.filter(q=>/^ppt\/slides\/slide\d+\.xml$/.test(q));let notes=0;for(const s of sl){t+=xt(await z.file(s).async('string'));const k=s.match(/slide(\d+)/)[1],nf=z.file(`ppt/notesSlides/notesSlide${k}.xml`);if(nf){const nt=xt(await nf.async('string'));t+=nt;if(nt.replace(/\d+\s*$/,'').trim().length>15)notes++;}}info.pptx[n]={slides:sl.length,slidesWithNotes:notes,media:parts.filter(q=>q.startsWith('ppt/media/')).length};if(notes<sl.length)warn.push(`${n}: 노트 없는 슬라이드 ${sl.length-notes}장`);}
  scan(n,t);}
 else if(e==='.pdf'){info.pdfPages[n]=(buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length;scan(n,buf.toString('latin1'));}
 else if(['.md','.json','.txt','.mmd','.svg'].includes(e))scan(n,buf.toString('utf8'));}
const fr=new Set(spec.match(/\bFR\d{2}\b/g)||[]),nfr=new Set(spec.match(/\bNFR\d{2}\b/g)||[]);info.requirements={functional:fr.size,nonfunctional:nfr.size};
for(let i=1;i<=47;i++)if(!fr.has('FR'+String(i).padStart(2,'0')))bad.push('FR 누락 '+i);for(let i=1;i<=12;i++)if(!nfr.has('NFR'+String(i).padStart(2,'0')))bad.push('NFR 누락 '+i);
info.screenshots=files.filter(p=>/화면캡처\/[DMA]\d\d_.*\.png$/.test(rel(p))).length;info.flowcharts=files.filter(p=>/^순서도\/\d\d_.*\.png$/.test(rel(p))).length;
const uiP=join(process.argv[4]||'','ui-check.json');if(process.argv[4]&&existsSync(uiP)){const u=JSON.parse(readFileSync(uiP,'utf8'));info.uiCheck={checkedAt:u.checkedAt,pageChecks:u.pageChecks,titleMismatch:u.titleMismatch,horizontalOverflow:u.horizontalOverflow,brokenImages:u.brokenImages,errors:u.errors.map(e=>`${e.type} ${e.url||e.text||''}`.slice(0,120))};}
info.problems=bad;info.warnings=warn;
const pg=n=>info.pdfPages['PDF/'+n+'.pdf']??'?',deck=Object.values(info.pptx)[0]||{slides:'?'};
writeFileSync(join(OUT,'README.md'),`# 라디오메이트 최종 산출물 (2026-11-19 판)

기준 코드 \`7d9fe1b\`, 개발 기록 2026-11-16~19(커밋 45개). 기상청 날씨·미세먼지·특보·자동 날씨 안내, AI 대화, 앱 채팅방, 상시 운영 자동 복구를 반영한 최신 자료입니다.

| 편집 파일 | 열람 파일 |
|---|---|
| [요구사항분석서](01_요구사항분석서.docx) — 브레인스토밍·개요·목차 | [PDF](PDF/01_요구사항분석서.pdf) (${pg('01_요구사항분석서')}쪽) |
| [요구사항명세서](02_요구사항명세서.docx) — FR ${fr.size}개·NFR ${nfr.size}개 | [PDF](PDF/02_요구사항명세서.pdf) (${pg('02_요구사항명세서')}쪽) |
| [데이터정의서](03_데이터정의서.docx) — 테이블 13개·ERD 그림 | [PDF](PDF/03_데이터정의서.pdf) (${pg('03_데이터정의서')}쪽) |
| [프로젝트 포트폴리오](05_프로젝트포트폴리오.docx) | [PDF](PDF/05_프로젝트포트폴리오.pdf) (${pg('05_프로젝트포트폴리오')}쪽) |
| [발표 자료 PPTX ${deck.slides}장](06_라디오메이트_발표자료.pptx) — 발표자 노트 포함 | |
| [기능 순서도 ${info.flowcharts}종](04_기능순서도.pdf) | PDF ${info.pdfPages['04_기능순서도.pdf']}쪽 · [PNG·SVG](순서도/) |

- 그림: [ERD](ERD/) · [순서도](순서도/) · [화면 캡처 ${info.screenshots}장](화면캡처/) · [분석 그림](요구분석_그림/) · [포트폴리오 그림](포트폴리오_그림/)
- [파일 안내와 검증 범위](00_자료안내.md) · [검수 결과와 파일 해시](검수결과.json)
- 앞선 판(2026-11-18)은 [../20261118/](../20261118/README.md)에 그대로 있습니다. 개발일정표는 이번 판에서 다시 만들지 않았습니다.
`,'utf8');
writeFileSync(join(OUT,'00_자료안내.md'),`# 라디오메이트 프로젝트 최종 자료 (2026-11-19 판)

기준 코드 \`7d9fe1b\` / 2026-11-19. 실제 개발 기록 2026-11-16~19. 이후 일정은 확정되지 않은 제안입니다.

| 파일 | 내용 |
|---|---|
| 01_요구사항분석서.docx | 개요·목차·브레인스토밍(마인드맵)·사용자 분석·요구 분류·제약과 위험·검증 계획 |
| 02_요구사항명세서.docx | 기능 요구 FR01~FR47·비기능 NFR01~NFR12·외부 인터페이스·화면/명령어·상세 명세·추적표 |
| 03_데이터정의서.docx | SQLite 테이블 13개·컬럼 사전·물리/날씨/JSON 논리 ERD 그림·보관 정책 |
| 04_기능순서도.pdf | 업무 흐름 15종(이전 9종 + 날씨·미세먼지/특보·자동 안내·운영 복구·AI/채팅방 6종) |
| 05_프로젝트포트폴리오.docx | 프로젝트 요약·문제 해결 사례·품질 보증·개인/AI 보조 기여 구분 |
| 06_라디오메이트_발표자료.pptx | 편집 가능한 ${deck.slides}장·발표자 노트·실제 화면·ERD·순서도 |
| ERD/ · 순서도/ | 그림 PNG·SVG, 순서도 Mermaid 원본(mmd/) |
| 화면캡처/ | 작업 화면·별도 페이지·모바일 ${info.screenshots}장. \`_본문\`이 붙은 파일은 첫 화면 크기, 붙지 않은 파일은 화면 전체 |
| PDF/ | Word 문서의 열람용 PDF |
| 검수결과.json | 쪽수·슬라이드·요구사항 번호 확인·해시·비밀값 검사·UI 점검 결과 |

## 검증과 범위

- 자동 테스트: 2026-11-19 \`node --test\` 전체 261개 통과(실패 0). 이번 작업에서 앱 코드는 바꾸지 않았습니다.
- 실서버 확인(2026-11-19): 기상청 RSS·단기·중기 연동, 에어코리아, 기상특보, 자동 날씨 안내, 관리자 강제 종료 후 이어받기.
- UI 점검: 테스트 공간에서 15개 화면을 데스크톱 1440·모바일 390으로 열어 제목 불일치 0, 가로 넘침 0, 깨진 이미지 0을 확인했습니다. 시작 화면에서 보안 정책(CSP) 위반 로그 1건과 favicon 404가 있었고 화면 동작에는 영향이 없었습니다.
- 화면 캡처는 공개 테스트 공간(가상 청취자·가상 신청곡)에서 촬영했고 실제 방송·토큰·계정은 없습니다. 날씨·맛집 결과는 촬영 시점의 실제 외부 응답입니다. 음성 접수 페이지는 키 없는 임시 로컬 서버에서 촬영했습니다. Android 실제 기기·에뮬레이터 캡처는 이번 판에 새로 만들지 않았습니다(이전 판 자료 참고).
- 문서 확인 범위: Word 문서는 같은 내용 모델로 만든 PDF·HTML로 점검했고, PPTX는 같은 좌표의 HTML 미리보기와 글 넘침 검사로 점검했습니다. 이 PC에는 Word·PowerPoint가 없어 해당 프로그램으로 직접 열어 보지는 못했습니다.
- 실기기·실방송 인수, Google Play 출시, 장기 운영 지표는 범위 밖입니다. 측정하지 않은 성과는 주장하지 않았습니다.
- 개인 프로젝트입니다. 요구 정의와 운영 피드백은 사용자가, 구현·테스트·문서 작성은 AI 도구의 보조로 진행했습니다.
- 실제 토큰·API 키·계정·운영 DB·원본 음성은 포함하지 않았고 검수결과.json에 비밀값 검사 결과(문제 ${bad.length}건)를 남겼습니다.

## 이전 판과 달라진 점

AI 대화, 앱 채팅방, 맛집·카페, 기상청 날씨(대체 경로·DB·부가 명령·미세먼지·특보·자동 안내), 수집 장애 가시화, 상시 운영 자동 복구, 운영 자동화 프로필이 추가되었습니다. FR34→FR47, NFR09→NFR12, 테이블 9→13, 자동 테스트 176→261입니다.
`,'utf8');
writeFileSync(join(OUT,'검수결과.json'),JSON.stringify(info,null,2)+'\n','utf8');
console.log(JSON.stringify({docx:info.docx,pptx:info.pptx,pdf:info.pdfPages,req:info.requirements,shots:info.screenshots,flows:info.flowcharts,files:files.length,bad,warn},null,1));
