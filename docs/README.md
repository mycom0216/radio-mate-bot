# Spoon Studio 프로젝트 문서

기준일: 2026-11-17

index.html을 브라우저로 열면 전체 문서를 볼 수 있습니다.

- 요구사항 분석서: 01-요구사항분석서.html / pdf/01-요구사항분석서.pdf (6쪽)
- 요구사항 명세서: 02-요구사항명세서.html / pdf/02-요구사항명세서.pdf (8쪽)
- 개발일정표: 03-개발일정표.html / pdf/03-개발일정표.pdf (3쪽)
- 데이터 정의서: 04-데이터정의서.html / pdf/04-데이터정의서.pdf (7쪽)
- 프로젝트 포트폴리오: 05-포트폴리오.html / pdf/05-포트폴리오.pdf (10쪽)

- ERD: assets/ERD-physical.svg, .png / assets/ERD-logical.svg, .png
- UI 관찰 결과: assets/ui-check.json
- 화면: assets/01~05 PNG

HTML 원본은 도구 없이 편집할 수 있습니다. 데이터 정의서는 실제 SQLite 7개 테이블과 rooms.data JSON 내부 모델을 구분합니다. 일정은 향후 4주 제안이며 과거 실적이 아닙니다. 포트폴리오는 프로젝트 설명이고 작성자 개인 기여를 확정하지 않습니다.

문서 생성: node tools/build-docs.mjs
PDF 및 문서 QA: CODEX_NODE_MODULES에 Playwright 패키지 루트를 설정한 뒤 node tools/export-docs.cjs
이미지 생성 프롬프트와 변경 내역: DESIGN-NOTES.md
