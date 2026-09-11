# 1인칭 실사형 오른손

`apps/client/public/assets/hand/fps-right-realistic.glb`가 실제 게임 에셋이다.
기존 캡슐/타원체 조립 모델은 사용하지 않는다. 기본 포즈는 relaxed,
`Open` / `Grip` morph target으로 손을 펴고 쥘 수 있다.

- 연속 스킨 메시: 원본 1,864 정점 / 1,848 쿼드, 게임용 약 59,000 삼각형.
- 손등: 사용자가 제공한 오른손 사진을 손가락별 랜드마크로 UV 투영하고 색을 조절했다.
- 사진에서 보이지 않는 손바닥/측면: CC0 인체 피부로 보완했다.
- 2K base color / tangent normal, 분리된 소매와 커프.
- GLB 좌표: 미터 단위, 손목 원점, 손가락 +Y, 손등 +Z.
- `.blend`는 원본 스킨의 관절 리그와 가중치, 사진 투영 재질을 보존한다.
  게임용 GLB는 리그 계산 결과를 두 개의 morph로 저장한다.

이 모델은 두 장의 사진으로 복원한 정밀 3D 스캔이 아니다. 손의 비율과
손등 질감을 참고해 만든 근사 모델이며, 손바닥과 보이지 않는 측면은 추정이다.

## 로컬 원본 및 검증

`assets-src/hand-realistic/`는 `.gitignore` 대상인 로컬 작업 원본이다.

- `right-hand-realistic.blend`: 편집 가능한 Blender 원본, 텍스처 내장.
- `right-hand-relaxed.png`, `right-hand-open.png`, `right-hand-grip.png`:
  GLB와 동일한 메시/재질의 실제 Cycles 렌더. 생성형 컨셉 이미지가 아니다.
- `verification.json`: 스킨 연결 성분 1개, 정점 가중치 합, 정점 수, 포즈 목록.
- `source/`: 아래의 CC0 원본 파일.

재생성: `npm run assets:hand`. Blender 5.2 기본 설치 경로를 사용하며,
다른 경로는 `BLENDER_PATH` 환경변수로 지정한다. 게임 실행에는 Blender가 필요 없다.

## 원본 에셋 출처와 라이선스

MakeHuman의 코드 라이선스와 코어 에셋 라이선스는 서로 다르다.
아래에서 사용한 메시, 리그, 타깃, 피부 에셋은 CC0이다.

- [MakeHuman 코어 에셋 라이선스](https://static.makehumancommunity.org/about/license.html)
- [base.obj 및 default rig](https://github.com/makehumancommunity/makehuman):
  `makehuman/data/3dobjs/base.obj`, `data/rigs/default.mhskel`, `default_weights.mhw`
- [Hands01](https://static.makehumancommunity.org/assets/assetpacks/hands01.html):
  jujube의 knobby knuckles, Mindfront의 finger correction / thenar / hypothenar 타깃.
- [Skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html):
  Mindfront의 Aksel diffuse / normal. 배포 GLB에는 손 영역만 베이크해 포함한다.

사용자 손 사진은 사용자 제공 자료이며 CC0 원본과 별개다. 사용자의 사진이나
그 사진에서 추출한 텍스처를 CC0로 재라이선스하지 않는다.

재생성 시 `source/` 아래 `base.obj`, `default.mhskel`, `default_weights.mhw`,
`hand-targets/targets/hands/*.target`, `skins/skins/mindfront_aksel_skin/`와
`assets-src/hand-reference/right-hand-open-reference.png`가 필요하다.
