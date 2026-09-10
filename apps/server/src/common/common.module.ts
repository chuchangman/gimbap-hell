import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';

/** /health 카운터는 정적 서빙 · 게이트웨이 · 헬스 컨트롤러가 함께 쓴다. */
@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class CommonModule {}
