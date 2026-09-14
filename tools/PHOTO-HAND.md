# 사진을 그대로 붙인 간단한 3D 손

현재 게임은 `apps/client/public/assets/hand/fps-right-photo.glb`를 사용한다.
이전 `fps-right-realistic.glb`는 보존했지만 manifest에서 사용하지 않는다.
물건을 들면 `fps-right-photo-grip.glb`로 전환하고 내려놓으면 펼친 손으로 돌아간다.

## 방식

- `right-hand-photo-cutout.png`: 사용자가 첨부한 펼친 오른손 사진의 배경 제거 결과.
  내장 imagegen의 background-extraction 편집으로 만든 실제 alpha PNG이다.
  AI 배경 제거 결과이므로 원본 JPG와 픽셀 단위 동일성을 보장하지 않는다.
- 앞면: 누끼 이미지의 UV를 그대로 사용하며 다른 피부 텍스처를 섞지 않는다.
  glTF `KHR_materials_unlit`로 사진을 재조명하지 않는다.
- 형상: alpha 윤곽을 따라 만든 얕은 3D 볼륨. 약 8천 삼각형이며 뒷면/옆면은 단색 피부.
- 쥔 손은 별도로 첨부된 주먹 사진을 배경 제거한 `right-hand-grip-cutout.png`로 만든다.
  두 모델의 표시 여부를 전환하며 사진끼리 억지로 morph하지 않는다.
- `Grip` morph는 쥔 손 파일 로딩 실패 시의 이전 굽힘 포즈 fallback만 담당한다.
  해부학적 손가락 리깅이나 정밀 스캔이 아니다.
- 사진에 없는 손바닥 디테일은 만들지 않았다. 정면 위주의 1인칭 화면용이다.

## 파일과 재생성

- 게임 GLB: `apps/client/public/assets/hand/fps-right-photo.glb`
- 투명 PNG: `apps/client/public/assets/hand/right-hand-photo-cutout.png`
- Blender 원본: `artifacts/hand-photo/photo-hand.blend` (사진 내장)
- 실제 모델 렌더: `artifacts/hand-photo/photo-hand-preview.png`
- 구조 검사: `artifacts/hand-photo/verification.json`
- 쥔 손 GLB: `apps/client/public/assets/hand/fps-right-photo-grip.glb`
- 쥔 손 누끼: `apps/client/public/assets/hand/right-hand-grip-cutout.png`
- 쥔 손 Blender 원본: `artifacts/hand-photo/photo-hand-grip.blend`
- 쥔 손 실제 렌더: `artifacts/hand-photo/photo-hand-grip-preview.png`

`npm run assets:hand`로 두 포즈의 PNG에서 GLB / Blender 원본 / 렌더를 재생성한다.
Blender 5.2가 필요하며 다른 설치 경로는 `BLENDER_PATH`로 지정한다.
PNG와 GLB는 저장소에 포함되어 게임 실행 시 원본 사진이나 Blender가 필요하지 않다.

## 배경 제거 프롬프트 (내장 도구, CLI 아님)

Background removal only. Extract the photographed right hand and wrist on a REAL
TRANSPARENT ALPHA BACKGROUND, not a drawn checkerboard. Output PNG with alpha
channel: every background pixel alpha=0. Keep original hand pixels, original
photo lighting, exact nails, hairs, pose and proportions unchanged. Do not create
any checker pattern. Use the original canvas orientation, fingers upward, right
hand thumb left. No new objects. No change to hand. Only erase the table, floor
and all exterior shadows.

## 쥔 손 배경 제거 프롬프트 (내장 도구)

Use case: background-extraction. Image 1 is the edit target: the user's photographed
clenched RIGHT hand. Remove only the tabletop, floor and cast shadows outside the
hand. Return the same closed fist and visible wrist on a REAL TRANSPARENT ALPHA
BACKGROUND. PNG with alpha channel, exterior alpha=0. Do NOT draw a checkerboard
or black background. Preserve the original hand pose, knuckle shapes, thumb
placement, hairs, wrinkles, natural skin tone and photographic detail. No
restyling, no beautification, no new objects, no gloves, no sleeve. Keep wrist
downward, knuckles upward as in the original. Crop excess empty space around the
fist and wrist to create a tightly framed game texture. Intended use: photograph
pasted directly onto a simple 3D closed-grip hand.
