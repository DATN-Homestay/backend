import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { AuthTokenService } from '../../modules/auth/auth-token.service.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

const contextWith = (request: Record<string, any>) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: JwtService;
  let sessionRepo: { findOne: ReturnType<typeof vi.fn> };

  const payload = {
    sub: '15',
    email: 'customer@example.com',
    roles: ['CUSTOMER'],
    sid: '45',
  };

  beforeEach(() => {
    jwtService = new JwtService({ secret: JWT_SECRET });
    sessionRepo = { findOne: vi.fn() };
    const tokenService = new AuthTokenService(
      jwtService,
      { get: (_key: string, fallback?: string) => fallback } as any,
      sessionRepo as any,
    );
    guard = new JwtAuthGuard(tokenService);
  });

  it('nên throw 401 khi thiếu header Authorization', async () => {
    await expect(guard.canActivate(contextWith({ headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('nên throw 401 khi token sai chữ ký', async () => {
    const forged = await new JwtService({ secret: 'another-secret-0123456789abcdef' }).signAsync(payload);

    await expect(
      guard.canActivate(contextWith({ headers: { authorization: `Bearer ${forged}` } })),
    ).rejects.toThrow('Token không hợp lệ hoặc đã hết hạn');
  });

  it('nên throw 401 khi token đã hết hạn', async () => {
    const expired = await jwtService.signAsync(payload, { expiresIn: -10 });

    await expect(
      guard.canActivate(contextWith({ headers: { authorization: `Bearer ${expired}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('nên throw 401 khi phiên đã đăng xuất dù token còn hạn', async () => {
    const token = await jwtService.signAsync(payload);
    sessionRepo.findOne.mockResolvedValue({
      id: '45',
      revoked_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
    });

    await expect(
      guard.canActivate(contextWith({ headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toThrow('Phiên đăng nhập đã kết thúc');
  });

  it('nên gắn request.user khi token và phiên hợp lệ', async () => {
    const token = await jwtService.signAsync(payload);
    sessionRepo.findOne.mockResolvedValue({
      id: '45',
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
    });
    const request: Record<string, any> = {
      headers: { authorization: `Bearer ${token}` },
    };

    await expect(guard.canActivate(contextWith(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: '15',
      email: 'customer@example.com',
      roles: ['CUSTOMER'],
      session_id: '45',
    });
    expect(sessionRepo.findOne).toHaveBeenCalledWith({
      where: { id: '45', user_id: '15' },
    });
  });
});
