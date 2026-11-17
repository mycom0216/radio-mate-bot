# Spoon Studio 프로젝트 문서

기준일: 2026-11-17

index.html을 브라우저로 열면 전체 문서를 볼 수 있습니다.

- 요구사항 분석서: 01-요구사항분석서.html / pdf/01-요구사항분석서.pdf (6쪽)
- 요구사항 명세서: 02-요구사항명세서.html / pdf/02-요구사항명세서.pdf (8쪽)
- 개발일정표: 03-개발일정표.html / pdf/03-개발일정표.pdf (3쪽)
- 데이터 정의서: 04-데이터정의서.html / pdf/04-데이터정의서.pdf (7쪽)
- 프로젝트 포트폴리오: 05-포트폴리오.html / pdf/05-포트폴리오.pdf (12쪽)

- ERD: assets/ERD-physical.svg, .png / assets/ERD-logical.svg, .png
- UI 관찰 결과: assets/ui-check.json
- 화면: assets/01~05 PNG

HTML 원본은 도구 없이 편집할 수 있습니다. 기존 분석·설계 문서는 초기 7개 테이블 기준이며 현재는 outbox를 포함해 8개입니다. 최신 구현·검증 범위는 12쪽 포트폴리오를 기준으로 확인하세요. 일정은 향후 4주 제안이며 과거 실적이 아닙니다. 포트폴리오는 프로젝트 설명이고 작성자 개인 기여를 확정하지 않습니다.

문서 생성: node tools/build-docs.mjs
PDF 및 문서 QA: CODEX_NODE_MODULES에 Playwright 패키지 루트를 설정한 뒤 node tools/export-docs.cjs
이미지 생성 프롬프트와 변경 내역: DESIGN-NOTES.md

최신 발표 자료: [편집 가능한 PPTX](RadioMate-portfolio-2026-11-17-v2.pptx)

최신 포트폴리오 생성: tools/build-portfolio.mjs (RUNTIME_NODE_MODULES, RUNTIME_PYTHON, PRESENTATIONS_SKILL_DIR 필요). PDF 생성: CODEX_NODE_MODULES를 설정하고 node tools/export-portfolio.cjs. 실행 화면 점검: node tools/check-bloom.cjs.
