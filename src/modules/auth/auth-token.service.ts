import * as crypto from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSession } from './entities/user-session.entity.js';
import type { AccessTokenPayload, AuthUser } from './auth.types.js';

/**
 * Ký / xác minh token. Được export toàn cục để JwtAuthGuard dùng ở mọi module.
 */
@Injectable()
export class AuthTokenService {
  readonly accessTtlSeconds: number;
  readonly refreshTtlDays: number;

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService,
    @InjectRepository(UserSession)
    private readonly sessionRepo: Repository<UserSession>,
  ) {
    this.accessTtlSeconds = Number(
      configService.get<string>('JWT_ACCESS_TTL_SECONDS', '900'),
    );
    this.refreshTtlDays = Number(
      configService.get<string>('JWT_REFRESH_TTL_DAYS', '7'),
    );
  }

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      expiresIn: this.accessTtlSeconds,
    });
  }

  /** Sinh refresh token ngẫu nhiên; chỉ hash được lưu xuống DB */
  generateRefreshToken(): { token: string; hash: string } {
    const token = crypto.randomBytes(48).toString('base64url');
    return { token, hash: this.hashToken(token) };
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  refreshExpiresAt(from = new Date()): Date {
    return new Date(from.getTime() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
  }

  /**
   * Xác minh chữ ký + hạn của access token, sau đó kiểm tra phiên còn hiệu lực
   * để token của phiên đã đăng xuất bị chặn ngay (AU-07).
   */
  async verifyAccessToken(token: string): Promise<AuthUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }

    const session = await this.sessionRepo.findOne({
      where: { id: payload.sid, user_id: payload.sub },
    });
    if (!session || session.revoked_at || session.expires_at <= new Date()) {
      throw new UnauthorizedException('Phiên đăng nhập đã kết thúc');
    }

    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles,
      session_id: payload.sid,
    };
  }
}
