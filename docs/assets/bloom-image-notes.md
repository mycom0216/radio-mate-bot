# Bloom 이미지 제작 기록

2026-11-17 · 내장 image_gen 도구의 이미지 편집 기능 사용.
기존 public/radio-petal.png를 참고하고 원본은 보존했습니다.
최종 웹 에셋: public/radio-bloom.webp (800px) / public/radio-bloom-mini.webp (180px).
생성 결과를 WebP로 변환·축소했으며 UI에 실제 연결했습니다.

## 사용한 프롬프트

Use case: precise-object-edit. Asset type: transparent hero illustration for an existing Korean pastel radio web app. Edit target is the attached pink heart radio mascot. Preserve its recognizable pink portable radio body, central heart-shaped speaker, smiling little face, pearl knobs, satin pink bow on its handle, gold star antenna, cloud pedestal. Refine the illustration into an exceptionally charming collectible miniature: clean, soft polished 3D/clay and satin material, delicate strawberry milk pink, warm ivory, lavender accents, tiny pearlescent highlights, graceful ribbon loops. Make the face subtly sweeter with closed crescent eyes, small happy mouth, gentle blush. A few tiny heart and four-point sparkle charms only, clustered close to the radio. Remove ALL the dirty white speckled edge noise visible in the source. Strong clean readable silhouette at miniature size. Centered composition with generous transparent margin, full radio and cloud visible, no cropping, premium stationery boutique aesthetic. No text, no letters, no watermark, no extra characters, no background, genuinely transparent alpha.

## 확인

- Edge 390/1024/1440px 가로 넘침·이미지 누락·페이지 JS 오류 없음.
- PPTX 12장 구조·도형 배치·폰트·재가져오기 검사 통과, 이미지 바이트 내장 확인.
- HTML/PDF 12페이지 배치와 PDF 텍스트·렌더 확인.
- PowerPoint 애플리케이션에서 직접 연 검증은 별도입니다.
