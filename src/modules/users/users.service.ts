import bcrypt from 'bcryptjs';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Not, Repository } from 'typeorm';
import { User } from './entities/user.entity.js';
import {
  SessionRevokeReason,
  UserSession,
} from '../auth/entities/user-session.entity.js';
import type { AuthUser } from '../auth/auth.types.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';

const BCRYPT_ROUNDS = 10;

/**
 * Users Service - Hồ sơ cá nhân, đổi mật khẩu, quản lý thiết bị đăng nhập (REQ-028).
 * Mọi truy vấn đều lọc theo user_id của người gọi (chống IDOR).
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserSession)
    private readonly sessionRepo: Repository<UserSession>,
  ) {}

  // =========================================================
  // HỒ SƠ
  // =========================================================

  async getProfile(authUser: AuthUser) {
    return this.toProfile(await this.findUser(authUser.id));
  }

  async updateProfile(authUser: AuthUser, dto: UpdateProfileDto) {
    const user = await this.findUser(authUser.id);
    user.full_name = dto.full_name;
    await this.userRepo.update(user.id, { full_name: dto.full_name });
    return this.toProfile(user);
  }

  // =========================================================
  // ĐỔI MẬT KHẨU
  // =========================================================

  async changePassword(authUser: AuthUser, dto: ChangePasswordDto) {
    const user = await this.findUser(authUser.id);

    if (!(await bcrypt.compare(dto.current_password, user.password_hash))) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng');
    }
    if (dto.current_password === dto.new_password) {
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    }

    await this.userRepo.update(user.id, {
      password_hash: await bcrypt.hash(dto.new_password, BCRYPT_ROUNDS),
    });

    // Đăng xuất mọi thiết bị khác, giữ lại phiên đang dùng để người dùng không bị văng ra
    const result = await this.sessionRepo.update(
      {
        user_id: user.id,
        id: Not(authUser.session_id),
        revoked_at: IsNull(),
      },
      {
        revoked_at: new Date(),
        revoke_reason: SessionRevokeReason.PASSWORD_CHANGED,
      },
    );

    return { revoked_sessions: result.affected ?? 0 };
  }

  // =========================================================
  // THIẾT BỊ ĐĂNG NHẬP
  // =========================================================

  async listSessions(authUser: AuthUser) {
    const sessions = await this.sessionRepo.find({
      where: {
        user_id: authUser.id,
        revoked_at: IsNull(),
        expires_at: MoreThan(new Date()),
      },
      order: { last_used_at: 'DESC' },
    });

    return sessions.map((s) => ({
      id: s.id,
      user_agent: s.user_agent,
      ip_address: s.ip_address,
      last_used_at: s.last_used_at,
      created_at: s.created_at,
      is_current: s.id === authUser.session_id,
    }));
  }

  /** Chỉ thu hồi được phiên của chính mình; phiên người khác trả 404 để không lộ sự tồn tại */
  async revokeSession(authUser: AuthUser, sessionId: string): Promise<void> {
    const result = await this.sessionRepo.update(
      { id: sessionId, user_id: authUser.id, revoked_at: IsNull() },
      { revoked_at: new Date(), revoke_reason: SessionRevokeReason.REMOTE },
    );
    if (result.affected !== 1) {
      throw new NotFoundException('Không tìm thấy phiên đăng nhập');
    }
  }

  // =========================================================
  // PRIVATE HELPERS
  // =========================================================

  private async findUser(id: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: { roles: true },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản');
    }
    return user;
  }

  private toProfile(user: User) {
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone_number: user.phone_number,
      avatar_url: user.avatar_url,
      status: user.status,
      roles: user.roles.map((r) => r.name),
      created_at: user.created_at,
    };
  }
}
