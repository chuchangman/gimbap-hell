import path from 'node:path';

/** 백슬래시 · 콜론 · 제어문자(U+0000-U+001F, U+007F) 가 하나라도 있는가.
 *  레거시 http.mjs 의 경로 거부 정규식과 같은 판정이며 spec 이 대조해 고정한다. */
export function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // 0x5c 백슬래시 · 0x3a 콜론 · 0x00-0x1f 와 0x7f 제어문자.
    // 이스케이프 리터럴을 쓰지 않는다 — 소스를 오가며 백슬래시가 줄어든다.
    if (code <= 0x1f || code === 0x7f || code === 0x5c || code === 0x3a) return true;
  }
  return false;
}

/**
 * 요청 URL 을 공개 디렉터리 안의 실제 경로로 바꾼다.
 * 밖으로 나가는 경로나 점으로 시작하는 이름은 null 을 준다 (.env · .git 차단).
 */
export function resolvePublicPath(root: string, requestUrl: unknown): string | null {
  if (typeof requestUrl !== 'string' || requestUrl.length > 2048) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestUrl.split('?')[0]);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || hasUnsafeChar(decoded)) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.'))) return null;
  const resolved = path.resolve(root, parts.length ? parts.join('/') : 'index.html');
  return resolved.startsWith(path.resolve(root) + path.sep) ? resolved : null;
}
