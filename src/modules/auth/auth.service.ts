import bcrypt from 'bcryptjs';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError, Repository } from 'typeorm';
import { User, UserStatus } from '../users/entities/user.entity.js';
import { Role, RoleType } from '../users/entities/role.entity.js';
import {
  SessionRevokeReason,
  UserSession,
} from './entities/user-session.entity.js';
import { AuthTokenService } from './auth-token.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import type { AuthUser, ClientContext } from './auth.types.js';

const BCRYPT_ROUNDS = 10;
const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const INVALID_CREDENTIALS = 'Email hoặc mật khẩu không đúng';

/** Hash giả để so sánh khi email không tồn tại, tránh lộ thông tin qua thời gian phản hồi (AU-04) */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'timing-attack-dummy-password',
  BCRYPT_ROUNDS,
);

/**
 * Auth Service - Đăng ký, đăng nhập, xoay vòng refresh token, đăng xuất (REQ-028)
 * Quy tắc AU-01 → AU-07 trong docs/design/07_Module1_Ke_hoach_Trien_khai.md
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(UserSession)
    private readonly sessionRepo: Repository<UserSession>,
    private readonly tokenService: AuthTokenService,
  ) {}

  // =========================================================
  // ĐĂNG KÝ
  // =========================================================

  async register(dto: RegisterDto) {
    const role = dto.role ?? RoleType.CUSTOMER;
    if (role === RoleType.HOST && !dto.phone_number) {
      throw new BadRequestException(
        'Chủ nhà bắt buộc đăng ký số điện thoại để xác thực OTP',
      );
    }

    if (await this.userRepo.exists({ where: { email: dto.email } })) {
      throw new ConflictException('Email đã được sử dụng');
    }
    if (
      dto.phone_number &&
      (await this.userRepo.exists({ where: { phone_number: dto.phone_number } }))
    ) {
      throw new ConflictException('Số điện thoại đã được sử dụng');
    }

    // Host vẫn được đặt phòng nhà người khác nên mang cả vai trò CUSTOMER
    const roleNames =
      role === RoleType.HOST
        ? [RoleType.CUSTOMER, RoleType.HOST]
        : [RoleType.CUSTOMER];
    const roles = await this.roleRepo.find({ where: { name: In(roleNames) } });
    if (roles.length !== roleNames.length) {
      throw new InternalServerErrorException('Hệ thống chưa khởi tạo vai trò');
    }

    const user = this.userRepo.create({
      email: dto.email,
      password_hash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      full_name: dto.full_name,
      phone_number: dto.phone_number ?? null,
      roles,
    });

    try {
      await this.userRepo.save(user);
    } catch (error) {
      // Hai request đăng ký cùng email vượt qua bước kiểm tra cùng lúc
      if (this.isDuplicateEntry(error)) {
        throw new ConflictException('Email hoặc số điện thoại đã được sử dụng');
      }
      throw error;
    }

    return {
      user_id: user.id,
      email: user.email,
      full_name: user.full_name,
      roles: roleNames,
    };
  }

  // =========================================================
  // ĐĂNG NHẬP
  // =========================================================

  async login(dto: LoginDto, client: ClientContext) {
    const user = await this.userRepo.findOne({
      where: { email: dto.email },
      relations: { roles: true },
    });

    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const now = new Date();
    if (user.locked_until && user.locked_until > now) {
      const minutes = Math.ceil(
        (user.locked_until.getTime() - now.getTime()) / 60000,
      );
      throw new ForbiddenException(
        `Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau ${minutes} phút`,
      );
    }

    if (!(await bcrypt.compare(dto.password, user.password_hash))) {
      await this.recordFailedLogin(user, now);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Tài khoản đã bị khóa');
    }

    if (user.failed_login_count > 0 || user.locked_until) {
      await this.userRepo.update(user.id, {
        failed_login_count: 0,
        locked_until: null,
      });
    }

    const { token: refreshToken, hash } = this.tokenService.generateRefreshToken();
    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        user_id: user.id,
        refresh_token_hash: hash,
        user_agent: client.userAgent?.slice(0, 255) ?? null,
        ip_address: client.ip,
        expires_at: this.tokenService.refreshExpiresAt(now),
        last_used_at: now,
      }),
    );

    const roles = user.roles.map((r) => r.name);
    return {
      access_token: await this.tokenService.signAccessToken({
        sub: user.id,
        email: user.email,
        roles,
        sid: session.id,
      }),
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.tokenService.accessTtlSeconds,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        roles,
      },
    };
  }

  // =========================================================
  // LÀM MỚI TOKEN (XOAY VÒNG)
  // =========================================================

  async refresh(refreshToken: string, client: ClientContext) {
    const hash = this.tokenService.hashToken(refreshToken);
    const session = await this.sessionRepo.findOne({
      where: { refresh_token_hash: hash },
      relations: { user: { roles: true } },
    });

    if (!session) {
      await this.revokeIfReused(hash);
      throw new UnauthorizedException('Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại');
    }

    const now = new Date();
    if (session.revoked_at || session.expires_at <= now) {
      throw new UnauthorizedException('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      await this.revokeSession(session.id, SessionRevokeReason.REMOTE);
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    const next = this.tokenService.generateRefreshToken();
    // Điều kiện theo hash cũ: 2 request refresh cùng lúc thì chỉ 1 request thắng (KT-10)
    const result = await this.sessionRepo.update(
      { id: session.id, refresh_token_hash: hash, revoked_at: IsNull() },
      {
        refresh_token_hash: next.hash,
        previous_token_hash: hash,
        last_used_at: now,
        expires_at: this.tokenService.refreshExpiresAt(now),
        ip_address: client.ip,
        user_agent: client.userAgent?.slice(0, 255) ?? null,
      },
    );
    if (result.affected !== 1) {
      throw new UnauthorizedException('Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại');
    }

    return {
      access_token: await this.tokenService.signAccessToken({
        sub: session.user.id,
        email: session.user.email,
        roles: session.user.roles.map((r) => r.name),
        sid: session.id,
      }),
      refresh_token: next.token,
      token_type: 'Bearer',
      expires_in: this.tokenService.accessTtlSeconds,
    };
  }

  // =========================================================
  // ĐĂNG XUẤT & THÔNG TIN HIỆN TẠI
  // =========================================================

  async logout(authUser: AuthUser): Promise<void> {
    await this.sessionRepo.update(
      { id: authUser.session_id, user_id: authUser.id, revoked_at: IsNull() },
      { revoked_at: new Date(), revoke_reason: SessionRevokeReason.LOGOUT },
    );
  }

  async me(authUser: AuthUser) {
    const user = await this.userRepo.findOne({
      where: { id: authUser.id },
      relations: { roles: true },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản');
    }

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

  // =========================================================
  // PRIVATE HELPERS
  // =========================================================

  /** AU-03: sai 5 lần liên tiếp thì khóa 15 phút */
  private async recordFailedLogin(user: User, now: Date): Promise<void> {
    const failed = user.failed_login_count + 1;
    if (failed >= MAX_FAILED_LOGINS) {
      await this.userRepo.update(user.id, {
        failed_login_count: 0,
        locked_until: new Date(now.getTime() + LOCK_DURATION_MS),
      });
    } else {
      await this.userRepo.update(user.id, { failed_login_count: failed });
    }
  }

  /** AU-06: refresh token cũ bị dùng lại → nghi bị đánh cắp, thu hồi cả phiên */
  private async revokeIfReused(hash: string): Promise<void> {
    const reused = await this.sessionRepo.findOne({
      where: { previous_token_hash: hash, revoked_at: IsNull() },
    });
    if (reused) {
      await this.revokeSession(reused.id, SessionRevokeReason.REUSE_DETECTED);
    }
  }

  private async revokeSession(
    sessionId: string,
    reason: SessionRevokeReason,
  ): Promise<void> {
    await this.sessionRepo.update(
      { id: sessionId, revoked_at: IsNull() },
      { revoked_at: new Date(), revoke_reason: reason },
    );
  }

  private isDuplicateEntry(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code === 'ER_DUP_ENTRY'
    );
  }
}
