import { Injectable } from '@nestjs/common';

/** /health 의 rejected 블록. 운영이 밖에서 긁어 가는 값이라 이름을 바꾸지 않는다. */
export type MetricKey =
  | 'invalidHttp'
  | 'httpErrors'
  | 'invalidEvents'
  | 'rateLimited'
  | 'rejectedOrigins'
  | 'recovered'
  | 'expired'
  | 'rejectedDistance'
  | 'rejectedMovement';

@Injectable()
export class MetricsService {
  /* 레거시는 6개를 0으로 초기화하고 rejectedDistance · rejectedMovement 는
     처음 발생할 때 생겼다. /health 응답의 키 구성까지 같아야 하므로 그대로 둔다. */
  private readonly counters: Partial<Record<MetricKey, number>> = {
    invalidHttp: 0,
    httpErrors: 0,
    invalidEvents: 0,
    rateLimited: 0,
    rejectedOrigins: 0,
    recovered: 0,
    expired: 0,
  };

  count(key: MetricKey): void {
    this.counters[key] = (this.counters[key] || 0) + 1;
  }

  snapshot(): Record<string, number> {
    return { ...this.counters };
  }
}
