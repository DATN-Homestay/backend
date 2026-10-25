import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor.js';

/**
 * Cấu hình dùng chung cho main.ts và e2e test, đảm bảo test chạy đúng như production.
 */
export function configureApp(app: INestApplication): void {
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');
  // whitelist + forbidNonWhitelisted: chặn client gửi kèm trường lạ như total_amount (Zero-Trust BR-009)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new TransformResponseInterceptor(app.get(Reflector)));
}
