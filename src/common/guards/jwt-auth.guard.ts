import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthTokenService } from '../../modules/auth/auth-token.service.js';
import type { AuthUser } from '../../modules/auth/auth.types.js';

/**
 * Xác minh Access Token (chữ ký, hạn, phiên còn hiệu lực)
 * và gắn request.user = { id, email, roles, session_id }.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: AuthTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Thiếu hoặc sai định dạng Bearer Token');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Token không hợp lệ');
    }

    request.user = await this.tokenService.verifyAccessToken(token);
    return true;
  }
}
