/* Node 22 는 `--localstorage-file` 없이 켜면 전역 localStorage 를 비워 둔다.
   그 빈 전역이 jsdom 이 얹어 둔 것을 가려서, 테스트에서 localStorage 가
   undefined 로 잡힌다. 캐릭터 꾸미기처럼 저장된 조합을 되살리는 코드가
   그대로 예외 경로로 빠지면 검사가 헛돈다 — Map 하나로 채워 둔다. */

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const current = (globalThis as Record<string, unknown>)[name];
  if (current) continue;
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
