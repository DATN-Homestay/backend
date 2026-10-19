import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { AuthService } from './auth.service.js';
import { AuthTokenService } from './auth-token.service.js';
import {
  SessionRevokeReason,
  UserSession,
} from './entities/user-session.entity.js';
import { User, UserStatus } from '../users/entities/user.entity.js';
import { Role, RoleType } from '../users/entities/role.entity.js';

// =========================================================
// MOCK FACTORIES
// =========================================================

const mockRepo = () => ({
  find: vi.fn(),
  findOne: vi.fn(),
  exists: vi.fn(),
  create: vi.fn((data) => data),
  save: vi.fn(),
  update: vi.fn(),
});

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const CLIENT = { ip: '118.70.12.5', userAgent: 'Chrome 128 on Windows 11' };

const roleCustomer = { id: 1, name: RoleType.CUSTOMER } as Role;
const roleHost = { id: 2, name: RoleType.HOST } as Role;

// Hash 1 lần dùng chung để test chạy nhanh
const PASSWORD = 'SecurePass123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: '15',
    email: 'customer@example.com',
    password_hash: PASSWORD_HASH,
    full_name: 'Nguyễn Văn A',
    phone_number: '0912345678',
    avatar_url: null,
    status: UserStatus.ACTIVE,
    failed_login_count: 0,
    locked_until: null,
    roles: [roleCustomer],
    created_at: new Date('2026-10-01'),
    ...overrides,
  }) as User;

// =========================================================
// SETUP MODULE
// =========================================================

describe('AuthService', () => {
  let service: AuthService;
  let tokenService: AuthTokenService;
  let jwtService: JwtService;
  let userRepo: ReturnType<typeof mockRepo>;
  let roleRepo: ReturnType<typeof mockRepo>;
  let sessionRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    userRepo = mockRepo();
    roleRepo = mockRepo();
    sessionRepo = mockRepo();
    jwtService = new JwtService({ secret: JWT_SECRET });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        AuthTokenService,
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { get: (_key: string, fallback?: string) => fallback },
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Role), useValue: roleRepo },
        { provide: getRepositoryToken(UserSession), useValue: sessionRepo },
      ],
    }).compile();

    service = module.get(AuthService);
    tokenService = module.get(AuthTokenService);
  });

  // =========================================================
  // ĐĂNG KÝ
  // =========================================================

  describe('register()', () => {
    const dto = {
      email: 'customer@example.com',
      password: PASSWORD,
      full_name: 'Nguyễn Văn A',
      phone_number: '0912345678',
    };

    beforeEach(() => {
      userRepo.exists.mockResolvedValue(false);
      userRepo.save.mockImplementation(async (u) => Object.assign(u, { id: '15' }));
    });

    it('nên tạo CUSTOMER với mật khẩu đã băm bcrypt', async () => {
      roleRepo.find.mockResolvedValue([roleCustomer]);

      const result = await service.register(dto);

      const saved = userRepo.save.mock.calls[0][0];
      expect(saved.password_hash).not.toBe(PASSWORD);
      expect(await bcrypt.compare(PASSWORD, saved.password_hash)).toBe(true);
      expect(saved.roles).toEqual([roleCustomer]);
      expect(result).toEqual({
        user_id: '15',
        email: 'customer@example.com',
        full_name: 'Nguyễn Văn A',
        roles: [RoleType.CUSTOMER],
      });
    });

    it('nên gán cả CUSTOMER và HOST khi đăng ký làm Host', async () => {
      roleRepo.find.mockResolvedValue([roleCustomer, roleHost]);
      // Host phải xác thực OTP email trước khi đăng ký
      (service as any).registerOtpStore.set(dto.email, {
        code: '123456',
        expiresAt: Date.now() + 60_000,
        verified: true,
      });

      const result = await service.register({ ...dto, role: RoleType.HOST });

      expect(result.roles).toEqual([RoleType.CUSTOMER, RoleType.HOST]);
      expect(userRepo.save.mock.calls[0][0].roles).toHaveLength(2);
    });

    it('nên từ chối Host chưa xác thực OTP email', async () => {
      await expect(
        service.register({ ...dto, role: RoleType.HOST }),
      ).rejects.toThrow('xác thực mã OTP email');
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('nên cho Host đăng ký không cần số điện thoại khi đã xác thực OTP email', async () => {
      roleRepo.find.mockResolvedValue([roleCustomer, roleHost]);
      (service as any).registerOtpStore.set(dto.email, {
        code: '123456',
        expiresAt: Date.now() + 60_000,
        verified: true,
      });

      await service.register({ ...dto, phone_number: undefined, role: RoleType.HOST });

      expect(userRepo.save.mock.calls[0][0].phone_number).toBeNull();
    });

    it('nên throw ConflictException khi email đã tồn tại', async () => {
      userRepo.exists.mockResolvedValueOnce(true);

      await expect(service.register(dto)).rejects.toThrow('Email đã được sử dụng');
    });

    it('nên throw ConflictException khi số điện thoại đã tồn tại', async () => {
      userRepo.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await expect(service.register(dto)).rejects.toThrow(
        'Số điện thoại đã được sử dụng',
      );
    });

    it('nên chuyển lỗi trùng khóa của MySQL (đăng ký đồng thời) thành ConflictException', async () => {
      roleRepo.find.mockResolvedValue([roleCustomer]);
      const dupError = new QueryFailedError('INSERT', [], {
        code: 'ER_DUP_ENTRY',
      } as any);
      userRepo.save.mockRejectedValue(dupError);

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  // =========================================================
  // ĐĂNG NHẬP
  // =========================================================

  describe('login()', () => {
    beforeEach(() => {
      sessionRepo.save.mockImplementation(async (s) => ({ ...s, id: '45' }));
    });

    it('nên trả token và lưu HASH của refresh token (không lưu token thô)', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());

      const result = await service.login(
        { email: 'customer@example.com', password: PASSWORD },
        CLIENT,
      );

      const session = sessionRepo.save.mock.calls[0][0];
      expect(session.refresh_token_hash).toBe(
        tokenService.hashToken(result.refresh_token),
      );
      expect(session.refresh_token_hash).not.toBe(result.refresh_token);
      expect(session.ip_address).toBe(CLIENT.ip);
      expect(session.user_agent).toBe(CLIENT.userAgent);

      const payload = await jwtService.verifyAsync(result.access_token);
      expect(payload).toMatchObject({
        sub: '15',
        email: 'customer@example.com',
        roles: [RoleType.CUSTOMER],
        sid: '45',
      });
      expect(result.expires_in).toBe(900);
      expect(result.user.roles).toEqual([RoleType.CUSTOMER]);
    });

    it('nên throw 401 với cùng thông điệp khi email không tồn tại', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: PASSWORD }, CLIENT),
      ).rejects.toThrow('Email hoặc mật khẩu không đúng');
    });

    it('nên tăng bộ đếm khi sai mật khẩu', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ failed_login_count: 2 }));

      await expect(
        service.login({ email: 'customer@example.com', password: 'WrongPass1' }, CLIENT),
      ).rejects.toThrow(UnauthorizedException);
      expect(userRepo.update).toHaveBeenCalledWith('15', { failed_login_count: 3 });
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('nên khóa tài khoản 15 phút ở lần sai thứ 5', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ failed_login_count: 4 }));
      const before = Date.now();

      await expect(
        service.login({ email: 'customer@example.com', password: 'WrongPass1' }, CLIENT),
      ).rejects.toThrow(UnauthorizedException);

      const [, update] = userRepo.update.mock.calls[0];
      expect(update.failed_login_count).toBe(0);
      const lockedMs = update.locked_until.getTime() - before;
      expect(lockedMs).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
      expect(lockedMs).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
    });

    it('nên throw 403 khi tài khoản đang bị khóa tạm, kể cả mật khẩu đúng', async () => {
      userRepo.findOne.mockResolvedValue(
        makeUser({ locked_until: new Date(Date.now() + 10 * 60 * 1000) }),
      );

      await expect(
        service.login({ email: 'customer@example.com', password: PASSWORD }, CLIENT),
      ).rejects.toThrow(ForbiddenException);
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('nên throw 403 khi tài khoản không còn ACTIVE', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ status: UserStatus.BANNED }));

      await expect(
        service.login({ email: 'customer@example.com', password: PASSWORD }, CLIENT),
      ).rejects.toThrow('Tài khoản đã bị khóa');
    });

    it('nên reset bộ đếm khi đăng nhập đúng sau vài lần sai', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ failed_login_count: 3 }));

      await service.login({ email: 'customer@example.com', password: PASSWORD }, CLIENT);

      expect(userRepo.update).toHaveBeenCalledWith('15', {
        failed_login_count: 0,
        locked_until: null,
      });
    });
  });

  // =========================================================
  // LÀM MỚI TOKEN
  // =========================================================

  describe('refresh()', () => {
    const makeSession = (overrides: Partial<UserSession> = {}) =>
      ({
        id: '45',
        user_id: '15',
        refresh_token_hash: tokenService.hashToken('old-token'),
        previous_token_hash: null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revoked_at: null,
        user: makeUser(),
        ...overrides,
      }) as UserSession;

    it('nên xoay vòng: lưu hash cũ vào previous_token_hash và trả token mới', async () => {
      sessionRepo.findOne.mockResolvedValue(makeSession());
      sessionRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.refresh('old-token', CLIENT);

      expect(result.refresh_token).not.toBe('old-token');
      const [criteria, update] = sessionRepo.update.mock.calls[0];
      expect(criteria).toMatchObject({
        id: '45',
        refresh_token_hash: tokenService.hashToken('old-token'),
      });
      expect(update.previous_token_hash).toBe(tokenService.hashToken('old-token'));
      expect(update.refresh_token_hash).toBe(tokenService.hashToken(result.refresh_token));

      const payload = await jwtService.verifyAsync(result.access_token);
      expect(payload.sid).toBe('45');
    });

    it('nên thu hồi phiên khi refresh token cũ bị dùng lại', async () => {
      sessionRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeSession({ refresh_token_hash: 'newer-hash' }));

      await expect(service.refresh('old-token', CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: '45' }),
        expect.objectContaining({ revoke_reason: SessionRevokeReason.REUSE_DETECTED }),
      );
    });

    it('nên throw 401 khi token không tồn tại và không phải token cũ', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('random-token', CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionRepo.update).not.toHaveBeenCalled();
    });

    it('nên throw 401 khi phiên đã hết hạn', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({ expires_at: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh('old-token', CLIENT)).rejects.toThrow(
        'Phiên đăng nhập đã hết hạn',
      );
    });

    it('nên throw 401 khi phiên đã bị thu hồi', async () => {
      sessionRepo.findOne.mockResolvedValue(makeSession({ revoked_at: new Date() }));

      await expect(service.refresh('old-token', CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('nên throw 401 khi request refresh đồng thời khác đã xoay vòng trước', async () => {
      sessionRepo.findOne.mockResolvedValue(makeSession());
      sessionRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.refresh('old-token', CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('nên thu hồi phiên và throw 401 khi tài khoản đã bị khóa', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({ user: makeUser({ status: UserStatus.SUSPENDED }) }),
      );

      await expect(service.refresh('old-token', CLIENT)).rejects.toThrow(
        'Tài khoản đã bị khóa',
      );
      expect(sessionRepo.update).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================
  // ĐĂNG XUẤT & ME
  // =========================================================

  describe('logout()', () => {
    it('nên chỉ thu hồi phiên của chính token đang dùng', async () => {
      await service.logout({
        id: '15',
        email: 'customer@example.com',
        roles: [RoleType.CUSTOMER],
        session_id: '45',
      });

      expect(sessionRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: '45', user_id: '15' }),
        expect.objectContaining({ revoke_reason: SessionRevokeReason.LOGOUT }),
      );
    });
  });

  describe('me()', () => {
    it('nên trả hồ sơ không chứa password_hash', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());

      const result = await service.me({
        id: '15',
        email: 'customer@example.com',
        roles: [RoleType.CUSTOMER],
        session_id: '45',
      });

      expect(result).not.toHaveProperty('password_hash');
      expect(result.roles).toEqual([RoleType.CUSTOMER]);
    });
  });
});
