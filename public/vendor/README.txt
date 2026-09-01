three.js r185 (MIT) — node_modules 대신 직접 넣어두었습니다.
npm install 없이 바로 실행되도록 하기 위함입니다.

loaders/GLTFLoader.js, utils/BufferGeometryUtils.js, utils/SkeletonUtils.js
  three.js r185 examples/jsm 에서 그대로 가져왔습니다 (MIT).
  GLTFLoader 가 utils 두 개를 ../utils/ 상대경로로 부르므로 폴더 구조를 지켜야 합니다.
  index.html 의 import map 이 bare specifier "three" 를 three.module.min.js 로 이어줍니다.
