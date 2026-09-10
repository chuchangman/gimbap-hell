import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { runtimeConfig } from './config/runtime.registration.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [runtimeConfig],
    }),
  ],
})
export class AppModule {}
