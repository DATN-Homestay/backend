import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';
import {
  RAW_RESPONSE_KEY,
  RESPONSE_MESSAGE_KEY,
} from '../decorators/response.decorator.js';

export interface ApiResponse<T> {
  statusCode: number;
  message: string;
  data: T | null;
}

/**
 * Bọc mọi response thành công theo chuẩn tài liệu 04_Thiet_ke_API_Specification:
 * { statusCode, message, data }
 * Lỗi giữ nguyên định dạng mặc định của NestJS: { statusCode, error, message }.
 */
@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, targets)) {
      return next.handle();
    }

    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, targets) ??
      'Thành công';
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data) => ({
        statusCode: response.statusCode,
        message,
        data: data ?? null,
      })),
    );
  }
}
