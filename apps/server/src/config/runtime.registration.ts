import { registerAs } from '@nestjs/config';
import { loadRuntimeConfig, type RuntimeConfig } from './runtime.config.js';

/** `config.getOrThrow<RuntimeConfig>('runtime')` 로 꺼낸다. */
export const runtimeConfig = registerAs<RuntimeConfig>('runtime', () => loadRuntimeConfig());
