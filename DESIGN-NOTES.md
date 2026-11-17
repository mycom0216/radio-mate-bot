# Petal Radio 디자인 및 검증 기록

2026-11-17. 사용자 요청에 따라 GitHub `mycom0216/radio-mate-bot`의 main 소스를 현재 작업 폴더에 가져와 수정했습니다. 이 폴더의 기존 Git 저장소는 커밋·remote가 없는 빈 저장소였으며, 기존 커밋 이력을 가져오거나 GitHub에 push하지 않았습니다.

## 변경 범위

- `public/petal.css`: 딸기우유·라일락 배경, 도트, 로즈 버튼, 카드, 모바일 배치, 글자색, 포커스, 동작 줄이기.
- `public/index.html`: 감성적인 첫 화면 문구, 테마 스타일 연결.
- `public/voice.html`: 공통 Petal 테마 연결.
- `public/studio-icons.mjs`: 로그인·대시보드·음성 화면에 새 라디오 PNG 사용. 메뉴·빈 상태의 기존 SVG 아이콘 유지.
- `server.mjs`: 새 CSS·PNG를 명시적인 정적 파일 허용 목록에 등록, PNG Content-Type 지정.
- `Dockerfile` / `.dockerignore`: 새 PNG를 빌드에 포함하고 기존에 누락되어 있던 런타임 모듈(voice·lottery·quiz·extras)을 COPY 목록에 포함. Docker 실행은 미검증.
- `docs/`: 분석서 6쪽, 명세서 8쪽, 제안 일정 3쪽, 데이터 정의서 7쪽, 포트폴리오 10쪽. HTML·PDF, ERD PNG·SVG, 실제 화면.

기존 게임·보상·로그인·데이터 정책을 변경하는 작업은 포함하지 않았습니다.

## 라디오 이미지

저장 위치: `public/radio-petal.png`. 내장 `image_gen` 도구로 생성한 투명 PNG입니다. 홈페이지·대시보드·음성 접수 화면과 문서에 사용합니다. 기존 래스터 이미지를 덮어쓰지 않았습니다.

최종 생성 프롬프트:

> Use case: illustration-story. Asset type: production hero illustration for a Korean radio DJ dashboard. A breathtakingly cute, delicate girlish pastel pink vintage radio, rounded cream body and strawberry milk pink edges, large heart-shaped speaker grille with tiny perforations, smiling little face with blush, pearl knobs, a slender antenna with tiny star tip, a soft satin pink bow tied to its handle. Nestled on a fluffy ivory cloud with a few tiny lavender and blush hearts and four-point sparkles floating around. Elegant kawaii stationery illustration, soft watercolor and velvety 3D clay blend, airy luminous soft shading, fine graceful details, very sweet and lovingly crafted, sophisticated pastel stationery shop aesthetic. Palette blush pink, warm cream, dusty lilac. Square composition, centered complete radio with airy padding, no cropping. Truly transparent background. No words, lettering, logos or watermarks.

## 확인 결과

- Windows / Node v26.13.0 / Edge headless.
- `npm test`: 66 통과, 0 실패. 최초 제한된 실행에서는 loopback EACCES가 발생했으며, 로컬 연결이 가능한 실행에서 전체 통과했습니다.
- 첫 화면과 전체 12개 관리 메뉴: 1440px·390px에서 페이지 가로 넘침·누락 이미지·브라우저 실행 오류 확인.
- 브라우저 테스트에서 프로필 생성 명령 성공.
- 별도 음성 접수 화면 모바일 배치 확인. 테스트용 접수 링크는 확인 후 중지했습니다. 실제 마이크 녹음은 수행하지 않았습니다.
- 문서: 34쪽, 요소·푸터 겹침 검사, 이미지 확인, PDF 텍스트·페이지 수·A4 방향 확인, Poppler 렌더링 후 육안 검토.
- 원시 검증 결과: `docs/assets/ui-check.json`, `document-check.json`, `pdf-check.json`.

## 문서와 시연의 범위

실계정 OAuth/SSE·실제 채팅 송신·마이크 장치·인터넷 HTTPS 배포·장시간 방송·부하·사용자 만족도는 이번 작업에서 확인하지 않았습니다. 개발일정표는 기존 구현 이후의 4주 제안이고 과거 작업 실적이 아닙니다. 포트폴리오는 프로젝트 전체 기능을 설명하며, 개인 기여·이름·과거 개발 기간은 제출 전 본인이 확인해야 합니다.

문서 생성은 `node tools/build-docs.mjs`, PDF 생성은 `tools/export-docs.cjs`, 화면 검증은 `tools/check-ui.cjs`를 사용합니다. 두 브라우저 도구는 Playwright와 Edge가 필요하며 `CODEX_NODE_MODULES`에 Playwright 패키지들이 설치된 폴더를 지정합니다. 프로그램 실행 자체에는 외부 npm 패키지가 필요하지 않습니다.

## 후속 원격 점검

같은 날짜에 사용자의 추가 요청으로 실제 브라우저에서 게임·보상·상점·킵·신청곡·공지·검색 흐름을 조작했습니다. 재고 revision 경합, 대시보드 다음 곡 누락, 984px 입력 필드 넘침, 요청 시간 제한·오류 안내, 빠른 메뉴 이동 처리를 수정했습니다. 명령어 검색과 **청취자 전용 음성 입력 확장**을 추가했고 전체 자동 테스트는 75개 통과했습니다. 실제 375px 전체 메뉴 가로 넘침도 확인했습니다.

확장은 스푼 웹의 청취자 입력창에 인식 문장을 넣고 전송은 직접 누르는 방식입니다. DJ 관리 기능으로 추가하지 않았습니다. 설치·마이크·실계정 입력/전송은 실환경 확인 대상입니다. 자세한 결과·남은 검증은 `docs/원격점검-수정내역.md`, 설치 안내는 `extensions/listener-voice/README.md`를 참고하세요.
