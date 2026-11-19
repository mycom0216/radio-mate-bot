# 다시 만들기 (생성 스크립트)

필요: Node 24+, Microsoft Edge, 패키지 `docx` `pptxgenjs` `jszip`(이 폴더에 설치), 이전 판 본문 추출본 `prev/02_요구사항명세서.md`(`docs.mjs`가 FR01~34를 읽음).
순서: `capture.mjs <서버 주소=PUBLIC_URL> <출력> <repo>` → `diagrams.mjs <OUT>` · `diag2.mjs <OUT>` → `docs.mjs <OUT>` · `docs2.mjs <OUT>` · `deck.mjs <OUT>` → `verify.mjs <OUT> <repo>`.
