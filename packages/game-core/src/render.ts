/* 렌더러 전용 시각 상수. 게임 규칙에는 영향을 주지 않지만
   카메라·입력·스윙 타이밍은 QA 가 값으로 고정해 두고 있다. */
export const CAMERA_VIEW = Object.freeze({ fov: 72, near: 0.05, far: 140 });
export const PLAYER_INPUT = Object.freeze({ lookSensitivity: 0.0022, maxPitch: 1.35 });
export const CHARACTER_MOTION = Object.freeze({ swingMs: 260 });
