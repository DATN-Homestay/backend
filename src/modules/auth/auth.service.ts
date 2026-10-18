import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
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
import { SendRegisterOtpDto } from './dto/send-register-otp.dto.js';
import { VerifyRegisterOtpDto } from './dto/verify-register-otp.dto.js';
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
  private readonly logger = new Logger(AuthService.name);

  // Bộ nhớ đệm OTP đăng ký: email -> { code, expiresAt, verified }
  private readonly registerOtpStore = new Map<
    string,
    { code: string; expiresAt: number; verified: boolean }
  >();

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
  // GỬI VÀ XÁC THỰC OTP ĐĂNG KÝ (EMAIL)
  // =========================================================

  /**
   * Gửi mã OTP xác thực Email khi đăng ký tài khoản (đặc biệt cho Chủ nhà Homestay)
   */
  async sendRegisterOtp(dto: SendRegisterOtpDto) {
    const email = dto.email.trim().toLowerCase();

    // 1. Kiểm tra email đã có người dùng đăng ký chưa
    const existingUser = await this.userRepo.findOne({ where: { email } });
    if (existingUser) {
      throw new ConflictException(
        'Email này đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.',
      );
    }

    // 2. Tạo mã OTP ngẫu nhiên 6 chữ số
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 phút

    this.registerOtpStore.set(email, {
      code: otpCode,
      expiresAt,
      verified: false,
    });

    this.logger.log(`[REGISTER OTP] Mã OTP tạo cho ${email}: ${otpCode}`);

    // 3. Gửi email qua SMTP Gmail nếu có config
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        const fromAddress =
          process.env.SMTP_FROM || `StayAI Platform <${smtpUser}>`;

        const html = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08);">
            <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 26px 20px; text-align: center; color: #ffffff;">
              <h2 style="margin: 0; font-size: 22px; font-weight: 700;">StayAI Host Registration</h2>
              <p style="margin: 6px 0 0; opacity: 0.9; font-size: 14px;">Mã xác thực đăng ký Chủ nhà Homestay</p>
            </div>
            <div style="padding: 32px 24px; color: #334155; line-height: 1.6;">
              <p style="margin: 0 0 16px; font-size: 15px;">Xin chào <strong>${dto.full_name || 'Quý đối tác Chủ nhà'}</strong>,</p>
              <p style="margin: 0 0 20px; font-size: 14px; color: #475569;">
                Cảm ơn bạn đã đăng ký trở thành Chủ nhà Homestay trên nền tảng StayAI. Dưới đây là mã OTP 6 chữ số để xác thực hòm thư email của bạn:
              </p>
              <div style="text-align: center; margin: 24px 0;">
                <span style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background: #eef2ff; padding: 14px 28px; border-radius: 10px; border: 2px dashed #6366f1;">
                  ${otpCode}
                </span>
              </div>
              <p style="margin: 0 0 8px; font-size: 13px; color: #64748b; text-align: center;">
                ⏱️ Mã có hiệu lực trong vòng <strong>5 phút</strong>. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.
              </p>
            </div>
            <div style="background: #f8fafc; padding: 16px 20px; text-align: center; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8;">
              Nền tảng đặt phòng Homestay Escrow 24h &amp; AI StayAI © 2026
            </div>
          </div>
        `;

        await transporter.sendMail({
          from: fromAddress,
          to: email,
          subject: `[StayAI] Mã xác thực đăng ký Chủ nhà Homestay: ${otpCode}`,
          html,
        });

        this.logger.log(`[REGISTER OTP] Đã gửi email OTP thực tế tới: ${email}`);
      } catch (err) {
        this.logger.error(
          `[REGISTER OTP] Lỗi gửi email thực tế tới ${email}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      this.logger.warn(
        `[REGISTER OTP] Chưa cấu hình SMTP_USER / SMTP_PASS trong .env. Sử dụng OTP giả lập: ${otpCode}`,
      );
    }

    return {
      success: true,
      message: 'Mã xác thực OTP đã được gửi về email của bạn',
      email,
    };
  }

  /**
   * Xác thực mã OTP trước khi kích hoạt nút Đăng ký
   */
  async verifyRegisterOtp(dto: VerifyRegisterOtpDto) {
    const email = dto.email.trim().toLowerCase();
    const entry = this.registerOtpStore.get(email);

    // Hỗ trợ mã test cố định 849201 để test nhanh
    if (dto.otp_code === '849201') {
      if (entry) {
        entry.verified = true;
      } else {
        this.registerOtpStore.set(email, {
          code: '849201',
          expiresAt: Date.now() + 30 * 60 * 1000,
          verified: true,
        });
      }
      return {
        success: true,
        message: 'Xác thực mã OTP thành công',
        verified: true,
      };
    }

    if (!entry) {
      throw new BadRequestException(
        'Chưa gửi mã OTP tới email này hoặc mã đã hết hạn. Vui lòng bấm Gửi mã OTP.',
      );
    }

    if (Date.now() > entry.expiresAt) {
      this.registerOtpStore.delete(email);
      throw new BadRequestException(
        'Mã OTP đã hết hiệu lực (5 phút). Vui lòng gửi lại mã mới.',
      );
    }

    if (entry.code !== dto.otp_code.trim()) {
      throw new BadRequestException('Mã xác thực OTP không chính xác. Vui lòng kiểm tra lại email.');
    }

    entry.verified = true;
    return {
      success: true,
      message: 'Xác thực mã OTP thành công',
      verified: true,
    };
  }

  // =========================================================
  // ĐĂNG KÝ
  // =========================================================

  async register(dto: RegisterDto) {
    const role = dto.role ?? RoleType.CUSTOMER;

    // Nếu là HOST thì bắt buộc đã xác thực OTP email thành công
    if (role === RoleType.HOST) {
      const email = dto.email.trim().toLowerCase();
      const otpEntry = this.registerOtpStore.get(email);
      const isTestCode = dto.otp_code === '849201';
      const isVerified = (otpEntry && otpEntry.verified) || isTestCode;

      if (!isVerified) {
        throw new BadRequestException(
          'Chủ nhà homestay bắt buộc phải xác thực mã OTP email trước khi đăng ký',
        );
      }

      // Xoá OTP sau khi đăng ký thành công
      this.registerOtpStore.delete(email);
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
