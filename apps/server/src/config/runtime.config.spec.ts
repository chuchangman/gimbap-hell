import { describe, expect, it } from 'vitest';
import { loadRuntimeConfig } from './runtime.config.js';

/* 레거시 test/runtime-config.test.mjs 의 시나리오를 그대로 옮긴 것이다.
   PORT 0 과 빈 문자열, 16진수 표기, recovery 의 Number-or-default 순서가
   조용히 바뀌면 배포 환경에서만 티가 난다. */

describe('loadRuntimeConfig', () => {
  it('PORT 변환이 0 · 빈 문자열 · 범위 초과까지 그대로다', () => {
    const cases: [NodeJS.ProcessEnv, number][] = [
      [{}, 3211],
      [{ PORT: '0' }, 0],
      [{ PORT: '' }, 0],
      [{ PORT: '65535' }, 65535],
      [{ PORT: '  4321 ' }, 4321],
      [{ PORT: '0xC8' }, 200],
    ];
    for (const [env, expected] of cases) expect(loadRuntimeConfig(env).port).toBe(expected);

    for (const port of ['-1', '65536', '1.5', 'NaN', 'abc', 'Infinity'])
      expect(() => loadRuntimeConfig({ PORT: port })).toThrow('Invalid PORT');
  });

  it('복구 시간은 Number-or-default 뒤에 1~60초로 clamp 된다', () => {
    const cases: [string | undefined, number][] = [
      [undefined, 30000],
      ['', 30000],
      ['0', 30000],
      ['NaN', 30000],
      ['-1', 1000],
      ['100', 1000],
      ['1500.5', 1500.5],
      ['45000', 45000],
      ['99999', 60000],
      ['Infinity', 60000],
      ['-Infinity', 1000],
    ];
    for (const [value, expected] of cases)
      expect(loadRuntimeConfig({ GIMBAP_RECOVERY_MS: value }).recoveryMs, String(value)).toBe(
        expected,
      );
  });

  it('운영 기본값이 그대로이고 주입한 환경을 변형하지 않는다', () => {
    const env = Object.freeze({ PORT: '0', GIMBAP_ALLOWED_ORIGINS: 'https://example.invalid' });
    const config = loadRuntimeConfig(env);
    expect(config.maxRooms).toBe(64);
    expect(config.maxConnections).toBe(384);
    expect(config.loopLagResolutionMs).toBe(10);
    expect(config.gameTickMs).toBe(200);
    expect(config.heartbeatMs).toBe(2000);
    expect(config.shutdownTimeoutMs).toBe(5000);
    expect(config.allowedOrigins).toBe('https://example.invalid');
    expect(config.http).toEqual({
      requestTimeout: 15000,
      headersTimeout: 10000,
      keepAliveTimeout: 5000,
    });
    expect(config.socket).toEqual({
      maxHttpBufferSize: 8192,
      connectTimeout: 10000,
      pingInterval: 5000,
      pingTimeout: 5000,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.http)).toBe(true);
    expect(Object.isFrozen(config.socket)).toBe(true);
  });
});
