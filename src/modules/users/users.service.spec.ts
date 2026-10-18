import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { UsersService } from './users.service.js';
import { User, UserStatus } from './entities/user.entity.js';
import { RoleType } from './entities/role.entity.js';
import {
  SessionRevokeReason,
  UserSession,
} from '../auth/entities/user-session.entity.js';
import type { AuthUser } from '../auth/auth.types.js';

const mockRepo = () => ({
  find: vi.fn(),
  findOne: vi.fn(),
  update: vi.fn(),
});

const PASSWORD = 'SecurePass123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

const authUser: AuthUser = {
  id: '15',
  email: 'customer@example.com',
  roles: [RoleType.CUSTOMER],
  session_id: '45',
};

const makeUser = (): User =>
  ({
    id: '15',
    email: 'customer@example.com',
    password_hash: PASSWORD_HASH,
    full_name: 'Nguyễn Văn A',
    phone_number: '0912345678',
    avatar_url: null,
    status: UserStatus.ACTIVE,
    roles: [{ id: 1, name: RoleType.CUSTOMER }],
    created_at: new Date('2026-10-01'),
  }) as User;

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof mockRepo>;
  let sessionRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    userRepo = mockRepo();
    sessionRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserSession), useValue: sessionRepo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('getProfile()', () => {
    it('nên trả hồ sơ không chứa password_hash', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());

      const result = await service.getProfile(authUser);

      expect(result).not.toHaveProperty('password_hash');
      expect(result).toMatchObject({
        id: '15',
        email: 'customer@example.com',
        roles: [RoleType.CUSTOMER],
      });
    });

    it('nên throw NotFoundException khi tài khoản không còn tồn tại', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.getProfile(authUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile()', () => {
    it('nên chỉ cập nhật họ tên', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());

      const result = await service.updateProfile(authUser, { full_name: 'Nguyễn Văn B' });

      expect(userRepo.update).toHaveBeenCalledWith('15', { full_name: 'Nguyễn Văn B' });
      expect(result.full_name).toBe('Nguyễn Văn B');
    });
  });

  describe('changePassword()', () => {
    it('nên đổi mật khẩu và thu hồi các phiên khác, giữ phiên hiện tại', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      sessionRepo.update.mockResolvedValue({ affected: 2 });

      const result = await service.changePassword(authUser, {
        current_password: PASSWORD,
        new_password: 'NewPassword456',
      });

      const [, patch] = userRepo.update.mock.calls[0];
      expect(await bcrypt.compare('NewPassword456', patch.password_hash)).toBe(true);

      const [criteria, revoke] = sessionRepo.update.mock.calls[0];
      expect(criteria.user_id).toBe('15');
      // Not('45'): loại trừ phiên đang dùng
      expect(criteria.id.value).toBe('45');
      expect(criteria.id.type).toBe('not');
      expect(revoke.revoke_reason).toBe(SessionRevokeReason.PASSWORD_CHANGED);
      expect(result).toEqual({ revoked_sessions: 2 });
    });

    it('nên từ chối khi mật khẩu hiện tại sai và không đổi gì', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());

      await expect(
        service.changePassword(authUser, {
          current_password: 'WrongPass1',
          new_password: 'NewPassword456',
        }),
      ).rejects.toThrow('Mật khẩu hiện tại không đúng');
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(sessionRepo.update).not.toHaveBeenCalled();
    });

    it('nên từ chối khi mật khẩu mới trùng mật khẩu cũ', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());

      await expect(
        service.changePassword(authUser, {
          current_password: PASSWORD,
          new_password: PASSWORD,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('listSessions()', () => {
    it('nên đánh dấu is_current cho phiên đang dùng và chỉ lấy phiên của chính mình', async () => {
      sessionRepo.find.mockResolvedValue([
        { id: '45', user_agent: 'Chrome', ip_address: '1.1.1.1', last_used_at: new Date(), created_at: new Date() },
        { id: '38', user_agent: 'Safari', ip_address: '2.2.2.2', last_used_at: new Date(), created_at: new Date() },
      ]);

      const result = await service.listSessions(authUser);

      expect(sessionRepo.find.mock.calls[0][0].where.user_id).toBe('15');
      expect(result.map((s) => [s.id, s.is_current])).toEqual([
        ['45', true],
        ['38', false],
      ]);
      expect(result[0]).not.toHaveProperty('refresh_token_hash');
    });
  });

  describe('revokeSession()', () => {
    it('nên thu hồi phiên của chính mình với lý do REMOTE', async () => {
      sessionRepo.update.mockResolvedValue({ affected: 1 });

      await service.revokeSession(authUser, '38');

      const [criteria, patch] = sessionRepo.update.mock.calls[0];
      expect(criteria).toMatchObject({ id: '38', user_id: '15' });
      expect(patch.revoke_reason).toBe(SessionRevokeReason.REMOTE);
    });

    it('nên trả 404 khi phiên không thuộc người gọi hoặc đã thu hồi', async () => {
      sessionRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.revokeSession(authUser, '999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
